import { describe, expect, it } from "vitest";
import { normalizeForMatch, normalizeInput } from "./normalize-input";

describe("normalizeInput", () => {
  it("fixes common typos and slang", () => {
    expect(normalizeInput("call mom tommorow")).toBe("call mom tomorrow");
    expect(normalizeInput("submit hw asap")).toMatch(/homework/i);
    expect(normalizeInput("gonna finish this")).toMatch(/going to/i);
  });

  it("maps romanized Urdu helpers", () => {
    expect(normalizeInput("mujhe yaad dilao kal doctor")).toMatch(/remind me to/i);
    expect(normalizeInput("aaj kya hai")).toMatch(/today/i);
  });

  it("maps Spanish helpers", () => {
    expect(normalizeInput("recuérdame pagar la renta")).toMatch(/remind me to/i);
    expect(normalizeInput("mañana")).toMatch(/tomorrow/i);
  });

  it("strips leading fillers", () => {
    expect(normalizeInput("um, remind me to stretch")).toMatch(/^remind me/i);
    expect(normalizeInput("real quick add milk")).toMatch(/^add milk/i);
  });
});

describe("normalizeForMatch", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeForMatch("Today??")).toBe("today");
  });
});
