import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkFiles, positionStats } from "../src/check.js";
import { REPO_DATA, fullQ, syllabus } from "./helpers.js";

describe("positionStats", () => {
  it("counts positions per subject and flags >40% only with enough questions", () => {
    const skewed = Array.from({ length: 30 }, () => fullQ({ answer: 0 }));
    const s = positionStats(skewed)[3]!;
    expect(s.counts).toEqual([30, 0, 0, 0]);
    expect(s.flagged).toBe(true);
    const even = Array.from({ length: 28 }, (_, i) => fullQ({ answer: (i % 4) as 0 }));
    expect(positionStats(even)[3]!.flagged).toBe(false);
    expect(positionStats([fullQ({ answer: 0 }), fullQ({ answer: 0 })])[3]!.flagged).toBe(false);
  });
});

describe("checkFiles", () => {
  it("passes on the shipped sample.json (copied to a temp dir; never reads the live data/questions)", async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), "chk-sample-"));
    await fs.copyFile(path.join(REPO_DATA, "questions", "sample.json"), path.join(d, "sample.json"));
    const r = await checkFiles(d, syllabus());
    expect(r.errors).toEqual([]);
    expect(r.files).toEqual([{ file: "sample.json", count: 6 }]);
  });

  it("reports invalid questions, cross-file duplicate ids and wrong-subject files", async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), "chk-"));
    const good = fullQ({ id: "L23301-001" });
    await fs.writeFile(path.join(d, "subject-3.json"), JSON.stringify([good, { ...fullQ(), answer: 9 }]));
    await fs.writeFile(path.join(d, "subject-1.json"), JSON.stringify([{ ...good, stem: "另一題的題幹" }]));
    const r = await checkFiles(d, syllabus());
    const text = r.errors.join("\n");
    expect(text).toMatch(/subject-3\.json.*answer/s);
    expect(text).toMatch(/subject-1\.json/); // dup id + subject 3 question in subject-1 file
  });
});
