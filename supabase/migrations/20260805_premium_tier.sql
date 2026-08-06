-- Adds a self-service "premium" flag on Users, and the auto-confirm behavior
-- that depends on it for broadcast (multi-teacher) requests:
--
--   premium student  — unchanged today's flow: can uncheck specific teachers
--                       before sending, and manually reviews/picks among
--                       whoever accepts (confirm_broadcast_teacher()).
--   normal student    — cannot exclude teachers from the broadcast (enforced
--                       client-side by locking the selection checkboxes —
--                       there's nothing to gate server-side there, sending a
--                       request to teachers the student owns is already just
--                       an insert), and the FIRST teacher to accept is
--                       auto-confirmed; every other teacher's copy is
--                       canceled immediately, no manual review step.
--
-- Like the other migrations in this folder, this is NOT run by a CLI migration
-- runner — paste it into the Supabase SQL editor and run it.

ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS is_premium boolean NOT NULL DEFAULT false;

-- Called by the accepting TEACHER's session right after their accept lands
-- (status -> offer_accepted). If the requesting student isn't premium, this
-- immediately finalizes that teacher and cancels every other pending/accepted
-- copy in the same broadcast — same "schedule this one, cancel the rest"
-- transition as confirm_broadcast_teacher(), just triggered by the teacher's
-- acceptance instead of the student's manual choice, and gated on tier
-- instead of on caller identity.
--
-- Race-safe: concurrent accepts each run this independently; the shared
-- UPDATE only ever lets one SessionID end up 'scheduled' (whichever commits
-- first), and every caller reports the *actual* resulting status of their
-- own row rather than assuming their own call won.
CREATE OR REPLACE FUNCTION public.maybe_auto_confirm_broadcast(p_session_id uuid)
RETURNS TABLE(auto_confirmed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_broadcast_id uuid;
  v_sid          uuid;
  v_tid          uuid;
  v_is_premium   boolean;
BEGIN
  SELECT b.broadcast_id, b."SID", b."TID" INTO v_broadcast_id, v_sid, v_tid
  FROM "Blocked_Time" b WHERE b."SessionID" = p_session_id;

  IF v_broadcast_id IS NULL THEN
    RETURN QUERY SELECT false; RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "Teachers" t WHERE t."TID" = v_tid AND t."UID" = auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: not the responding teacher';
  END IF;

  SELECT COALESCE(u.is_premium, false) INTO v_is_premium
  FROM "Students" s JOIN "Users" u ON u."UID" = s."UID"
  WHERE s."SID" = v_sid;

  IF v_is_premium THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  UPDATE "Blocked_Time" AS bt
  SET status = CASE WHEN bt."SessionID" = p_session_id THEN 'scheduled'::booking_status ELSE 'canceled'::booking_status END
  WHERE bt.broadcast_id = v_broadcast_id
    AND bt.status IN ('offer_accepted', 'waiting for teacher');

  RETURN QUERY
  SELECT EXISTS(SELECT 1 FROM "Blocked_Time" WHERE "SessionID" = p_session_id AND status = 'scheduled');
END;
$$;

GRANT EXECUTE ON FUNCTION public.maybe_auto_confirm_broadcast(uuid) TO authenticated;
