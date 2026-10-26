/** Progressive reveal helpers for ChatGPT-style typing when live tokens are unavailable. */

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function nextChunkEnd(text: string, from: number): number {
  if (from >= text.length) return text.length;
  const remaining = text.slice(from);
  // Prefer whole words; fall back to a short character run for dense text.
  const word = remaining.match(/^(\s*\S+\s*)/);
  if (word && word[0].length <= 28) {
    return from + word[0].length;
  }
  const size = Math.min(8, remaining.length);
  return from + size;
}

/**
 * Reveal `full` progressively via `onUpdate`. Respects reduced motion and abort.
 * Never invents text — only reveals substrings of `full`.
 */
export async function revealText(
  full: string,
  onUpdate: (partial: string) => void,
  options?: { signal?: AbortSignal; msPerChunk?: number }
): Promise<"complete" | "aborted"> {
  const signal = options?.signal;
  if (!full) {
    onUpdate("");
    return "complete";
  }
  if (prefersReducedMotion() || signal?.aborted) {
    onUpdate(full);
    return signal?.aborted ? "aborted" : "complete";
  }

  const delay = options?.msPerChunk ?? 16;
  let index = 0;
  while (index < full.length) {
    if (signal?.aborted) {
      onUpdate(full.slice(0, index));
      return "aborted";
    }
    index = nextChunkEnd(full, index);
    onUpdate(full.slice(0, index));
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, delay);
    });
  }
  onUpdate(full);
  return "complete";
}
