// meeting maker test/config.ts  (server-side)
//
// Two jobs:
//   1. Defines the shared MeetingProvider interface that jitsi.ts and daily.ts
//      implement — that's what makes them interchangeable.
//   2. getProvider() maps a provider name to its implementation.
//
// The CHOICE of provider is NOT here — it lives in config.js (the browser) and
// arrives with each request. This file only knows how to build each provider.

import { provider as jitsi } from "./jitsi.ts";  // 8x8 JaaS — needs JAAS_* secrets
import { provider as daily } from "./daily.ts";  // Daily.co — needs DAILY_API_KEY

// ── Shared contract every provider conforms to ───────────────────────────────
export interface MeetingRequest {
  tutorName?: string;
  tutorEmail: string;
  studentName?: string;
  studentEmail: string;
  sessionDate: string;
  sessionTime: string;
  subject?: string;
}

export interface MeetingRoom {
  meetingUrl: string;
  roomName: string;
}

export interface MeetingProvider {
  name: string;
  createRoom(req: MeetingRequest): Promise<MeetingRoom>;
}

// ── Provider lookup ──────────────────────────────────────────────────────────
const PROVIDERS: Record<string, MeetingProvider> = { jitsi, daily };

// Maps the requested name (sent by config.js) to its implementation.
export function getProvider(requested?: string): MeetingProvider {
  const choice = (requested ?? "").toLowerCase().trim();
  const provider = PROVIDERS[choice];
  if (!provider) {
    throw new Error(`Unknown or missing provider "${choice}". Send "jitsi" or "daily".`);
  }
  return provider;
}
