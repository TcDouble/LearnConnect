// Edge Function: submit-review
// Token-based review submission — no JWT required; the UUID token is the authorization.
//
// POST body (action = get_session): { action: 'get_session', token: string }
//   → returns session info and whether the review has already been submitted
//
// POST body (action = submit): { action: 'submit', token: string, rating: 1-5, notes?: string }
//   → writes rating/notes to Blocked_Time and returns { ok: true }

import { createClient } from "jsr:@supabase/supabase-js@2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const { action, token, rating, notes } = body as {
      action?: string; token?: string; rating?: number; notes?: string;
    };

    if (!token)              return json({ error: "token required" }, 400);
    if (!UUID_RE.test(token)) return json({ error: "Invalid token" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: bt } = await admin
      .from("Blocked_Time")
      .select([
        "SessionID", "SID", "TID", "subject", "date",
        "teacher_review_token", "student_review_token",
        "teacher_rating", "student_rating", "teacher_notes",
        "teacher_review_submitted_at", "student_review_submitted_at",
      ].join(", "))
      .or(`teacher_review_token.eq.${token},student_review_token.eq.${token}`)
      .maybeSingle();

    if (!bt) return json({ error: "Invalid token" }, 404);

    const isTeacher = bt.teacher_review_token === token;
    const role      = isTeacher ? "teacher" : "student";

    // Look up names
    const { data: tch }     = await admin.from("Teachers").select("UID").eq("TID", bt.TID).maybeSingle();
    const { data: tchUser } = tch
      ? await admin.from("Users").select("firstname, lastname").eq("UID", tch.UID).maybeSingle()
      : { data: null };
    const { data: stu }     = await admin.from("Students").select("UID").eq("SID", bt.SID).maybeSingle();
    const { data: stuUser } = stu
      ? await admin.from("Users").select("firstname, lastname").eq("UID", stu.UID).maybeSingle()
      : { data: null };

    const teacherName = [tchUser?.firstname, tchUser?.lastname].filter(Boolean).join(" ") || "Teacher";
    const studentName = [stuUser?.firstname, stuUser?.lastname].filter(Boolean).join(" ") || "Student";

    if (action === "get_session") {
      const alreadySubmitted = isTeacher
        ? bt.teacher_review_submitted_at !== null
        : bt.student_review_submitted_at !== null;
      return json({
        role,
        subject:        bt.subject,
        sessionDate:    bt.date,
        teacherName,
        studentName,
        alreadySubmitted,
        existingRating: isTeacher ? bt.teacher_rating  : bt.student_rating,
        existingNotes:  isTeacher ? bt.teacher_notes   : null,
      });
    }

    if (action === "submit") {
      const alreadySubmitted = isTeacher
        ? bt.teacher_review_submitted_at !== null
        : bt.student_review_submitted_at !== null;
      if (alreadySubmitted) return json({ error: "Review already submitted" }, 409);

      const r = Number(rating);
      if (!r || r < 1 || r > 5) return json({ error: "rating must be 1–5" }, 400);

      const updates: Record<string, unknown> = isTeacher
        ? { teacher_rating: r, teacher_notes: notes ?? null, teacher_review_submitted_at: new Date().toISOString() }
        : { student_rating: r,                               student_review_submitted_at: new Date().toISOString() };

      const { error: updErr } = await admin
        .from("Blocked_Time")
        .update(updates)
        .eq("SessionID", bt.SessionID);

      if (updErr) return json({ error: updErr.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "action must be get_session or submit" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
