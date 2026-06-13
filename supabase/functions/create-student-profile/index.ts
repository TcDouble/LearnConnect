// Edge Function: create-student-profile
// Creates (or updates) the caller's row in public."Students".
// Auth: requires a logged-in user. The user's JWT is forwarded to Supabase so
// the existing "Student can insert own row" RLS policy (auth.uid() = UID) applies.
//
// POST body (all optional except an authenticated user):
//   { school?: string, grade_level?: string, age?: number, subject_list?: string[] }

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
      school = null,
      grade_level = null,
      age = null,
      subject_list = [],
    } = body ?? {};

    const { data, error } = await supabase
      .from("Students")
      .upsert(
        {
          UID: user.id,
          school: school || null,
          grade_level: grade_level || null,
          age: age === null || age === "" ? null : Number(age),
          subject_list: Array.isArray(subject_list) ? subject_list : [],
        },
        { onConflict: "UID" },
      )
      .select()
      .single();

    if (error) return jsonResponse({ error: error.message }, 400);
    return jsonResponse({ student: data }, 200);
  } catch (e) {
    return jsonResponse(
      { error: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
