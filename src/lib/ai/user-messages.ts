/**
 * Turns technical failures into short, everyday language for ordinary users.
 * Keeps the wording honest: never invents a cause that was not in the error.
 */

const PATTERNS: { test: RegExp; message: string }[] = [
  {
    test: /rate limit|too many requests|429/i,
    message: "I'm getting a lot of requests right now. Please try again in a minute.",
  },
  {
    test: /timeout|timed out|ETIMEDOUT|AbortError|aborted/i,
    message: "That took too long, so I stopped waiting. Please try again.",
  },
  {
    test: /network|fetch failed|Failed to fetch|ECONNREFUSED|ENOTFOUND|offline/i,
    message: "I couldn't reach the service. Check your connection and try again.",
  },
  {
    test: /401|unauthorized|not authenticated|sign in|jwt|session/i,
    message: "You're not signed in right now. Please sign in and try again.",
  },
  {
    test: /403|forbidden|permission|not allowed/i,
    message: "You don't have permission to do that.",
  },
  {
    test: /404|not found/i,
    message: "I couldn't find that item. It may have already been removed.",
  },
  {
    test: /validation|invalid|zod|parse/i,
    message: "Some of the details weren't in a form I could use. Please try again with clearer details.",
  },
  {
    test: /openai|api key|insufficient_quota|billing|model_not_found/i,
    message: "The AI service isn't available right now. Please try again later.",
  },
  {
    test: /500|502|503|internal server|service unavailable/i,
    message: "The service ran into a problem and couldn't finish your request. Please try again in a moment.",
  },
  {
    test: /EROFS|EACCES|read-?only file system/i,
    message:
      "This hosted site can't save demo data to disk. Actions should work after the latest deploy; for lasting accounts, add Supabase env vars on Netlify.",
  },
  {
    test: /database|postgres|supabase|query failed|PGRST|relation |column /i,
    message: "I couldn't retrieve or save your information, so I haven't completed your request yet.",
  },
  {
    test: /TypeError|Cannot read propert|undefined is not|null is not|ReferenceError|SyntaxError/i,
    message: "Something went wrong while loading this information. Please try again.",
  },
  {
    test: /could not be verified|couldn'?t be verified|verification failed/i,
    message: "I couldn't confirm that the change was saved, so I'm not treating it as done.",
  },
  {
    test: /requires confirmed|user_confirmed|confirmation/i,
    message: "I need your confirmation before I make that change.",
  },
  {
    test: /rejected the delete|was not deleted|still present/i,
    message: "The delete didn't go through. Nothing was removed.",
  },
  {
    test: /unknown tool|unhandled tool/i,
    message: "I don't support that action yet.",
  },
  {
    test: /nothing to undo/i,
    message: "There's nothing to undo in this conversation.",
  },
];

/** True when the text looks like a raw technical error rather than a user sentence. */
export function looksTechnical(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (/^(Error|TypeError|ReferenceError|SyntaxError|ZodError)\b/.test(value)) return true;
  if (/\b(status code|ECONN|ETIMEDOUT|PGRST|stack|at\s+\S+\s+\()/i.test(value)) return true;
  if (/\/(Users|home|var\/|src\/|node_modules)\//.test(value)) return true;
  if (/\b(API|HTTP|SQL|JSON|undefined|null)\b/.test(value) && value.length < 160) return true;
  return false;
}

/**
 * Map a technical error string to a plain-language explanation.
 * If the text is already friendly, return it unchanged.
 */
export function humanizeError(raw?: string | null): string {
  const text = (raw ?? "").trim();
  if (!text) {
    return "Something went wrong, and I couldn't finish your request.";
  }

  for (const entry of PATTERNS) {
    if (entry.test.test(text)) return entry.message;
  }

  // Soften common tool phrases without inventing a new cause.
  if (/could not be verified|couldn'?t be verified/i.test(text)) {
    return "I couldn't confirm that the change was saved, so I'm not treating it as done.";
  }
  if (/\bnot found\b/i.test(text) && text.length < 80) {
    return "I couldn't find that item. It may have already been removed.";
  }

  if (looksTechnical(text)) {
    return "Something went wrong while handling your request. Please try again. If it keeps happening, I can help you sort it out.";
  }

  return text;
}

/** Friendly failure after a named action did not complete. */
export function friendlyFailure(action: string, error?: string | null): string {
  const detail = humanizeError(error);
  const base = `I couldn't ${action}.`;
  if (!error) {
    return `${base} Nothing was changed. I can help you try again.`;
  }
  // Avoid doubling "I couldn't…" when humanize already starts that way.
  if (detail.toLowerCase().startsWith("i couldn't") || detail.toLowerCase().startsWith("i could not")) {
    return `${detail} Nothing was changed.`;
  }
  return `${base} ${detail} Nothing was changed.`;
}

/** Client/network/API errors shown in the chat. */
export function friendlyRequestError(error: unknown): string {
  if (error instanceof Error) {
    return `${humanizeError(error.message)} I haven't saved or changed anything based on this request.`;
  }
  return "Something went wrong and I couldn't complete your request. I haven't saved or changed anything.";
}

/** Short status when the user stops generation. */
export function interruptedMessage(hadText: boolean): string {
  if (hadText) {
    return "\n\n(I stopped here because you asked me to.)";
  }
  return "I stopped before finishing. Nothing new was saved from this reply.";
}
