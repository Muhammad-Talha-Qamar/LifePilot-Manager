# LifePilot

AI-first personal task manager. The home route opens the assistant; tasks, checklists, and calendar stay one click away.

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
- Locally and on Hostinger: `.demo-users.json` + `.demo-data/` on disk

With Supabase configured and FORCE_DEMO off, auth and data use your project.

## Deploy on Hostinger

Production: **https://lifepilot.talbyte.com**

1. Push to GitHub `main` on [LifePilot-Manager](https://github.com/Muhammad-Talha-Qamar/LifePilot-Manager).
2. Hostinger Git auto-deploy rebuilds the Next.js app on that push.
3. Production env vars are set in Hostinger Node.js environment (demo auth enabled).

After deploy, `/api/health` should return JSON (`demoMode: true`). Then open `/signup` and create an account.
