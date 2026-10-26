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
4. Add env vars under **Site configuration → Environment variables**, then deploy.
   - **Minimum for a working demo:** none required after this Blobs-backed demo store ships.
   - **For lasting accounts / multi-device data:** set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (run `supabase/migrations/001_initial_schema.sql` on your project).
   - Optional: `OPENAI_API_KEY`, `LIFEPILOT_SESSION_SECRET`.

Site URL will be `https://<your-site>.netlify.app` (or your custom domain). There is no Vercel step in this flow.
