// Edge Function: complete-session
// Called by the teacher to manually mark a session as complete (e.g. for Jitsi sessions
// where there is no automatic webhook). Sends review emails to both parties.
//
// POST body: { session_id: string }
// Requires: teacher's Supabase JWT in Authorization header

import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL     = Deno.env.get("FROM_EMAIL") ?? "onboarding@resend.dev";
const APP_URL        = Deno.env.get("APP_URL") ?? "https://learn-connect-1ws424yq7-learn-connect.vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) return { to, ok: false, error: "RESEND_API_KEY not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: `LearnConnect <${FROM_EMAIL}>`, to, subject, html }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { to, ok: true } : { to, ok: false, error: data?.message };
  } catch (e) {
    return { to, ok: false, error: (e as Error).message };
  }
}

function brand(body: string) {
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px 20px">
    <p style="color:#2b7a4b;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0 0 18px">LearnConnect</p>
    ${body}
    <p style="font-size:12px;color:#94a3b8;margin-top:24px">LearnConnect · Connecting students with tutors</p>
  </div>`;
}

function reviewEmail(name: string, otherName: string, subjectText: string, reviewUrl: string, isTeacher: boolean) {
  return brand(`
    <h2 style="color:#0f3b2c;margin:0 0 12px">Session complete! 🎓</h2>
    <p style="color:#334155">Hi ${name},</p>
    <p style="color:#334155">Your <strong>${subjectText}</strong> session with <strong>${otherName}</strong> has ended.</p>
    <p style="color:#334155">${isTeacher
      ? "Please rate the session and add your session notes."
      : "We'd love to hear how it went — it only takes a minute."
    }</p>
    <a href="${reviewUrl}" style="display:block;text-align:center;background:#2b7a4b;color:#fff;padding:13px 20px;border-radius:40px;text-decoration:none;font-weight:600;margin-top:16px">
      Leave a review →
    </a>
    <p style="font-size:13px;color:#64748b;margin-top:16px">This link is unique to you.</p>
  `);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return jsonResponse({ error: "Not authenticated" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { session_id } = await req.json().catch(() => ({}));
    if (!session_id) return jsonResponse({ error: "session_id required" }, 400);

    const { data: bt } = await admin
      .from("Blocked_Time")
      .select("SessionID, SID, TID, subject, teacher_review_token, student_review_token, status")
      .eq("SessionID", session_id)
      .maybeSingle();

    if (!bt) return jsonResponse({ error: "Session not found" }, 404);
    if (bt.status === "completed") return jsonResponse({ error: "Session already completed" }, 409);

    // Verify the caller is the teacher for this session
    const { data: tch } = await admin.from("Teachers").select("UID").eq("TID", bt.TID).maybeSingle();
    if (!tch || tch.UID !== user.id) return jsonResponse({ error: "Not authorized" }, 403);

    await admin.from("Blocked_Time")
      .update({ status: "completed", ended_at: new Date().toISOString() })
      .eq("SessionID", bt.SessionID);

    // Emails
    const { data: tchUser } = await admin.from("Users").select("email, firstname, lastname").eq("UID", tch.UID).maybeSingle();
    const { data: stu }     = await admin.from("Students").select("UID").eq("SID", bt.SID).maybeSingle();
    const { data: stuUser } = stu
      ? await admin.from("Users").select("email, firstname, lastname").eq("UID", stu.UID).maybeSingle()
      : { data: null };

    const teacherName  = [tchUser?.firstname, tchUser?.lastname].filter(Boolean).join(" ") || "Teacher";
    const studentName  = [stuUser?.firstname, stuUser?.lastname].filter(Boolean).join(" ") || "Student";
    const teacherEmail = tchUser?.email ?? "";
    const studentEmail = stuUser?.email ?? "";
    const subjectText  = bt.subject || "Tutoring";

    const results = [];
    if (teacherEmail) {
      results.push(await sendEmail(
        teacherEmail,
        `Session review: ${subjectText} with ${studentName}`,
        reviewEmail(teacherName, studentName, subjectText, `${APP_URL}/post-meeting-review.html?token=${bt.teacher_review_token}`, true),
      ));
    }
    if (studentEmail) {
      results.push(await sendEmail(
        studentEmail,
        `Session review: ${subjectText} with ${teacherName}`,
        reviewEmail(studentName, teacherName, subjectText, `${APP_URL}/post-meeting-review.html?token=${bt.student_review_token}`, false),
      ));
    }

    return jsonResponse({ ok: true, results });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
