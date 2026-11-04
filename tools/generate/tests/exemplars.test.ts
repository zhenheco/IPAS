import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_EXEMPLARS, loadOfficial, requireExemplars, selectExemplars } from "../src/exemplars.js";
import { fullQ, syllabus } from "./helpers.js";

const off = (item: string, n: number) => fullQ({ id: `OFF-115-1-S3-${n}`, item, source: "official" });
const pool = [
  ...Array.from({ length: 5 }, (_, i) => off("L23101", i + 1)), // topic L231
  ...Array.from({ length: 5 }, (_, i) => off("L23102", i + 6)), // topic L231
  ...Array.from({ length: 10 }, (_, i) => off("L23201", i + 11)), // topic L232
];
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]!; };

describe("selectExemplars", () => {
  it("returns 6..8 questions, no duplicates", () => {
    for (const r of [0, 0.34, 0.67, 0.99]) {
      const s = selectExemplars(pool, "L231", () => r);
      expect(s.length).toBeGreaterThanOrEqual(6);
      expect(s.length).toBeLessThanOrEqual(8);
      expect(new Set(s.map((q) => q.id)).size).toBe(s.length);
    }
  });
  it("takes the 評鑑主題's own questions first, then tops up from the rest of the subject", () => {
    const s = selectExemplars(pool, "L231", () => 0); // n = 6; the topic has 10
    expect(s.every((q) => q.item.startsWith("L231"))).toBe(true);
    const few = [off("L23101", 1), off("L23101", 2), ...pool.slice(10)];
    const t = selectExemplars(few, "L231", () => 0);
    expect(t).toHaveLength(6);
    expect(t.slice(0, 2).map((q) => q.item)).toEqual(["L23101", "L23101"]);
    expect(t.slice(2).every((q) => q.item.startsWith("L232"))).toBe(true);
  });
  it("rotates: different rng draws give different samples", () => {
    const a = selectExemplars(pool, "L232", seq(0.1, 0.9, 0.3, 0.7, 0.5)).map((q) => q.id).join();
    const b = selectExemplars(pool, "L232", seq(0.8, 0.2, 0.6, 0.4, 0.05)).map((q) => q.id).join();
    expect(a).not.toBe(b);
  });
  it("uses everything when fewer than 6 exist, and nothing when there are none", () => {
    expect(selectExemplars(pool.slice(0, 3), "L231", () => 0.5)).toHaveLength(3);
    expect(selectExemplars([], "L231")).toEqual([]);
  });
});

describe("loadOfficial", () => {
  it("reads <exam>-s<N>.json files of the subject and ignores everything else", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "off-"));
    await fs.writeFile(path.join(dir, "115-1-s3.json"), JSON.stringify([off("L23101", 1), fullQ({ subject: 1, item: "L21101", id: "OFF-x", source: "official" })]));
    await fs.writeFile(path.join(dir, "114-2-s3.json"), JSON.stringify([off("L23102", 2)]));
    await fs.writeFile(path.join(dir, "115-1-s3.json.partial"), JSON.stringify([off("L23103", 3)]));
    await fs.mkdir(path.join(dir, "raw"));
    expect((await loadOfficial(dir, 3)).map((q) => q.id).sort()).toEqual(["OFF-115-1-S3-1", "OFF-115-1-S3-2"]);
  });
  it("is empty when the directory does not exist", async () => expect(await loadOfficial("/nonexistent-dir-x", 3)).toEqual([]));
  it("fails loudly on a corrupt official file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "off-"));
    await fs.writeFile(path.join(dir, "115-1-s3.json"), "{oops");
    await expect(loadOfficial(dir, 3)).rejects.toThrow(/115-1-s3\.json/);
  });
});

describe("requireExemplars (generation must not run uncalibrated)", () => {
  const six = Array.from({ length: 6 }, (_, i) => off("L23101", i + 1));
  it("needs at least 6 valid official questions of the subject", () => {
    expect(MIN_EXEMPLARS).toBe(6);
    expect(requireExemplars(six, syllabus(), 3)).toHaveLength(6);
    expect(() => requireExemplars(six.slice(0, 5), syllabus(), 3)).toThrow(/at least 6.*found 5.*import-official/s);
    expect(() => requireExemplars([], syllabus(), 3)).toThrow(/found 0/);
  });
  it("does not count other subjects, invalid questions or duplicates", () => {
    const otherSubject = fullQ({ id: "OFF-x-1", subject: 1, item: "L21101", source: "official" });
    const badItem = off("L21101", 7); // subject 1 code on a subject 3 question
    const dup = { ...six[0]!, id: "OFF-115-1-S3-99" }; // same stem as an accepted one
    expect(() => requireExemplars([...six.slice(0, 5), otherSubject, badItem, dup], syllabus(), 3)).toThrow(/found 5/);
  });
});
