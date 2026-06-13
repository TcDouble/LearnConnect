# Supabase Edge Functions

Server-side functions for LearnConnect. Each subfolder is one deployable function.

| Function | Purpose | Writes to |
| --- | --- | --- |
| `create-student-profile` | Create/update the caller's student profile | `Students` |
| `create-teacher-profile` | Create/update the caller's teacher profile (+ phone) | `Teachers`, `Users.phone_number` |

`_shared/cors.ts` holds the CORS headers + a JSON response helper used by both.

## How they work

- The caller must be **authenticated**. The frontend sends the user's access token in
  the `Authorization: Bearer <token>` header.
- Each function builds a Supabase client scoped to that JWT, so all writes run under
  the user's identity and the existing **insert-own / update-own RLS policies** apply
  (no service-role key, no RLS bypass).
- The `Users` row itself is still created automatically by the `handle_new_user()`
  trigger on signup — these functions only fill in the role-specific tables.

## Deploy

With the Supabase CLI (from the project root):

```bash
supabase functions deploy create-student-profile
supabase functions deploy create-teacher-profile
```

(Or ask Claude to deploy them via the Supabase MCP `deploy_edge_function` tool.)

## Call from the browser

```js
const { data: { session } } = await supabaseClient.auth.getSession();
const res = await fetch(
  `${SUPABASE_URL}/functions/v1/create-student-profile`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      school: "Lincoln High",
      grade_level: "Year 11",
      age: 16,
      subject_list: ["Maths", "Physics"],
    }),
  },
);
const result = await res.json();
```

`create-teacher-profile` takes:
`{ subjects: string[], subject_list?: string[], years_experience: number, phone_number?: string }`
