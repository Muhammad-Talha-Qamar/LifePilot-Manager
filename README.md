# LifePilot

AI-first personal task manager. The home route opens the assistant; tasks, checklists, projects, and calendar stay one click away.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Do not open a static HTML file with Live Server — use the Next.js dev server (`npm run dev`).

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

## Sign-in

The app always opens on **Sign in / Create account**. New accounts start with an empty board (no sample tasks or checklists).

Without Supabase env vars, the app runs in **demo mode**:
- Locally: accounts/data live in `.demo-users.json` + `.demo-data/`
- On Netlify: the same demo API uses **Netlify Blobs** (the function filesystem is read-only, so file writes fail with “read-only file system”)

With Supabase configured, auth and data use your project (recommended for real use).

Optional env:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (if your setup uses server-side admin APIs)
- `LIFEPILOT_SESSION_SECRET` (local account cookies)
- `OPENAI_API_KEY` (falls back to the local rule-based agent if unset)
- `OPENAI_MODEL` (default `gpt-4o-mini`)

## Deploy on Netlify

This app is set up for **Netlify**, not Vercel.

1. Push this repo to GitHub (the full LifePilot app, not only the create-next-app starter).
2. In [Netlify](https://app.netlify.com): **Add new site → Import an existing project** → choose the repo.
3. Build settings are in `netlify.toml` (`npm run build`, publish `.next`, plugin `@netlify/plugin-nextjs`).
   - In Netlify UI confirm **Plugins** includes **Essential Next.js**, and `NETLIFY_NEXT_PLUGIN_SKIP` is **not** `true`.
   - If every page shows Netlify’s “Page not found”, the Next runtime is off — API routes like `/api/auth/signup` will fail with “Something went wrong.”
4. Env vars: `netlify.toml` forces **demo auth** so **Create account** / **Sign in** work without Supabase.
5. Deploy via Git push to the linked repo (or `npx netlify deploy --prod` after `npm run build`).
6. Optional env vars (Netlify UI → Environment variables):
   - `LIFEPILOT_SESSION_SECRET` — stable cookie signing across deploys
   - `OPENAI_API_KEY` — cloud AI (otherwise the local rule-based agent is used)
   - For Supabase later: remove FORCE_DEMO flags and set `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`

After a successful deploy, `/api/health` should return JSON (`demoMode: true`). Then open `/signup` and create an account.
