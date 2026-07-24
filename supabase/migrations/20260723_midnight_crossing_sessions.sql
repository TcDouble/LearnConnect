-- Fix "Could not send request: ... violates check constraint booked_sessions_time_range_check".
--
-- Blocked_Time stores a session as one `date` plus `starttime`/`endtime` (time-of-day
-- only), with the storage contract that these are UTC (see webapp/tz.js). The old
-- check constraint required endtime > starttime, which breaks for any session whose
-- end crosses UTC midnight — including immediate requests, since "now" crosses UTC
-- midnight once a day for a `duration`-sized window regardless of the user's local
-- timezone. available_teachers()'s conflict check made the same same-day assumption.
--
-- Fix: add an end_date column that a trigger derives automatically (endtime > starttime
-- means same day; endtime <= starttime means it rolled into the next UTC day — safe
-- because sessions are always well under 24h), replace the check constraint with one
-- that allows exactly those two shapes, and make available_teachers() compare full
-- (date + time) instants instead of same-day time-of-day only.
--
-- Like the other migrations in this folder, this is NOT run by a CLI migration
-- runner — paste it into the Supabase SQL editor and run it.

ALTER TABLE "Blocked_Time" ADD COLUMN IF NOT EXISTS end_date date;

UPDATE "Blocked_Time" SET end_date = date WHERE end_date IS NULL;

CREATE OR REPLACE FUNCTION public.blocked_time_set_end_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.end_date := NEW.date + CASE WHEN NEW.endtime > NEW.starttime THEN 0 ELSE 1 END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS blocked_time_set_end_date ON "Blocked_Time";
CREATE TRIGGER blocked_time_set_end_date
  BEFORE INSERT OR UPDATE OF date, starttime, endtime ON "Blocked_Time"
  FOR EACH ROW EXECUTE FUNCTION public.blocked_time_set_end_date();

ALTER TABLE "Blocked_Time" ALTER COLUMN end_date SET NOT NULL;

ALTER TABLE "Blocked_Time" DROP CONSTRAINT IF EXISTS booked_sessions_time_range_check;
ALTER TABLE "Blocked_Time" ADD CONSTRAINT booked_sessions_time_range_check CHECK (
  (end_date = date     AND endtime > starttime) OR
  (end_date = date + 1 AND endtime <= starttime)
);

-- Conflict check: compare full instants instead of assuming same UTC calendar date.
CREATE OR REPLACE FUNCTION public.available_teachers(session_start timestamptz, session_end timestamptz)
RETURNS TABLE(uid uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH all_teachers AS (
    SELECT t."UID" FROM "Teachers" t
  ),
  has_availability AS (
    SELECT DISTINCT ta."UID" FROM "Teacher_Availability" ta
  ),
  avail AS (
    -- Teacher has a slot covering the session in their own local timezone
    SELECT ta."UID"
    FROM "Teacher_Availability" ta
    JOIN "Users" u ON u."UID" = ta."UID"
    WHERE u.timezone IS NOT NULL
      AND ta.day      = EXTRACT(DOW FROM session_start AT TIME ZONE u.timezone)::int
      AND ta.starttime <= (session_start AT TIME ZONE u.timezone)::time
      AND ta.endtime   >= (session_end   AT TIME ZONE u.timezone)::time
  ),
  blocked AS (
    SELECT bt."TID"
    FROM "Blocked_Time" bt
    WHERE bt.status != 'canceled'
      AND (bt.date     + bt.starttime) AT TIME ZONE 'UTC' < session_end
      AND (bt.end_date + bt.endtime  ) AT TIME ZONE 'UTC' > session_start
  ),
  blocked_uids AS (
    SELECT t."UID" FROM "Teachers" t
    WHERE t."TID" IN (SELECT "TID" FROM blocked)
  ),
  time_available AS (
    -- 1. Has a matching availability slot (timezone-aware)
    SELECT "UID" FROM avail
    UNION
    -- 2. No availability rows at all → open schedule
    SELECT "UID" FROM all_teachers
    WHERE "UID" NOT IN (SELECT "UID" FROM has_availability)
    UNION
    -- 3. Has availability rows but timezone is null → can't verify, include them
    SELECT t."UID" FROM "Teachers" t
    JOIN "Users" u ON u."UID" = t."UID"
    WHERE u.timezone IS NULL
      AND t."UID" IN (SELECT "UID" FROM has_availability)
  )
  SELECT DISTINCT ta."UID"
  FROM time_available ta
  WHERE ta."UID" NOT IN (SELECT "UID" FROM blocked_uids)
$$;

-- Expose end_date from my_sessions() so the client can correctly tell whether a
-- midnight-crossing session is past due (DROP required because the return type changes).
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
  is_immediate                boolean
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
         b.subject, b.request, b.date, b.end_date, b.starttime, b.endtime, b.status,
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
