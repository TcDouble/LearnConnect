// supabase/functions/create-meeting/jitsi.ts
//
// Jitsi (8x8 JaaS) provider: creates a unique room and signs a JWT join URL.
//
// Required secrets:
//   JAAS_KID             — API Key ID from the JaaS console (vpaas-magic-cookie-XXXX/keyid)
//   JAAS_PRIVATE_KEY_B64 — JaaS private key (.pk PEM) base64-encoded into one line
// Optional:
//   JAAS_APP_ID    — defaults to the value below (AppID is not secret; it's in every room URL)
//   JITSI_BASE_URL — defaults to https://8x8.vc

import type { MeetingProvider, MeetingRequest, MeetingRoom } from "./config.ts";

// AppID isn't secret (it's in every meeting URL), so default to it if the secret is unset.
const APP_ID    = Deno.env.get("JAAS_APP_ID") ?? "vpaas-magic-cookie-c582ad93426244a8beaaf98f6f0efd45";
const KID       = Deno.env.get("JAAS_KID");
const PK_B64    = Deno.env.get("JAAS_PRIVATE_KEY_B64");
const JAAS_BASE = Deno.env.get("JITSI_BASE_URL") ?? "https://8x8.vc";

function b64urlStr(s: string): string {
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function b64urlBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function privateKeyDer(b64Pem: string): Uint8Array {
  const pem = atob(b64Pem);
  const body = pem
    .split("-----BEGIN PRIVATE KEY-----").join("")
    .split("-----END PRIVATE KEY-----").join("")
    .split("\n").join("").split("\r").join("").split(" ").join("").trim();
  const der = atob(body);
  const out = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) out[i] = der.charCodeAt(i);
  return out;
}
async function signJwt(header: unknown, payload: unknown, der: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8", der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
  const signingInput = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64urlBytes(new Uint8Array(sig))}`;
}

export const provider: MeetingProvider = {
  name: "jitsi",

  async createRoom(req: MeetingRequest): Promise<MeetingRoom> {
    if (!APP_ID || !KID || !PK_B64) {
      const missing = [!APP_ID && "JAAS_APP_ID", !KID && "JAAS_KID", !PK_B64 && "JAAS_PRIVATE_KEY_B64"]
        .filter(Boolean).join(", ");
      throw new Error(`JaaS secrets missing: ${missing}.`);
    }

    const room = `Radiance-${crypto.randomUUID()}`;
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", kid: KID, typ: "JWT" };
    const payload = {
      aud: "jitsi", iss: "chat", sub: APP_ID, room,
      iat: now, nbf: now - 60, exp: now + 3 * 60 * 60,
      context: {
        user: {
          id: crypto.randomUUID(),
          name: req.tutorName || "Radiance participant",
          email: req.tutorEmail,
          avatar: "",
          moderator: true,
        },
        features: { livestreaming: true, recording: true, transcription: true, "outbound-call": true },
      },
    };
    const token = await signJwt(header, payload, privateKeyDer(PK_B64));
    const base = JAAS_BASE.endsWith("/") ? JAAS_BASE.slice(0, -1) : JAAS_BASE;

    return {
      meetingUrl: `${base}/${APP_ID}/${room}?jwt=${token}`,
      roomName: room,
    };
  },
};
