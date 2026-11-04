import { describe, expect, it } from "vitest";
import { formatSummary, parseArgs, requireApiKey } from "../src/cli.js";

describe("requireApiKey", () => {
  it("returns the key from ANTHROPIC_API_KEY", () => expect(requireApiKey({ ANTHROPIC_API_KEY: "sk-x" })).toBe("sk-x"));
  it("fails with a clear message when missing or blank", () => {
    expect(() => requireApiKey({})).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => requireApiKey({ ANTHROPIC_API_KEY: "  " })).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("parseArgs", () => {
  it("parses subject/total with defaults", () =>
    expect(parseArgs(["--subject", "3", "--total", "300"])).toEqual({ subject: 3, total: 300, concurrency: 4 }));
  it("parses concurrency", () => expect(parseArgs(["--subject", "1", "--total", "5", "--concurrency", "2"]).concurrency).toBe(2));
  it.each([[[]], [["--subject", "4", "--total", "5"]], [["--subject", "1"]], [["--subject", "1", "--total", "0"]], [["--subject", "1", "--total", "x"]], [["--bogus"]]])(
    "rejects %j", (argv) => expect(() => parseArgs(argv as string[])).toThrow(),
  );
});

describe("formatSummary", () => {
  it("prints per-item counts, tokens and the shortfall", () => {
    const out = formatSummary({
      perItem: [{ code: "L23101", target: 5, before: 1, added: 3, dropped: 2, rounds: 2 }],
      usage: { input: 1000, output: 500 }, shortfall: 1, total: 4,
    });
    expect(out).toContain("L23101  4/5");
    expect(out).toContain("1000 in / 500 out");
    expect(out).toContain("SHORTFALL: 1");
  });
});

describe("parseArgs --variants", () => {
  it("is an alternative to --total", () =>
    expect(parseArgs(["--subject", "3", "--variants", "2"])).toMatchObject({ subject: 3, variants: 2, concurrency: 4 }));
  it("cannot be combined with --total, and one of the two is required", () => {
    expect(() => parseArgs(["--subject", "3", "--variants", "2", "--total", "10"])).toThrow(/either/);
    expect(() => parseArgs(["--subject", "3"])).toThrow(/--total or --variants/);
  });
  it("must be a positive integer", () => expect(() => parseArgs(["--subject", "3", "--variants", "0"])).toThrow());
});
