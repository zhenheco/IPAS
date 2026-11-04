import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertCompleteKey, parseAnswerKey, pdfAnswerKey } from "../src/answerKey.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => fs.readFileSync(path.join(here, "fixtures", n), "utf8");
const RAW = path.resolve(here, "../../../data/official/raw");

describe("parseAnswerKey (real pdftotext -layout excerpts)", () => {
  it("reads a lone letter line before question 1 and inline 'C    2.' letters (115-1 layout)", () =>
    expect(parseAnswerKey(fixture("pdftotext-115-1-s1.txt"))).toEqual({ 1: 3, 2: 2 }));
  it("reads the tight 'D   1. stem' layout (114-2 layout), ignoring option lines", () =>
    expect(parseAnswerKey(fixture("pdftotext-114-2-s2.txt"))).toEqual({ 1: 3, 2: 1, 3: 0 }));
  it("normalises full-width letters", () => expect(parseAnswerKey("Ｂ    44.\n  stem\nＡ    45.   stem")).toEqual({ 44: 1, 45: 0 }));
  it("does not take option markers or indented stem numbering as answers", () =>
    expect(parseAnswerKey("A    1.   stem\n           (A)x；\n           2. 步驟二\n           B 與 C 比較")).toEqual({ 1: 0 }));
  it("rejects the same question number with two different letters", () =>
    expect(() => parseAnswerKey("A    7.   x\nB    7.   y")).toThrow(/question 7/));
});

// The repo is public: fixtures keep only the printed layout; their text is invented, never official exam wording.
describe("fixtures", () => {
  for (const n of ["pdftotext-114-2-s2.txt", "pdftotext-115-1-s1.txt"])
    it(`${n} is marked synthetic`, () => expect(fixture(n).split("\n")[0]).toContain("SYNTHETIC FIXTURE"));
});

describe("assertCompleteKey", () => {
  const full = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, i % 4]));
  it("accepts exactly 1..50", () => expect(() => assertCompleteKey(full, 50)).not.toThrow());
  it("names the missing numbers", () => {
    const { 17: _gone, ...rest } = full;
    expect(() => assertCompleteKey(rest, 50)).toThrow(/missing.*17/);
  });
  it("rejects numbers outside 1..50", () => expect(() => assertCompleteKey({ ...full, 51: 0 }, 50)).toThrow(/51/));
});

// Runs only where the git-ignored official PDFs exist (the owner's machine).
describe.skipIf(!fs.existsSync(RAW) || !fs.readdirSync(RAW).some((f) => f.endsWith(".pdf")))("real PDFs", () => {
  for (const f of fs.existsSync(RAW) ? fs.readdirSync(RAW).filter((x) => x.endsWith(".pdf")) : [])
    it(`${f} has a complete 1..50 answer key`, () => expect(() => assertCompleteKey(pdfAnswerKey(path.join(RAW, f)), 50)).not.toThrow());
});
