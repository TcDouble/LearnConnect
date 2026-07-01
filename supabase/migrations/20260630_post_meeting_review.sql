-- Add review/completion columns to Blocked_Time
ALTER TABLE "Blocked_Time"
  ADD COLUMN IF NOT EXISTS ended_at                    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_duration_minutes     INT,
  ADD COLUMN IF NOT EXISTS teacher_review_token        UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS student_review_token        UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS teacher_rating              INT  CHECK (teacher_rating  BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS student_rating              INT  CHECK (student_rating  BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS teacher_notes               TEXT,
  ADD COLUMN IF NOT EXISTS teacher_review_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS student_review_submitted_at TIMESTAMPTZ;

-- Update my_sessions() to include review columns
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
  student_review_submitted_at timestamptz
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
         b.teacher_review_submitted_at, b.student_review_submitted_at
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
         b.teacher_review_submitted_at, b.student_review_submitted_at
  FROM public."Blocked_Time" b
  JOIN public."Teachers" t  ON t."TID" = b."TID"
  JOIN public."Students" s  ON s."SID" = b."SID"
  JOIN public."Users"    su ON su."UID" = s."UID"
  WHERE t."UID" = auth.uid();
$$;
