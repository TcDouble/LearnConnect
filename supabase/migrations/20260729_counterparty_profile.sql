-- Lets a request-row click show the other party's profile (bio, subjects,
-- experience for a teacher; grade/age/goals for a student) without exposing
-- a general "look up anyone's profile" surface. Access is scoped to a
-- specific session/request row and requires the caller to actually be one
-- of its two participants (mirrors the SECURITY DEFINER + ownership check
-- pattern used by confirm_broadcast_teacher()).
--
-- Like the other migrations in this folder, this is NOT run by a CLI migration
-- runner — paste it into the Supabase SQL editor and run it.

CREATE OR REPLACE FUNCTION public.get_counterparty_profile(p_session_id uuid)
RETURNS TABLE(
  role             text,
  name             text,
  bio              text,
  subject_list     text[],
  years_experience integer,
  grade_level      text,
  age              integer,
  goals            text
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
           NULL::text, NULL::integer, NULL::text
    FROM "Teachers" t JOIN "Users" u ON u."UID" = t."UID"
    WHERE t."TID" = v_tid;
  ELSE
    RETURN QUERY
    SELECT 'student'::text,
           nullif(trim(coalesce(u.firstname,'')||' '||coalesce(u.lastname,'')), ''),
           u.bio, s.subject_list, NULL::integer,
           s.grade_level, s.age, s.goals
    FROM "Students" s JOIN "Users" u ON u."UID" = s."UID"
    WHERE s."SID" = v_sid;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_counterparty_profile(uuid) TO authenticated;
