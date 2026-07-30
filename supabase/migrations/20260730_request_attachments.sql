-- Supports editing a pending sent request (student side): adding more than
-- one document, on top of the single attachment_url/attachment_filename
-- captured at request-creation time. Existing single-attachment data on
-- Blocked_Time is left as-is (not migrated) and is merged in by
-- get_request_attachments() as the first item in the list, so nothing else
-- that already reads attachment_url/attachment_filename needs to change.
--
-- A broadcast request is edited as one unit (per product decision — Edit
-- and Cancel act on every teacher's copy at once), so attachments added via
-- Edit are keyed by broadcast_id when the request was broadcast, or by
-- session_id for a single-teacher request. Exactly one of the two is set.
--
-- Like the other migrations in this folder, this is NOT run by a CLI migration
-- runner — paste it into the Supabase SQL editor and run it.

CREATE TABLE IF NOT EXISTS "Request_Attachments" (
  "AttachmentID" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid REFERENCES "Blocked_Time"("SessionID"),
  broadcast_id   uuid,
  url            text NOT NULL,
  filename       text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((session_id IS NOT NULL) <> (broadcast_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS request_attachments_session_id_idx ON "Request_Attachments" (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS request_attachments_broadcast_id_idx ON "Request_Attachments" (broadcast_id) WHERE broadcast_id IS NOT NULL;

ALTER TABLE "Request_Attachments" ENABLE ROW LEVEL SECURITY;

-- Either participant (student or teacher) on the matching session(s) can see attachments.
CREATE POLICY "request_attachments_select_participants" ON "Request_Attachments" FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM "Blocked_Time" bt
    LEFT JOIN "Students" s ON s."SID" = bt."SID"
    LEFT JOIN "Teachers" t ON t."TID" = bt."TID"
    WHERE (bt."SessionID" = "Request_Attachments".session_id
           OR ("Request_Attachments".broadcast_id IS NOT NULL AND bt.broadcast_id = "Request_Attachments".broadcast_id))
      AND (s."UID" = auth.uid() OR t."UID" = auth.uid())
  )
);

-- Only the owning student can add or remove attachments (they're editing their own request).
CREATE POLICY "request_attachments_insert_owner" ON "Request_Attachments" FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM "Blocked_Time" bt
    JOIN "Students" s ON s."SID" = bt."SID"
    WHERE (bt."SessionID" = "Request_Attachments".session_id
           OR ("Request_Attachments".broadcast_id IS NOT NULL AND bt.broadcast_id = "Request_Attachments".broadcast_id))
      AND s."UID" = auth.uid()
  )
);

CREATE POLICY "request_attachments_delete_owner" ON "Request_Attachments" FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM "Blocked_Time" bt
    JOIN "Students" s ON s."SID" = bt."SID"
    WHERE (bt."SessionID" = "Request_Attachments".session_id
           OR ("Request_Attachments".broadcast_id IS NOT NULL AND bt.broadcast_id = "Request_Attachments".broadcast_id))
      AND s."UID" = auth.uid()
  )
);

-- Returns the full attachment list for a request (legacy single attachment,
-- if any, plus every row in Request_Attachments for that session/broadcast).
CREATE OR REPLACE FUNCTION public.get_request_attachments(p_session_id uuid)
RETURNS TABLE(attachment_id uuid, url text, filename text, created_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sid uuid;
  v_tid uuid;
  v_broadcast_id uuid;
  v_legacy_url text;
  v_legacy_filename text;
BEGIN
  SELECT bt."SID", bt."TID", bt.broadcast_id, bt.attachment_url, bt.attachment_filename
  INTO v_sid, v_tid, v_broadcast_id, v_legacy_url, v_legacy_filename
  FROM "Blocked_Time" bt WHERE bt."SessionID" = p_session_id;

  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: no such session';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "Students" s WHERE s."SID" = v_sid AND s."UID" = auth.uid())
     AND NOT EXISTS (SELECT 1 FROM "Teachers" t WHERE t."TID" = v_tid AND t."UID" = auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: not a participant on this session';
  END IF;

  RETURN QUERY
  SELECT NULL::uuid, v_legacy_url, v_legacy_filename, NULL::timestamptz
  WHERE v_legacy_url IS NOT NULL
  UNION ALL
  SELECT ra."AttachmentID", ra.url, ra.filename, ra.created_at
  FROM "Request_Attachments" ra
  WHERE ra.session_id = p_session_id
     OR (v_broadcast_id IS NOT NULL AND ra.broadcast_id = v_broadcast_id)
  ORDER BY 4 NULLS FIRST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_request_attachments(uuid) TO authenticated;
