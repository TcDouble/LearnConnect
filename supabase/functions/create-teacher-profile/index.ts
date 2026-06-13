// Edge Function: create-teacher-profile
// Creates (or updates) the caller's row in public."Teachers", and optionally sets
// the teacher's phone_number on public."Users".
// Auth: requires a logged-in user. The user's JWT is forwarded to Supabase so the
// existing "Teacher can insert own row" / "Users can update own row" RLS policies apply.
//
// POST body (all optional except an authenticated user):
//   { subject_list?: string[], years_experience?: number, phone_number?: string }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

    // Client scoped to the caller's JWT so RLS runs as that user.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const {
      subject_list = [],
      years_experience = 0,
      phone_number = null,
    } = body ?? {};

    const { data: teacher, error: teacherError } = await supabase
      .from("Teachers")
      .upsert(
        {
          UID: user.id,
          subject_list: Array.isArray(subject_list) ? subject_list : [],
          years_experience: Number(years_experience) || 0,
        },
        { onConflict: "UID" },
      )
      .select()
      .single();

    if (teacherError) return jsonResponse({ error: teacherError.message }, 400);

    // Phone lives on the shared Users row, not Teachers.
    if (phone_number) {
      const { error: userUpdateError } = await supabase
        .from("Users")
        .update({ phone_number })
        .eq("UID", user.id);
      if (userUpdateError) {
        return jsonResponse({ error: userUpdateError.message }, 400);
      }
    }

    return jsonResponse({ teacher }, 200);
  } catch (e) {
    return jsonResponse(
      { error: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
