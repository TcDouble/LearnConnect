// Edge Function: create-teacher-profile
// Creates (or updates) the caller's row in public."Teachers" and saves bio to public."Users".
// Auth: requires a logged-in user. The user's JWT is forwarded to Supabase so
// RLS policy (auth.uid() = UID) applies.
//
// POST body (all optional except an authenticated user):
//   { subject_list?: string[], years_experience?: number, bio?: string }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
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
      bio = null,
      phone_number = null,
    } = body ?? {};

    const { data, error } = await supabase
      .from("Teachers")
      .upsert(
        {
          UID: user.id,
          subject_list: Array.isArray(subject_list) ? subject_list : [],
          years_experience: years_experience === null || years_experience === "" ? 0 : Number(years_experience),
        },
        { onConflict: "UID" },
      )
      .select()
      .single();

    if (error) return jsonResponse({ error: error.message }, 400);

    const { error: userUpdateError } = await supabase
      .from("Users")
      .update({
        is_teacher: true,
        ...(bio !== null ? { bio } : {}),
        ...(phone_number !== null && phone_number !== "" ? { phone_number } : {}),
      })
      .eq("UID", user.id);
    if (userUpdateError) return jsonResponse({ error: userUpdateError.message }, 400);

    return jsonResponse({ teacher: data }, 200);
  } catch (e) {
    return jsonResponse(
      { error: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
