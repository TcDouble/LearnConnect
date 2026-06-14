# LearnConnect — webapp

A working build of the LearnConnect tutoring app (cloned from `public/design/` and wired to
Supabase). Project ref `voqpgofzhuuzlensefxm`.

## Pages & flow

```
Homepage → signup.html        (single signup form; auth.signUp + default role metadata)
         → "check your email" screen if confirmation is ON, otherwise straight to setup
         → confirm email → student-login.html (signInWithPassword)
         → login routes by is_student / is_teacher + preferredDashboard:
             no Students AND no Teachers row → Profile-setup.html (merged page)
             one persona                     → that dashboard
             both personas, no preference    → inline dashboard picker on login
             both personas, with preference  → preferred dashboard
```

## What's connected to Supabase

- **Auth:** `signUp` (with `firstname/lastname/role` metadata; the `handle_new_user` trigger
  creates the `Users` row) and `signInWithPassword`. Email confirmation is **ON**.
- **Profile setup → Edge Functions:** `Profile-setup.html` calls `create-student-profile`,
  `Profile-setup.html` calls `create-teacher-profile` (Bearer session token).
- **Student dashboard:**
  - Browse teachers via the `list_teachers()` RPC.
  - "Request session" inserts a row into `Blocked_Time` (status `waiting for teacher`).
  - My teachers / sessions / stats come from the `my_sessions()` RPC.
  - Edit profile writes `Users` (name) + `Students` (grade, subjects).
- **Teacher dashboard:**
  - Students + schedule + stats from `my_sessions()`.
  - Accept / Decline incoming requests updates `Blocked_Time.status`.
  - Edit profile writes `Users` (name) + `Teachers` (subjects, years_experience).

## Backend pieces this relies on

- RPCs (SECURITY DEFINER): `list_teachers()`, `my_sessions()`.
- RLS on `Blocked_Time`: read-all, student insert-own, student update-own, teacher update-own.
- Edge Functions deployed: `create-student-profile`, `create-teacher-profile`.

## To run it

1. **Turn the redirect target on:** serve `webapp/` over a real origin (e.g. VS Code Live
   Server or `npx serve webapp`), not `file://`. Signup uses
   `emailRedirectTo = <origin>/student-login.html`, so add that origin under
   **Supabase → Authentication → URL Configuration → Redirect URLs**.
2. Sign up → check email → confirm → log in → set up profile → use the dashboard.

## Known gaps (not modelled in the current schema)

- Settings/preferences, student bio/goals, teacher bio/school, profile photos → kept in
  `localStorage` only (no columns for them).
- "Immediate" requests are stored with today's date and the current time + 1h.
- Nav links use lowercase names (`homepage.html`) while files are capitalized
  (`Homepage.html`); fine on Windows, but rename for a case-sensitive host.
