-- Merge Persona: let a Users row hold both student and teacher personas.
--
-- Apply this in Supabase → SQL editor (the project doesn't use the Supabase CLI
-- migration runner). Sections 1 and 2 are idempotent. Sections 3 and 4 replace
-- the existing trigger / RPC; review them against whatever extras your live
-- definitions have before running.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Add is_student / is_teacher to Users and backfill from the existing role.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public."Users"
  ADD COLUMN IF NOT EXISTS is_student boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_teacher boolean NOT NULL DEFAULT false;

UPDATE public."Users" SET is_student = true WHERE role = 'student' AND is_student = false;
UPDATE public."Users" SET is_teacher = true WHERE role = 'teacher' AND is_teacher = false;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. RLS: make sure users can update their own is_student / is_teacher.
--    If the existing "users update own row" policy is row-level only
--    (USING auth.uid() = UID, no column list), nothing to do.
--    If it's column-restricted, add the two new columns to the allowed list.
-- ──────────────────────────────────────────────────────────────────────────────

-- (Inspect with: SELECT polname, polcmd, pg_get_expr(polqual, polrelid)
--                FROM pg_policy WHERE polrelid = 'public."Users"'::regclass;)

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. handle_new_user(): set is_student / is_teacher from signup role metadata.
--    Replace this body with whatever your existing trigger does + the two new
--    flag assignments. The shape below matches the README's description.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(NEW.raw_user_meta_data->>'role', 'student');
BEGIN
  INSERT INTO public."Users" (
    "UID", firstname, lastname, email, role, is_student, is_teacher
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'firstname', ''),
    COALESCE(NEW.raw_user_meta_data->>'lastname', ''),
    NEW.email,
    v_role,
    v_role = 'student',
    v_role = 'teacher'
  );
  RETURN NEW;
END;
$$;

-- The trigger itself probably already exists. Re-create only if missing:
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- CREATE TRIGGER on_auth_user_created
--   AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. list_teachers(): filter on is_teacher = true so dual-persona users are
--    visible even when their primary signup role was 'student'.
--    Returns columns the student dashboard's renderAvailableTeachers reads:
--    tid (used for Blocked_Time inserts) and name (concatenated full name).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_teachers()
RETURNS TABLE (
  tid uuid,
  name text,
  subject_list text[],
  years_experience integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t."TID" AS tid,
         trim(coalesce(u.firstname, '') || ' ' || coalesce(u.lastname, '')) AS name,
         t.subject_list,
         t.years_experience
  FROM public."Users" u
  JOIN public."Teachers" t ON t."UID" = u."UID"
  WHERE u.is_teacher = true;
$$;
