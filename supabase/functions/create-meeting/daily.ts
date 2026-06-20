// supabase/functions/create-meeting/daily.ts
//
// Daily.co provider. Optionally auto-records to the cloud.
//
// Required secrets:
//   DAILY_API_KEY — from the Daily dashboard (Developers → API keys)
// Optional:
//   DAILY_ROOM_TTL_SECONDS  — how long the room stays joinable (default 3h)
//   DAILY_ENABLE_RECORDING  — set to "true" to auto-record sessions to the cloud
//
// RECORDING NOTE: cloud recording is a PAID Daily feature (the recording add-on
// on Pay-As-You-Go / Scale plans). On the free plan, setting enable_recording
// makes room creation fail with "...cannot be set to that value with your
// current plan". So recording is OFF by default and gated behind the env flag —
// flip DAILY_ENABLE_RECORDING=true once your plan supports it and it turns on
// with no code change. Recordings then appear in the Daily dashboard (Recordings)
// and via GET https://api.daily.co/v1/recordings.

import type { MeetingProvider, MeetingRequest, MeetingRoom } from "./config.ts";

const DAILY_API_KEY = Deno.env.get("DAILY_API_KEY");
const ROOM_TTL = Number(Deno.env.get("DAILY_ROOM_TTL_SECONDS") ?? "10800"); // 3h
const RECORD = Deno.env.get("DAILY_ENABLE_RECORDING") === "true";
const API = "https://api.daily.co/v1";

function authHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${DAILY_API_KEY}`,
  };
}

export const provider: MeetingProvider = {
  name: "daily",

  async createRoom(_req: MeetingRequest): Promise<MeetingRoom> {
    if (!DAILY_API_KEY) {
      throw new Error("Daily secret missing: DAILY_API_KEY.");
    }

    const room = `radiance-${crypto.randomUUID()}`;
    const now = Math.floor(Date.now() / 1000);
    const exp = now + ROOM_TTL;

    // 1) Create the room. enable_recording is only sent when the flag is on,
    //    because the free plan rejects it.
    const properties: Record<string, unknown> = {
      exp,
      enable_chat: true,
      enable_screenshare: true,
      start_video_off: false,
      start_audio_off: false,
    };
    if (RECORD) properties.enable_recording = "cloud";

    const roomRes = await fetch(`${API}/rooms`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: room, privacy: "public", properties }),
    });
    const roomData = await roomRes.json().catch(() => ({}));
    if (!roomRes.ok) {
      throw new Error(`Daily room creation failed: ${roomData?.info || roomData?.error || `status ${roomRes.status}`}`);
    }
    const base = roomData.url || `https://daily.co/${room}`;

    // 2) When recording is on, mint an owner token that auto-starts cloud
    //    recording the moment someone joins, and append it to the join URL.
    if (RECORD) {
      const tokenRes = await fetch(`${API}/meeting-tokens`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          properties: { room_name: room, is_owner: true, exp, start_cloud_recording: true },
        }),
      });
      const tokenData = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) {
        throw new Error(`Daily token creation failed: ${tokenData?.info || tokenData?.error || `status ${tokenRes.status}`}`);
      }
      return { meetingUrl: `${base}?t=${tokenData.token}`, roomName: roomData.name || room };
    }

    return { meetingUrl: base, roomName: roomData.name || room };
  },
};
