import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readQuestions, writeJsonAtomic } from "../src/store.js";

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "store-"));

describe("store", () => {
  it("readQuestions returns [] for a missing file", async () => {
    expect(await readQuestions(path.join(await tmp(), "nope.json"))).toEqual([]);
  });

  it("readQuestions throws on a corrupt file instead of silently starting over", async () => {
    const f = path.join(await tmp(), "bad.json");
    await fs.writeFile(f, "{not json");
    await expect(readQuestions(f)).rejects.toThrow();
  });

  it("writeJsonAtomic writes JSON, creates the directory and leaves no temp files", async () => {
    const d = path.join(await tmp(), "a", "b");
    const f = path.join(d, "q.json");
    await writeJsonAtomic(f, [{ x: 1 }]);
    expect(JSON.parse(await fs.readFile(f, "utf8"))).toEqual([{ x: 1 }]);
    expect(await fs.readdir(d)).toEqual(["q.json"]);
  });

  it("keeps the old file intact when the write fails midway", async () => {
    const d = await tmp();
    const f = path.join(d, "q.json");
    await writeJsonAtomic(f, ["old"]);
    const failing = { ...fs, rename: async () => { throw new Error("disk full"); } };
    await expect(writeJsonAtomic(f, ["new"], failing)).rejects.toThrow("disk full");
    expect(JSON.parse(await fs.readFile(f, "utf8"))).toEqual(["old"]);
    expect(await fs.readdir(d)).toEqual(["q.json"]); // temp file cleaned up
  });
});
