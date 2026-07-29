-- Add an aggregate star rating to get_counterparty_profile() so the profile
-- modal (opened from a request row, or from a broadcast response) can show
-- how this person has been rated across their past sessions.
--
-- Rating semantics (see submit-review edge function): teacher_rating is the
-- rating a TEACHER gave a STUDENT; student_rating is the rating a STUDENT
-- gave a TEACHER. So a student's aggregate rating averages teacher_rating
-- across their sessions (by SID), and a teacher's averages student_rating
-- across theirs (by TID).
--
-- Like the other migrations in this folder, this is NOT run by a CLI migration
-- runner — paste it into the Supabase SQL editor and run it.

-- DROP required because the return type (added avg_rating/rating_count) changes.
DROP FUNCTION IF EXISTS public.get_counterparty_profile(uuid);

CREATE FUNCTION public.get_counterparty_profile(p_session_id uuid)
RETURNS TABLE(
  role             text,
  name             text,
  bio              text,
  subject_list     text[],
  years_experience integer,
  grade_level      text,
  age              integer,
  goals            text,
  avg_rating       numeric,
  rating_count     integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sid uuid;
  v_tid uuid;
  v_caller_is_student boolean;
  v_caller_is_teacher boolean;
BEGIN
  SELECT bt."SID", bt."TID" INTO v_sid, v_tid FROM "Blocked_Time" bt WHERE bt."SessionID" = p_session_id;
  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: no such session';
  END IF;

  SELECT EXISTS(SELECT 1 FROM "Students" s WHERE s."SID" = v_sid AND s."UID" = auth.uid()) INTO v_caller_is_student;
  SELECT EXISTS(SELECT 1 FROM "Teachers" t WHERE t."TID" = v_tid AND t."UID" = auth.uid()) INTO v_caller_is_teacher;

  IF NOT v_caller_is_student AND NOT v_caller_is_teacher THEN
    RAISE EXCEPTION 'FORBIDDEN: not a participant on this session';
  END IF;

  IF v_caller_is_student THEN
    RETURN QUERY
    SELECT 'teacher'::text,
           nullif(trim(coalesce(u.firstname,'')||' '||coalesce(u.lastname,'')), ''),
           u.bio, t.subject_list, t.years_experience,
           NULL::text, NULL::integer, NULL::text,
           r.avg_rating, r.rating_count
    FROM "Teachers" t
    JOIN "Users" u ON u."UID" = t."UID"
    LEFT JOIN (
      SELECT avg(student_rating)::numeric(3,1) AS avg_rating, count(*)::integer AS rating_count
      FROM "Blocked_Time" WHERE "TID" = v_tid AND student_rating IS NOT NULL
    ) r ON true
    WHERE t."TID" = v_tid;
  ELSE
    RETURN QUERY
    SELECT 'student'::text,
           nullif(trim(coalesce(u.firstname,'')||' '||coalesce(u.lastname,'')), ''),
           u.bio, s.subject_list, NULL::integer,
           s.grade_level, s.age, s.goals,
           r.avg_rating, r.rating_count
    FROM "Students" s
    JOIN "Users" u ON u."UID" = s."UID"
    LEFT JOIN (
      SELECT avg(teacher_rating)::numeric(3,1) AS avg_rating, count(*)::integer AS rating_count
      FROM "Blocked_Time" WHERE "SID" = v_sid AND teacher_rating IS NOT NULL
    ) r ON true
    WHERE s."SID" = v_sid;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_counterparty_profile(uuid) TO authenticated;
