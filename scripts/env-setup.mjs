#!/usr/bin/env node
/**
 * Ensures a local `.env` exists by copying `.env.example`.
 * Does not overwrite an existing `.env`.
 */
import { copyFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const example = join(root, ".env.example");
const target = join(root, ".env");

if (!existsSync(example)) {
  console.error("Missing .env.example — cannot set up env.");
  process.exit(1);
}

if (existsSync(target)) {
  console.log(".env already exists — left unchanged.");
  console.log("Edit .env for local secrets, or delete it and re-run: npm run env:setup");
  process.exit(0);
}

copyFileSync(example, target);
console.log("Created .env from .env.example");
console.log("Edit .env if you need Supabase / OpenAI keys, then restart npm run dev.");
