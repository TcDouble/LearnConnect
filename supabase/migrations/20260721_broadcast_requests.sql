-- Broadcast immediate requests to all available teachers.
-- Like the other migrations in this folder, this is NOT run by a CLI migration
-- runner — paste it into the Supabase SQL editor and run it.
--
-- IMPORTANT: run BLOCK 1 and BLOCK 2 as two SEPARATE executions ("Run" clicks).
-- Postgres forbids using a freshly-added enum value before the ALTER TYPE that
-- added it has committed, and the SQL editor runs a whole pasted script as one
-- implicit transaction — so the ALTER TYPE below must commit before the
-- functions in block 2 (which reference the new 'offer_accepted' value) run.

-- ============================== BLOCK 1 ====================================
-- Run this first. Wait for it to succeed before running block 2.

ALTER TABLE "Blocked_Time"
  ADD COLUMN IF NOT EXISTS broadcast_id  UUID,
  ADD COLUMN IF NOT EXISTS is_immediate  BOOLEAN NOT NULL DEFAULT false;

ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'offer_accepted';

CREATE INDEX IF NOT EXISTS blocked_time_broadcast_id_idx
  ON "Blocked_Time" (broadcast_id) WHERE broadcast_id IS NOT NULL;

-- ============================== BLOCK 2 ====================================
-- Run this only after block 1 above has committed successfully.

-- Update my_sessions() to also expose broadcast_id / is_immediate
-- (DROP required because the return type changes)
DROP FUNCTION IF EXISTS public.my_sessions();

CREATE FUNCTION public.my_sessions()
RETURNS TABLE(
  session_id                  uuid,
  my_role                     text,
  counterparty                text,
  counterparty_uid            uuid,
  subject                     text,
  request                     text,
  session_date                date,
  starttime                   time without time zone,
  endtime                     time without time zone,
  status                      booking_status,
  meeting_url                 text,
  meeting_provider            text,
  duration                    integer,
  ended_at                    timestamptz,
  actual_duration_minutes     integer,
  my_review_token             uuid,
  teacher_rating              integer,
  student_rating              integer,
  teacher_notes               text,
  teacher_review_submitted_at timestamptz,
  student_review_submitted_at timestamptz,
  broadcast_id                uuid,
  is_immediate                boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT b."SessionID", 'student'::text,
         nullif(trim(coalesce(tu.firstname,'')||' '||coalesce(tu.lastname,'')), ''),
         tu."UID",
         b.subject, b.request, b.date, b.starttime, b.endtime, b.status,
         b.meeting_url, b.meeting_provider, b.duration,
         b.ended_at, b.actual_duration_minutes,
         b.student_review_token AS my_review_token,
         b.teacher_rating, b.student_rating, b.teacher_notes,
         b.teacher_review_submitted_at, b.student_review_submitted_at,
         b.broadcast_id, b.is_immediate
  FROM public."Blocked_Time" b
  JOIN public."Students" s  ON s."SID" = b."SID"
  JOIN public."Teachers" t  ON t."TID" = b."TID"
  JOIN public."Users"    tu ON tu."UID" = t."UID"
  WHERE s."UID" = auth.uid()
  UNION ALL
  SELECT b."SessionID", 'teacher'::text,
         nullif(trim(coalesce(su.firstname,'')||' '||coalesce(su.lastname,'')), ''),
         su."UID",
         b.subject, b.request, b.date, b.starttime, b.endtime, b.status,
         b.meeting_url, b.meeting_provider, b.duration,
         b.ended_at, b.actual_duration_minutes,
         b.teacher_review_token AS my_review_token,
         b.teacher_rating, b.student_rating, b.teacher_notes,
         b.teacher_review_submitted_at, b.student_review_submitted_at,
         b.broadcast_id, b.is_immediate
  FROM public."Blocked_Time" b
  JOIN public."Teachers" t  ON t."TID" = b."TID"
  JOIN public."Students" s  ON s."SID" = b."SID"
  JOIN public."Users"    su ON su."UID" = s."UID"
  WHERE t."UID" = auth.uid();
$$;

-- Finalize a broadcast: the calling student picks one teacher out of everyone
-- who accepted. Atomically schedules that one row and cancels every other
-- sibling row sharing the same broadcast_id — this can't be expressed as a
-- single plain client-side .update() call (which always applies one uniform
-- payload to every row it matches), so it needs to live server-side.
CREATE OR REPLACE FUNCTION public.confirm_broadcast_teacher(p_session_id uuid)
RETURNS TABLE(session_id uuid, status booking_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_broadcast_id uuid;
  v_sid          uuid;
BEGIN
  SELECT b.broadcast_id, b."SID" INTO v_broadcast_id, v_sid
  FROM "Blocked_Time" b WHERE b."SessionID" = p_session_id;

  IF v_broadcast_id IS NULL THEN
    RAISE EXCEPTION 'NOT_A_BROADCAST_OFFER: session % has no broadcast_id', p_session_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "Students" s WHERE s."SID" = v_sid AND s."UID" = auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: not the owning student';
  END IF;

  RETURN QUERY
  UPDATE "Blocked_Time" AS bt
  SET status = CASE WHEN bt."SessionID" = p_session_id THEN 'scheduled'::booking_status ELSE 'canceled'::booking_status END
  WHERE bt.broadcast_id = v_broadcast_id
    AND bt.status IN ('offer_accepted', 'waiting for teacher')
  RETURNING bt."SessionID", bt.status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STALE_OFFER: this offer is no longer available (it may have been withdrawn or already confirmed)';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_broadcast_teacher(uuid) TO authenticated;

-- Before relying on RLS for the multi-teacher broadcast insert (one row per
-- available teacher, all sharing one SID), confirm the student insert/update
-- policy on Blocked_Time is scoped by SID only (not also by TID):
--
--   SELECT polname, polcmd, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
--   FROM pg_policy WHERE polrelid = '"Blocked_Time"'::regclass;
