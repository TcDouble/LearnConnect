-- Adds Blocked_Time.created_at so the client can expire an immediate request
-- 2 hours after it was made (rather than after its nominal endtime) when no
-- meeting room was ever created for it. Exposes it via my_sessions() so the
-- dashboard's expiry logic (see isExpired() in student-dashboard.html) has it.
--
-- Like the other migrations in this folder, this is NOT run by a CLI migration
-- runner — paste it into the Supabase SQL editor and run it.

ALTER TABLE "Blocked_Time" ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- DROP required because the return type (added created_at) changes.
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
  end_date                    date,
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
  is_immediate                boolean,
  created_at                  timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT b."SessionID", 'student'::text,
         nullif(trim(coalesce(tu.firstname,'')||' '||coalesce(tu.lastname,'')), ''),
         tu."UID",
         b.subject, b.request, b.date, b.end_date, b.starttime, b.endtime, b.status,
         b.meeting_url, b.meeting_provider, b.duration,
         b.ended_at, b.actual_duration_minutes,
         b.student_review_token AS my_review_token,
         b.teacher_rating, b.student_rating, b.teacher_notes,
         b.teacher_review_submitted_at, b.student_review_submitted_at,
         b.broadcast_id, b.is_immediate, b.created_at
  FROM public."Blocked_Time" b
  JOIN public."Students" s  ON s."SID" = b."SID"
  JOIN public."Teachers" t  ON t."TID" = b."TID"
  JOIN public."Users"    tu ON tu."UID" = t."UID"
  WHERE s."UID" = auth.uid()
  UNION ALL
  SELECT b."SessionID", 'teacher'::text,
         nullif(trim(coalesce(su.firstname,'')||' '||coalesce(su.lastname,'')), ''),
         su."UID",
         b.subject, b.request, b.date, b.end_date, b.starttime, b.endtime, b.status,
         b.meeting_url, b.meeting_provider, b.duration,
         b.ended_at, b.actual_duration_minutes,
         b.teacher_review_token AS my_review_token,
         b.teacher_rating, b.student_rating, b.teacher_notes,
         b.teacher_review_submitted_at, b.student_review_submitted_at,
         b.broadcast_id, b.is_immediate, b.created_at
  FROM public."Blocked_Time" b
  JOIN public."Teachers" t  ON t."TID" = b."TID"
  JOIN public."Students" s  ON s."SID" = b."SID"
  JOIN public."Users"    su ON su."UID" = s."UID"
  WHERE t."UID" = auth.uid();
$$;
