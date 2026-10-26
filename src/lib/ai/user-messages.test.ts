import { describe, expect, it } from "vitest";
import {
  friendlyFailure,
  friendlyRequestError,
  humanizeError,
  looksTechnical,
} from "./user-messages";

describe("humanizeError", () => {
  it("maps common technical failures to plain language", () => {
    expect(humanizeError("JavaScript TypeError: Cannot read properties of undefined.")).toMatch(
      /something went wrong/i
    );
    expect(humanizeError("The API request returned a 500 status code.")).toMatch(/try again/i);
    expect(humanizeError("Your database query failed.")).toMatch(/couldn't retrieve|save/i);
    expect(humanizeError("Project write could not be verified.")).toMatch(/couldn't confirm/i);
  });

  it("keeps already-friendly messages", () => {
    expect(humanizeError("I couldn't find that task.")).toBe("I couldn't find that task.");
  });

  it("does not invent a specific cause for unknown errors", () => {
    const message = humanizeError("xyzzy-unexpected-blob");
    expect(message.toLowerCase()).not.toContain("database");
    expect(message.toLowerCase()).not.toContain("api");
  });
});

describe("friendlyFailure", () => {
  it("states the action failed without echoing raw diagnostics as the headline", () => {
    const message = friendlyFailure("delete that", "database rejected the delete");
    expect(message.toLowerCase()).toContain("couldn't");
    expect(message.toLowerCase()).not.toContain("database rejected");
    expect(message.toLowerCase()).toContain("nothing was");
  });
});

describe("friendlyRequestError", () => {
  it("never claims the request was saved", () => {
    expect(friendlyRequestError(new Error("fetch failed")).toLowerCase()).toMatch(
      /haven't saved|haven't.*changed|nothing/
    );
  });
});

describe("looksTechnical", () => {
  it("detects stack-like and status-code text", () => {
    expect(looksTechnical("TypeError: boom")).toBe(true);
    expect(looksTechnical("Your task has been updated.")).toBe(false);
  });
});
