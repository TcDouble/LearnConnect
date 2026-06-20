// supabase/functions/create-meeting/index.ts
//
// Supabase Edge Function: create-meeting
// 1. Creates a unique video room via the selected provider and returns a join URL.
// 2. Emails the join link to the tutor and student via Resend (best-effort).
//
// The meeting provider is chosen by the frontend (meeting.html sends a `provider`
// field). config.ts resolves it via the MeetingProvider interface; ACTIVE there
// is just the fallback. Switching happens in meeting.html — no redeploy.
import { getProvider } from "./config.ts";

// Common secrets (provider-specific secrets live in jitsi.ts / daily.ts):
//   RESEND_API_KEY — Resend API key (re_...)
// Optional:
//   FROM_EMAIL     — defaults to onboarding@resend.dev (Resend's shared test sender)
//
// NOTE (Resend test mode): with no verified domain, Resend only delivers to YOUR Resend
// account email. Emails to other addresses come back as an error (handled best-effort).
//
// Deploy:  supabase functions deploy create-meeting --no-verify-jwt

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL     = Deno.env.get("FROM_EMAIL") ?? "onboarding@resend.dev";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function emailHtml(name: string, other: string, when: string, url: string): string {
  return `<div style='font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px'><p style='color:#4f46e5;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase'>Radiance Learning</p><h2 style='color:#1a1a2e'>Hi ${name},</h2><p style='color:#4a4a6a'>Your session with <strong>${other}</strong> is confirmed.</p><p style='background:#ede9fe;padding:16px;border-radius:8px;color:#1a1a2e'>&#128197; <strong>${when}</strong></p><a href='${url}' style='display:block;text-align:center;background:#4f46e5;color:#fff;padding:14px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px'>Join session &rarr;</a><p style='font-size:13px;color:#9ca3af;margin-top:16px'>Or paste this link: ${url}</p></div>`;
}

// Sends one email and returns a per-recipient result; never throws.
async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) return { to, ok: false, error: "RESEND_API_KEY not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: `Radiance Learning <${FROM_EMAIL}>`, to, subject, html }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { to, ok: false, error: data?.message || `status ${res.status}` };
    return { to, ok: true, id: data?.id };
  } catch (e) {
    return { to, ok: false, error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const {
      tutorName, tutorEmail, studentName, studentEmail,
      sessionDate, sessionTime, subject,
      provider: providerChoice,   // which provider the frontend selected
    } = await req.json().catch(() => ({}));

    if (!tutorEmail || !studentEmail || !sessionDate || !sessionTime) {
      return json({ error: "Missing required fields (emails, date, time)." }, 400);
    }

    // 1) Resolve the provider (frontend's choice; else config.ts ACTIVE) and create the room.
    const provider = getProvider(providerChoice);
    const { meetingUrl, roomName } = await provider.createRoom({
      tutorName, tutorEmail, studentName, studentEmail, sessionDate, sessionTime, subject,
    });

    // 2) Best-effort email to both parties (link is returned regardless of email outcome).
    const subj = subject || "General";
    let when = `${sessionDate} at ${sessionTime}`;
    try {
      when = new Date(`${sessionDate}T${sessionTime}`).toLocaleString("en-US", {
        weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
      });
    } catch (_) { /* keep the plain fallback */ }

    const tName = tutorName || "Tutor";
    const sName = studentName || "Student";
    const emailResults = await Promise.all([
      sendEmail(tutorEmail,   `${subj} session with ${sName} — ${when}`, emailHtml(tName, `${sName} (your student)`, when, meetingUrl)),
      sendEmail(studentEmail, `${subj} session with ${tName} — ${when}`, emailHtml(sName, `${tName} (your tutor)`,   when, meetingUrl)),
    ]);

    return json({
      provider: provider.name,
      meetingUrl,
      roomName,
      sessionDate, sessionTime, subject: subj,
      emailResults,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
