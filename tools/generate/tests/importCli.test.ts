import { describe, expect, it } from "vitest";
import { ALL_EXAMS, parseImportArgs, plan } from "../src/importCli.js";

describe("parseImportArgs", () => {
  it("parses a single PDF", () =>
    expect(parseImportArgs(["--pdf", "data/official/raw/115-1-s3.pdf", "--subject", "3", "--exam", "115-1"])).toEqual({ all: false, pdf: "data/official/raw/115-1-s3.pdf", subject: 3, exam: "115-1" }));
  it("parses --all", () => expect(parseImportArgs(["--all"])).toEqual({ all: true }));
  it.each([[[]], [["--pdf", "a.pdf", "--subject", "3"]], [["--pdf", "a.pdf", "--subject", "4", "--exam", "115-1"]], [["--pdf", "a.pdf", "--subject", "3", "--exam", "x"]], [["--all", "--pdf", "a.pdf"]], [["--bogus"]]])(
    "rejects %j", (argv) => expect(() => parseImportArgs(argv as string[])).toThrow());
});

describe("parseImportArgs partial/review flags", () => {
  const single = ["--pdf", "a.pdf", "--subject", "3", "--exam", "115-1"];
  it("--resume-unhashed is a bare flag, off by default", () => {
    expect(parseImportArgs([...single, "--resume-unhashed"])).toMatchObject({ all: false, resumeUnhashed: true });
    expect(parseImportArgs(single)).not.toHaveProperty("resumeUnhashed");
    expect(parseImportArgs(["--all", "--resume-unhashed"])).toEqual({ all: true, resumeUnhashed: true });
  });
  it("--approve takes the reviewed question numbers of a single job only", () => {
    expect(parseImportArgs([...single, "--approve", "7, 12"])).toMatchObject({ approve: [7, 12] });
    expect(() => parseImportArgs([...single, "--approve", "x"])).toThrow(/--approve/);
    expect(() => parseImportArgs(["--all", "--approve", "7"])).toThrow();
  });
});

describe("plan", () => {
  it("--all covers both exams × three subjects with the raw PDF names", () => {
    const jobs = plan({ all: true }, "/d");
    expect(ALL_EXAMS).toEqual(["114-2", "115-1"]);
    expect(jobs).toHaveLength(6);
    expect(jobs[0]).toEqual({ pdf: "/d/official/raw/114-2-s1.pdf", subject: 1, exam: "114-2", out: "/d/official/114-2-s1.json" });
    expect(jobs[5]).toEqual({ pdf: "/d/official/raw/115-1-s3.pdf", subject: 3, exam: "115-1", out: "/d/official/115-1-s3.json" });
  });
  it("a single job writes <exam>-s<N>.json next to raw/", () =>
    expect(plan({ all: false, pdf: "/x/y.pdf", subject: 2, exam: "115-1" }, "/d")).toEqual([{ pdf: "/x/y.pdf", subject: 2, exam: "115-1", out: "/d/official/115-1-s2.json" }]));
});
