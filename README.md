# LifePilot

AI-first personal task manager. The home route opens the assistant; tasks, checklists, projects, and calendar stay one click away.

## Local development

```bash
npm install
npm run env:setup   # copies .env.example → .env (skips if .env already exists)
npm run dev         # also runs env:setup via predev
```

Open [http://localhost:3000](http://localhost:3000). Do not open a static HTML file with Live Server — use the Next.js dev server.

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

## Environment

All keys are documented in **`.env.example`**. Local secrets go in **`.env`** (gitignored). Next.js loads `.env` automatically.

| Key | Purpose |
| --- | --- |
| `LIFEPILOT_FORCE_DEMO` / `NEXT_PUBLIC_LIFEPILOT_FORCE_DEMO` | Demo Create account / Sign in via `/api/auth` |
| `LIFEPILOT_SESSION_SECRET` | Signs session cookies |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Real auth (set FORCE_DEMO to false) |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Cloud AI (optional; local agent otherwise) |

## Sign-in

The app always opens on **Sign in / Create account**. New accounts start with an empty board.

Without Supabase (demo mode — default in `.env.example`):
- Locally: `.demo-users.json` + `.demo-data/`
- On Netlify: Netlify Blobs + signed roster cookie

With Supabase configured and FORCE_DEMO off, auth and data use your project.

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
