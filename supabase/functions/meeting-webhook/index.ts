// Edge Function: meeting-webhook
// Receives Daily.co webhook events (verify_jwt: false — Daily posts without a Supabase JWT).
// On meeting.ended: marks Blocked_Time row as completed and sends review emails to both parties.
//
// Required secrets:
//   DAILY_WEBHOOK_SECRET — from Daily dashboard → Developers → Webhooks (used to verify HMAC)
//   RESEND_API_KEY, FROM_EMAIL — same as create-meeting
//   APP_URL — base URL of the webapp (e.g. https://learn-connect-xxx.vercel.app)
//
// Manual setup (one-time):
//   1. Daily dashboard → Developers → Webhooks → Add webhook
//   2. URL: https://voqpgofzhuuzlensefxm.supabase.co/functions/v1/meeting-webhook
//   3. Event: meeting.ended
//   4. Copy webhook secret → add as DAILY_WEBHOOK_SECRET in Supabase project secrets

import { createClient } from "jsr:@supabase/supabase-js@2";

const DAILY_WEBHOOK_SECRET = Deno.env.get("DAILY_WEBHOOK_SECRET");
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL           = Deno.env.get("FROM_EMAIL") ?? "onboarding@resend.dev";
const APP_URL              = Deno.env.get("APP_URL") ?? "https://learn-connect-1ws424yq7-learn-connect.vercel.app";

async function verifySignature(body: string, header: string | null): Promise<boolean> {
  // If no secret configured, skip check (dev / test mode)
  if (!DAILY_WEBHOOK_SECRET) return true;
  if (!header?.startsWith("sha256=")) return false;
  const receivedHex = header.slice("sha256=".length);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(DAILY_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const computedHex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  return computedHex === receivedHex;
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

async function sendReviewEmails(
  admin: ReturnType<typeof createClient>,
  bt: { SessionID: string; TID: string; SID: string; subject: string; teacher_review_token: string; student_review_token: string },
) {
  const { data: tch } = await admin.from("Teachers").select("UID").eq("TID", bt.TID).maybeSingle();
  const { data: tchUser } = tch
    ? await admin.from("Users").select("email, firstname, lastname").eq("UID", tch.UID).maybeSingle()
    : { data: null };
  const { data: stu } = await admin.from("Students").select("UID").eq("SID", bt.SID).maybeSingle();
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
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const rawBody = await req.text();

  if (!await verifySignature(rawBody, req.headers.get("x-daily-signature"))) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  if (event.type !== "meeting.ended") {
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const props       = (event.properties as Record<string, unknown>) ?? {};
  const roomName    = props.room_name as string | undefined;
  const durationSec = props.duration as number | undefined;
  const startTime   = props.start_time as number | undefined;
  const actualMins  = durationSec != null
    ? Math.round(durationSec / 60)
    : startTime != null
      ? Math.round((Date.now() / 1000 - startTime) / 60)
      : null;

  if (!roomName) {
    return new Response(JSON.stringify({ error: "room_name missing" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: bt } = await admin
    .from("Blocked_Time")
    .select("SessionID, SID, TID, subject, teacher_review_token, student_review_token, status")
    .ilike("meeting_url", `%/${roomName}%`)
    .eq("meeting_provider", "daily")
    .neq("status", "completed")
    .maybeSingle();

  if (!bt) {
    return new Response(JSON.stringify({ ok: true, msg: "session not found or already completed" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const updatePayload: Record<string, unknown> = {
    status: "completed",
    ended_at: new Date().toISOString(),
  };
  if (actualMins != null) updatePayload.actual_duration_minutes = actualMins;

  await admin.from("Blocked_Time").update(updatePayload).eq("SessionID", bt.SessionID);

  const results = await sendReviewEmails(admin, bt);

  return new Response(JSON.stringify({ ok: true, results }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
