-- Adds an aggregate star rating to list_teachers() so students see it while
-- picking a teacher (Find-a-teacher wizard), not just after clicking into a
-- profile. Same rating semantics as get_counterparty_profile(): a teacher's
-- rating averages student_rating across their sessions (by TID).
--
-- Like the other migrations in this folder, this is NOT run by a CLI migration
-- runner — paste it into the Supabase SQL editor and run it.

DROP FUNCTION IF EXISTS public.list_teachers();

CREATE FUNCTION public.list_teachers()
RETURNS TABLE(
  tid uuid,
  uid uuid,
  name text,
  subject_list text[],
  years_experience integer,
  timezone text,
  avg_rating numeric,
  rating_count integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT t."TID", t."UID",
    nullif(trim(coalesce(u.firstname,'')||' '||coalesce(u.lastname,'')), ''),
    COALESCE(t.subject_list, '{}'),
    COALESCE(t.years_experience, 0),
    COALESCE(u.timezone, 'UTC'),
    r.avg_rating, r.rating_count
  FROM public."Teachers" t
  JOIN public."Users" u ON u."UID" = t."UID"
  LEFT JOIN LATERAL (
    SELECT avg(bt.student_rating)::numeric(3,1) AS avg_rating, count(*)::integer AS rating_count
    FROM public."Blocked_Time" bt
    WHERE bt."TID" = t."TID" AND bt.student_rating IS NOT NULL
  ) r ON true
$$;

GRANT EXECUTE ON FUNCTION public.list_teachers() TO authenticated;
