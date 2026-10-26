# LifePilot

AI-first personal task manager. The home route opens the assistant; tasks, checklists, projects, and calendar stay one click away.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Do not open `index.html` with Live Server — that file only points you at the Next.js dev server.

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
3. Build settings are already in `netlify.toml` (`npm run build`, publish `.next`). Leave the Next.js runtime / OpenNext adapter automatic — do not pin `@netlify/plugin-nextjs`.
4. Env vars: `netlify.toml` already forces **demo auth** (`LIFEPILOT_FORCE_DEMO` / `NEXT_PUBLIC_LIFEPILOT_FORCE_DEMO`) so **Create account** and **Sign in** work without Supabase.
5. Deploy via Git push to the linked repo, or:
   ```bash
   npm run build
   npx netlify deploy --prod
   ```
6. Optional env vars (Netlify UI → Site configuration → Environment variables):
   - `LIFEPILOT_SESSION_SECRET` — stable cookie signing across deploys
   - `OPENAI_API_KEY` — cloud AI (otherwise the local rule-based agent is used)
   - To switch off demo mode later: remove the FORCE_DEMO flags and set `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (run `supabase/migrations/001_initial_schema.sql`)

Site URL will be `https://<your-site>.netlify.app` (or your custom domain). There is no Vercel step in this flow.

After deploy, open `/signup`, create an account, then use `/login` — both should work in demo mode.
