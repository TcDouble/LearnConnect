// webapp/config.js  —  FRONTEND config (loaded by meeting.html)
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │  CHANGE THIS ONE WORD to switch meeting software:  'jitsi'  or  'daily'.  │
// │  Save this file, refresh the page. No redeploy, no waiting on anyone.     │
// └──────────────────────────────────────────────────────────────────────────┘
const ACTIVE_PROVIDER = 'jitsi';   // 'jitsi' | 'daily'

// (Note: this is the BROWSER config. The server-side equivalent lives in
//  supabase/functions/create-meeting/config.ts — different file, different job.)
