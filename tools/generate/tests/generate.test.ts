import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runGeneration } from "../src/generate.js";
import { getSubject, subjectItems } from "../src/syllabus.js";
import type { Question } from "../src/types.js";
import { fakeClient, fullQ, msg, rawQ, syllabus } from "./helpers.js";

const items = subjectItems(getSubject(syllabus(), 3)); // 12 items
const lockPath = (f: string) => path.join(path.dirname(f), ".generate.lock");
const setup = async () => path.join(await fs.mkdtemp(path.join(os.tmpdir(), "gen-")), "subject-3.json");
const read = async (f: string): Promise<Question[]> => JSON.parse(await fs.readFile(f, "utf8"));
const base = (outFile: string, client: any, over: object = {}) => ({
  client, syllabus: syllabus(), subject: 3 as const, total: 24, outFile,
  sleep: async () => {}, log: () => {}, ...over,
});
const ok = ({ count }: { count: number }) => Array.from({ length: count }, () => rawQ());

describe("runGeneration", () => {
  it("generates total/items per item, with ids, subject, item, source filled in by us", async () => {
    const f = await setup();
    const { client, stream } = fakeClient(ok);
    const r = await runGeneration(base(f, client));
    const qs = await read(f);
    expect(qs).toHaveLength(24);
    expect(stream).toHaveBeenCalledTimes(12);
    for (const it of items) expect(qs.filter((q) => q.item === it.code)).toHaveLength(2);
    expect(qs[0]).toMatchObject({ subject: 3, source: "original", id: expect.stringMatching(/^L23101-001$/) });
    expect(new Set(qs.map((q) => q.id)).size).toBe(24);
    expect(r.usage).toEqual({ input: 1200, output: 600 });
    expect(r.shortfall).toBe(0);
  });

  it("distributes the remainder to the first items", async () => {
    const f = await setup();
    const { client } = fakeClient(ok);
    await runGeneration(base(f, client, { total: 14 }));
    const qs = await read(f);
    expect(qs.filter((q) => q.item === items[0]!.code)).toHaveLength(2);
    expect(qs.filter((q) => q.item === items[1]!.code)).toHaveLength(2);
    expect(qs.filter((q) => q.item === items[2]!.code)).toHaveLength(1);
  });

  it("requests batches of at most 10", async () => {
    const f = await setup();
    const { client } = fakeClient((r) => { expect(r.count).toBeLessThanOrEqual(10); return ok(r); });
    await runGeneration(base(f, client, { total: 12 * 25 }));
    expect((await read(f)).length).toBe(300);
  });

  it("resumes: skips satisfied items and only requests the missing remainder", async () => {
    const f = await setup();
    const have = [
      ...Array.from({ length: 2 }, (_, i) => fullQ({ id: `L23101-00${i + 1}`, item: "L23101" })),
      fullQ({ id: "L23102-001", item: "L23102" }),
    ];
    await fs.writeFile(f, JSON.stringify(have));
    const seen: Record<string, number> = {};
    const { client } = fakeClient((r) => { seen[r.item] = (seen[r.item] ?? 0) + r.count; return ok(r); });
    await runGeneration(base(f, client));
    expect(seen["L23101"]).toBeUndefined();
    expect(seen["L23102"]).toBe(1);
    expect(seen["L23103"]).toBe(2);
    const qs = await read(f);
    expect(qs).toHaveLength(24);
    expect(qs.filter((q) => q.item === "L23102").map((q) => q.id)).toEqual(["L23102-001", "L23102-002"]);
  });

  it("a second run with nothing to do makes no API calls", async () => {
    const f = await setup();
    const a = fakeClient(ok);
    await runGeneration(base(f, a.client));
    const b = fakeClient(ok);
    await runGeneration(base(f, b.client));
    expect(b.stream).not.toHaveBeenCalled();
  });

  it("drops invalid and duplicate questions and re-requests the shortfall", async () => {
    const f = await setup();
    const dupStem = "重複的題幹，不可出現兩次";
    const l1counts: number[] = [];
    const { client } = fakeClient((r) => {
      if (r.item === "L23101") l1counts.push(r.count);
      if (r.item !== "L23101" || r.itemCall > 2) return ok(r);
      if (r.itemCall === 1)
        return [rawQ(), rawQ({ options: ["a", "a", "b", "c"] }), rawQ({ answer: 7 }), rawQ({ stem: dupStem }), rawQ({ stem: dupStem }),
          rawQ(), rawQ(), rawQ(), rawQ(), rawQ()];
      return ok(r);
    });
    await runGeneration(base(f, client, { total: 12 * 10 }));
    const qs = (await read(f)).filter((q) => q.item === "L23101");
    expect(qs).toHaveLength(10);
    expect(qs.filter((q) => q.stem === dupStem)).toHaveLength(1);
    expect(l1counts).toEqual([10, 3]); // 7 valid kept, 3 re-requested
  });

  it("stops an item after a bounded number of rounds when the model keeps returning garbage", async () => {
    const f = await setup();
    const { client, stream } = fakeClient(({ count }) => Array.from({ length: count }, () => rawQ({ answer: 9 })));
    const r = await runGeneration(base(f, client, { total: 12, maxRounds: 3 }));
    expect(stream).toHaveBeenCalledTimes(12 * 3);
    expect(r.shortfall).toBe(12);
  });

  it("treats malformed JSON, max_tokens and refusals as failed rounds, then recovers", async () => {
    const f = await setup();
    const { client } = fakeClient((r) => {
      if (r.item !== "L23101") return ok(r);
      if (r.itemCall === 1) return msg("{oops");
      if (r.itemCall === 2) return msg([], { stop_reason: "max_tokens" });
      if (r.itemCall === 3) return msg([], { stop_reason: "refusal", stop_details: { category: "x" } });
      return ok(r);
    });
    const r = await runGeneration(base(f, client, { total: 12 }));
    expect(r.shortfall).toBe(0);
  });

  it("retries 429/overloaded errors with backoff and still finishes", async () => {
    const f = await setup();
    let boom = 2;
    const { client, stream } = fakeClient((r) => {
      if (boom-- > 0) throw Object.assign(new Error("overloaded"), { status: 529 });
      return ok(r);
    });
    const sleeps: number[] = [];
    const r = await runGeneration(base(f, client, { total: 12, sleep: async (ms: number) => void sleeps.push(ms) }));
    expect(r.shortfall).toBe(0);
    expect(sleeps).toHaveLength(2);
    expect(stream).toHaveBeenCalledTimes(14);
  });

  it("aborts on a non-retryable error (e.g. 401) but keeps what was already saved", async () => {
    const f = await setup();
    const { client } = fakeClient((r) => {
      if (r.item === "L23102") throw Object.assign(new Error("invalid x-api-key"), { status: 401 });
      return ok(r);
    });
    await expect(runGeneration(base(f, client, { concurrency: 1 }))).rejects.toMatchObject({ status: 401 });
    expect((await read(f)).map((q) => q.item)).toEqual(["L23101", "L23101"]);
  });

  it("respects the concurrency limit", async () => {
    const f = await setup();
    let inflight = 0, max = 0;
    const { client } = fakeClient(() => { throw new Error("unused"); });
    client.beta.messages.stream = (params: any) => ({
      finalMessage: async () => {
        inflight++; max = Math.max(max, inflight);
        await new Promise((r) => setTimeout(r, 5));
        inflight--;
        const n = Number(/請產出 (\d+) 題/.exec(params.messages[0].content)![1]);
        return msg(ok({ count: n }));
      },
    });
    await runGeneration(base(f, client, { concurrency: 3 }));
    expect(max).toBe(3);
  });

  it("writes the file after every batch (never only at the end)", async () => {
    const f = await setup();
    const sizes: number[] = [];
    const { client } = fakeClient(async (r) => {
      sizes.push((await fs.readFile(f, "utf8").catch(() => "[]")).length);
      return ok(r);
    });
    // finalMessage awaits respond via async fn above
    await runGeneration(base(f, client, { total: 12, concurrency: 1 }));
    expect(sizes.length).toBe(12);
    expect(sizes.slice(1).every((s, i) => s > sizes[i]!)).toBe(true);
  });

  it("lets the model see already-generated stems of the same item", async () => {
    const f = await setup();
    const prompts: string[] = [];
    const { client } = fakeClient((r) => { if (r.item === "L23101") prompts.push(r.params.messages[0].content); return ok(r); });
    await runGeneration(base(f, client, { total: 12 * 15, batchSize: 5 }));
    expect(prompts[1]).toMatch(/已出過的題幹/);
    const firstStem = (await read(f)).find((q) => q.item === "L23101")!.stem.slice(0, 10);
    expect(prompts[1]).toContain(firstStem);
  });

  // --- A: Opus-only ---
  it("treats a response served by another model as a failed round and drops its questions", async () => {
    const f = await setup();
    const wrong = [rawQ({ stem: "非 Opus 產生的題幹，不可存檔" })];
    const { client } = fakeClient((r) => (r.item === "L23101" && r.itemCall === 1 ? msg(wrong, { model: "claude-opus-4-8" }) : ok(r)));
    const r = await runGeneration(base(f, client, { total: 12 }));
    expect(r.shortfall).toBe(0);
    const qs = await read(f);
    expect(qs.some((q) => q.stem.includes("非 Opus"))).toBe(false);
    expect(qs.filter((q) => q.item === "L23101")).toHaveLength(1);
  });

  it("treats a response with no model field as a failed round", async () => {
    const f = await setup();
    const { client } = fakeClient(() => msg([rawQ()], { model: undefined }));
    const r = await runGeneration(base(f, client, { total: 12, maxRounds: 2 }));
    expect(r.shortfall).toBe(12);
    await expect(fs.access(f)).rejects.toThrow();
  });

  // --- B: validate existing questions on resume ---
  it("stops with an error listing the invalid existing ids, without calling the API or touching the file", async () => {
    const f = await setup();
    const have = [
      fullQ({ id: "L23101-001", item: "L23101" }),
      fullQ({ id: "L23101-002", item: "L23101", answer: 9 as 0 }),
      fullQ({ id: "L23102-001", item: "L21101" }), // item from another subject
    ];
    await fs.writeFile(f, JSON.stringify(have));
    const before = await fs.readFile(f, "utf8");
    const { client, stream } = fakeClient(ok);
    const err = await runGeneration(base(f, client)).then(() => null, (e) => e as Error);
    expect(err?.message).toContain("L23101-002");
    expect(err?.message).toContain("L23102-001");
    expect(err?.message).not.toContain("L23101-001");
    expect(stream).not.toHaveBeenCalled();
    expect(await fs.readFile(f, "utf8")).toBe(before);
  });

  it("rejects an output file with duplicate ids or duplicate stems", async () => {
    const f = await setup();
    const a = fullQ({ id: "L23101-001", item: "L23101" });
    await fs.writeFile(f, JSON.stringify([a, { ...a, stem: "另一個題幹" }, { ...fullQ({ id: "L23101-003", item: "L23101" }), stem: a.stem }]));
    const { client } = fakeClient(ok);
    await expect(runGeneration(base(f, client))).rejects.toThrow(/L23101-001.*L23101-003|L23101-003/s);
  });

  // --- C: other files only feed the duplicate baseline ---
  it("drops stems that already exist in other files of the directory, but counts quota from this subject's file only", async () => {
    const f = await setup();
    const dir = path.dirname(f);
    const seen = "別的檔案裡已經有的題幹";
    await fs.writeFile(path.join(dir, "sample.json"), JSON.stringify([fullQ({ id: "L23101-S01", item: "L23101", stem: seen })]));
    await fs.writeFile(path.join(dir, "subject-1.json"), JSON.stringify([fullQ({ id: "L21101-001", subject: 1, item: "L21101", stem: "科目一的題幹" })]));
    const { client } = fakeClient((r) => (r.item === "L23101" && r.itemCall === 1 ? [rawQ({ stem: seen }), rawQ({ stem: "科目一的題幹！" })] : ok(r)));
    const r = await runGeneration(base(f, client, { total: 12 }));
    const mine = (await read(f)).filter((q) => q.item === "L23101");
    expect(mine).toHaveLength(1); // quota 1: the sample.json question did not count
    expect(mine[0]!.stem).not.toBe(seen);
    expect(mine[0]!.stem).not.toContain("科目一");
    expect(r.perItem[0]).toMatchObject({ before: 0, added: 1, dropped: 2 });
    expect(r.shortfall).toBe(0);
    expect(r.perItem[0]!.rounds).toBe(2); // first round dropped both
  });

  it("fails clearly when another file in the directory is corrupt", async () => {
    const f = await setup();
    await fs.writeFile(path.join(path.dirname(f), "sample.json"), "{nope");
    const { client } = fakeClient(ok);
    await expect(runGeneration(base(f, client))).rejects.toThrow(/sample\.json/);
  });

  // --- D: lock ---
  it("refuses to start when the directory lock exists and leaves it in place", async () => {
    const f = await setup();
    await fs.writeFile(lockPath(f), "999");
    const { client, stream } = fakeClient(ok);
    await expect(runGeneration(base(f, client))).rejects.toThrow(lockPath(f));
    expect(stream).not.toHaveBeenCalled();
    expect(await fs.readFile(lockPath(f), "utf8")).toBe("999");
  });

  it("holds the lock during the run and removes it afterwards", async () => {
    const f = await setup();
    let held = false;
    const { client } = fakeClient(async (r) => {
      held = await fs.access(lockPath(f)).then(() => true, () => false);
      return ok(r);
    });
    await runGeneration(base(f, client, { total: 12 }));
    expect(held).toBe(true);
    await expect(fs.access(lockPath(f))).rejects.toThrow();
  });

  it("removes the lock when the run fails", async () => {
    const f = await setup();
    const { client } = fakeClient(() => { throw Object.assign(new Error("bad key"), { status: 401 }); });
    await expect(runGeneration(base(f, client))).rejects.toMatchObject({ status: 401 });
    await expect(fs.access(lockPath(f))).rejects.toThrow();
  });

  it("removes the lock when existing questions are invalid", async () => {
    const f = await setup();
    await fs.writeFile(f, JSON.stringify([fullQ({ item: "L99999" })]));
    const { client } = fakeClient(ok);
    await expect(runGeneration(base(f, client))).rejects.toThrow();
    await expect(fs.access(lockPath(f))).rejects.toThrow();
  });

  // --- re-review: baseline before validation, ids across the directory, one lock per directory ---
  it("reports an existing question whose stem duplicates one in another file as invalid, and stops", async () => {
    const f = await setup();
    const dir = path.dirname(f);
    const shared = "兩個檔案都有的題幹";
    await fs.writeFile(path.join(dir, "sample.json"), JSON.stringify([fullQ({ id: "L23101-S01", item: "L23101", stem: shared })]));
    await fs.writeFile(f, JSON.stringify([fullQ({ id: "L23101-001", item: "L23101", stem: shared })]));
    const { client, stream } = fakeClient(ok);
    await expect(runGeneration(base(f, client))).rejects.toThrow(/L23101-001.*duplicate stem/s);
    expect(stream).not.toHaveBeenCalled();
  });

  it("allocates ids that skip every id already used in the directory", async () => {
    const f = await setup();
    const dir = path.dirname(f);
    await fs.writeFile(path.join(dir, "subject-1.json"), JSON.stringify([fullQ({ id: "L23101-005", subject: 1, item: "L21101" })]));
    await fs.writeFile(f, JSON.stringify([fullQ({ id: "L23101-002", item: "L23101" })]));
    const { client } = fakeClient(ok);
    await runGeneration(base(f, client, { total: 24 })); // L23101 quota 2: one existing + one new
    const ids = (await read(f)).filter((q) => q.item === "L23101").map((q) => q.id);
    expect(ids).toEqual(["L23101-002", "L23101-006"]);
  });

  it("uses one lock for the whole directory: a second subject's run cannot start meanwhile", async () => {
    const f3 = await setup();
    const f1 = path.join(path.dirname(f3), "subject-1.json");
    let second: Promise<unknown> | undefined;
    const a = fakeClient(async (r) => {
      if (!second) {
        const b = fakeClient(ok);
        second = runGeneration({ ...base(f1, b.client, { subject: 1 }) }).then(() => "started", (e) => String(e.message));
      }
      return ok(r);
    });
    await runGeneration(base(f3, a.client, { total: 12 }));
    expect(await second).toContain(".generate.lock");
    await fs.access(f1).then(() => { throw new Error("second run wrote its file"); }, () => {});
    await expect(fs.access(lockPath(f3))).rejects.toThrow(); // released after the first run
  });
});
