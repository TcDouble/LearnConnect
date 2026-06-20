// Edge Function: send-session-email
// Sends notification or reminder emails for a Blocked_Time session.
//
// POST body: { type: 'confirmation' | 'reminder', session_id: string }
//   confirmation — student is emailed when their request is accepted (no meeting room)
//   reminder     — both parties are emailed when session is starting soon
//
// Uses RESEND_API_KEY + FROM_EMAIL (same env vars as create-meeting).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL     = Deno.env.get("FROM_EMAIL") ?? "onboarding@resend.dev";

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) return { to, ok: false, error: "RESEND_API_KEY not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: `LearnConnect <${FROM_EMAIL}>`, to, subject, html }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { to, ok: true, id: data?.id } : { to, ok: false, error: data?.message };
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

function confirmationHtml(studentName: string, teacherName: string, subject: string, when: string) {
  return brand(`
    <h2 style="color:#0f3b2c;margin:0 0 12px">Session confirmed! 🎉</h2>
    <p style="color:#334155">Hi ${studentName},</p>
    <p style="color:#334155"><strong>${teacherName}</strong> has accepted your tutoring request.</p>
    <div style="background:#dcfce7;border-radius:12px;padding:16px;margin:16px 0;color:#0f3b2c">
      📚 <strong>${subject}</strong><br>
      📅 <strong>${when}</strong>
    </div>
    <p style="font-size:13px;color:#64748b">Log in to LearnConnect to view your session details. You'll receive a reminder before it starts.</p>
  `);
}

function reminderHtml(name: string, otherName: string, role: string, subject: string, when: string, mins: number, meetingUrl: string | null) {
  const joinBtn = meetingUrl
    ? `<a href="${meetingUrl}" style="display:block;text-align:center;background:#2b7a4b;color:#fff;padding:13px 20px;border-radius:40px;text-decoration:none;font-weight:600;margin-top:16px">Join session →</a>`
    : "";
  return brand(`
    <h2 style="color:#0f3b2c;margin:0 0 12px">Starting in ${mins} minute${mins === 1 ? "" : "s"}! ⏰</h2>
    <p style="color:#334155">Hi ${name},</p>
    <p style="color:#334155">Your session with <strong>${otherName}</strong> (your ${role}) is coming up soon.</p>
    <div style="background:#fef9c3;border-radius:12px;padding:16px;margin:16px 0;color:#0f3b2c">
      📚 <strong>${subject}</strong><br>
      📅 <strong>${when}</strong>
    </div>
    ${joinBtn}
    <p style="font-size:13px;color:#64748b">Log in to LearnConnect to join your session.</p>
  `);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

    // Verify caller is authenticated
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return jsonResponse({ error: "Not authenticated" }, 401);

    // Admin client to read any row regardless of RLS
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { type, session_id } = await req.json().catch(() => ({}));
    if (!session_id) return jsonResponse({ error: "session_id required" }, 400);
    if (type !== "confirmation" && type !== "reminder") return jsonResponse({ error: "type must be confirmation or reminder" }, 400);

    // Fetch session row
    const { data: bt } = await admin
      .from("Blocked_Time")
      .select("date, starttime, subject, meeting_url, SID, TID")
      .eq("SessionID", session_id)
      .maybeSingle();
    if (!bt) return jsonResponse({ error: "Session not found" }, 404);

    // Fetch student user
    const { data: stu } = await admin.from("Students").select("UID").eq("SID", bt.SID).maybeSingle();
    const { data: stuUser } = stu
      ? await admin.from("Users").select("email, firstname, lastname").eq("UID", stu.UID).maybeSingle()
      : { data: null };

    // Fetch teacher user
    const { data: tch } = await admin.from("Teachers").select("UID").eq("TID", bt.TID).maybeSingle();
    const { data: tchUser } = tch
      ? await admin.from("Users").select("email, firstname, lastname").eq("UID", tch.UID).maybeSingle()
      : { data: null };

    const studentName  = [stuUser?.firstname, stuUser?.lastname].filter(Boolean).join(" ") || "Student";
    const teacherName  = [tchUser?.firstname, tchUser?.lastname].filter(Boolean).join(" ") || "Teacher";
    const studentEmail = stuUser?.email ?? "";
    const teacherEmail = tchUser?.email ?? "";
    const subject      = bt.subject || "Tutoring";
    const meetingUrl   = bt.meeting_url ?? null;

    // Format time (UTC label so it's timezone-neutral in the email)
    let when = `${bt.date} at ${(bt.starttime ?? "").slice(0, 5)} UTC`;
    try {
      const dt = new Date(`${bt.date}T${(bt.starttime ?? "00:00").slice(0, 5)}:00Z`);
      when = dt.toLocaleString("en-US", {
        weekday: "long", month: "long", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
      });
    } catch (_) { /* keep plain fallback */ }

    const results: unknown[] = [];

    if (type === "confirmation") {
      if (studentEmail) {
        results.push(await sendEmail(
          studentEmail,
          `Session confirmed: ${subject} with ${teacherName}`,
          confirmationHtml(studentName, teacherName, subject, when),
        ));
      }
    } else {
      // reminder — email both parties
      const now     = new Date();
      const startDt = new Date(`${bt.date}T${(bt.starttime ?? "00:00").slice(0, 5)}:00Z`);
      const mins    = Math.max(1, Math.round((startDt.getTime() - now.getTime()) / 60000));

      if (studentEmail) {
        results.push(await sendEmail(
          studentEmail,
          `Reminder: ${subject} in ${mins} min`,
          reminderHtml(studentName, teacherName, "tutor", subject, when, mins, meetingUrl),
        ));
      }
      if (teacherEmail) {
        results.push(await sendEmail(
          teacherEmail,
          `Reminder: ${subject} in ${mins} min`,
          reminderHtml(teacherName, studentName, "student", subject, when, mins, meetingUrl),
        ));
      }
    }

    return jsonResponse({ ok: true, results });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
