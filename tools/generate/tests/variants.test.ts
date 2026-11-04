import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGeneration } from "../src/generate.js";
import { runVariants } from "../src/variants.js";
import type { Question } from "../src/types.js";
import { fullQ, msg, rawQ, syllabus } from "./helpers.js";

const official = (n: number, item = "L23101"): Question =>
  fullQ({ id: `OFF-115-1-S3-${String(n).padStart(2, "0")}`, item, source: "official", stem: `官方第${n}題：某零售企業建立銷售預測模型，希望評估新資料上的表現，請問何者最適當？` });
const OFF = [official(1), official(2), official(3, "L23102")];

const dirOf = async () => fs.mkdtemp(path.join(os.tmpdir(), "var-"));
const read = async <T = Question[]>(f: string): Promise<T> => JSON.parse(await fs.readFile(f, "utf8"));
const exists = (f: string) => fs.access(f).then(() => true, () => false);

function variantClient(respond: (r: { id: string; count: number; call: number; params: any }) => unknown) {
  let call = 0;
  const calls: { id: string; count: number; content: string }[] = [];
  const stream = (params: any) => {
    const content: string = params.messages[0].content;
    const id = /官方題目 ID：(\S+)/.exec(content)![1]!;
    const count = Number(/請產出 (\d+) 題/.exec(content)![1]);
    calls.push({ id, count, content });
    call++;
    return { finalMessage: async () => { const r = (await respond({ id, count, call, params })) as any; return Array.isArray(r) ? msg(r) : r; } };
  };
  return { client: { beta: { messages: { stream } } } as any, calls };
}
const fresh = (count: number) => Array.from({ length: count }, () => rawQ());
const base = async (client: any, over: object = {}) => {
  const dir = await dirOf();
  const outFile = path.join(dir, "subject-3.json");
  return { dir, outFile, progressFile: path.join(dir, ".variants-progress.json"), o: { client, syllabus: syllabus(), subject: 3 as const, official: OFF, perQuestion: 2, outFile, progressFile: path.join(dir, ".variants-progress.json"), sleep: async () => {}, log: () => {}, ...over } };
};

afterEach(() => vi.restoreAllMocks());

describe("runVariants", () => {
  it("targets N × official questions, one call per official question, as original questions on the same 知識點", async () => {
    const { client, calls } = variantClient(({ count }) => fresh(count));
    const { o, outFile, progressFile } = await base(client);
    const r = await runVariants(o);
    expect(r).toMatchObject({ target: 6, added: 6, shortfall: 0 });
    expect(calls.map((c) => [c.id, c.count]).sort()).toEqual([["OFF-115-1-S3-01", 2], ["OFF-115-1-S3-02", 2], ["OFF-115-1-S3-03", 2]]);
    const qs = await read(outFile);
    expect(qs).toHaveLength(6);
    expect(qs.every((q) => q.source === "original" && q.subject === 3)).toBe(true);
    expect(qs.map((q) => q.id).sort()).toEqual(["L23101-V001", "L23101-V002", "L23101-V003", "L23101-V004", "L23102-V001", "L23102-V002"]);
    expect(qs.filter((q) => q.item === "L23101")).toHaveLength(4);
    expect(qs.filter((q) => q.item === "L23102")).toHaveLength(2);
    expect(qs.every((q) => /^L\d{5}-V\d{3}$/.test(q.id))).toBe(true);
    const progress = await read<Record<string, string[]>>(progressFile);
    expect(Object.keys(progress).sort()).toEqual(OFF.map((q) => q.id));
    expect(progress["OFF-115-1-S3-03"]!.every((id) => qs.some((q) => q.id === id && q.item === "L23102"))).toBe(true);
  });

  it("puts the official question and the variant rules in the prompt", async () => {
    const { client, calls } = variantClient(({ count }) => fresh(count));
    const { o } = await base(client, { official: [OFF[0]!] });
    await runVariants(o);
    expect(calls[0]!.content).toContain(OFF[0]!.stem);
    expect(calls[0]!.content).toMatch(/不同.*情境/);
  });

  it("rejects a variant whose stem is too similar to its official stem (4-gram Jaccard >= 0.5) and re-requests it", async () => {
    const { client, calls } = variantClient(({ id, count, call }) =>
      call === 1 && id === "OFF-115-1-S3-01"
        ? [rawQ({ stem: OFF[0]!.stem.replace("何者最適當", "哪個最合適") }), ...fresh(count - 1)]
        : fresh(count));
    const { o, outFile } = await base(client);
    const r = await runVariants(o);
    expect(r.dropped).toBe(1);
    expect(r.shortfall).toBe(0);
    expect(calls.filter((c) => c.id === "OFF-115-1-S3-01").map((c) => c.count)).toEqual([2, 1]);
    expect((await read(outFile)).some((q) => q.stem.startsWith("官方第1題"))).toBe(false);
  });

  it("rejects a variant with a new stem but a verbatim official option or explanation", async () => {
    const src = { ...OFF[0]!, explanation: "官方詳解：這段說明文字很長，足以和其他題目的短詳解區分開來，必須逐字出現才算照抄。", options: ["官方選項甲：逐字照抄的第一個選項說明", "官方選項乙：逐字照抄的第二個選項說明", "官方選項丙：逐字照抄的第三個選項說明", "官方選項丁：逐字照抄的第四個選項說明"] as Question["options"] };
    const { client, calls } = variantClient(({ call, count }) =>
      call === 1 ? [rawQ({ options: [...src.options] }), rawQ({ explanation: src.explanation }), ...fresh(count - 2)] : fresh(count));
    const { o, outFile } = await base(client, { official: [src], perQuestion: 4 });
    const r = await runVariants(o);
    expect(r).toMatchObject({ dropped: 2, added: 4, shortfall: 0 });
    const qs = await read(outFile);
    expect(qs.some((q) => q.options.includes(src.options[0]) || q.explanation === src.explanation)).toBe(false);
    expect(calls.map((c) => c.count)).toEqual([4, 2]);
  });

  it("resumes from the progress file: finished officials are skipped, partial ones request only the remainder", async () => {
    const { client: c1 } = variantClient(({ id, count }) => (id === "OFF-115-1-S3-02" ? msg("not json") : fresh(count)));
    const { o, outFile, progressFile } = await base(c1, { maxRounds: 1 });
    const r1 = await runVariants(o);
    expect(r1.shortfall).toBe(2);
    expect(Object.keys(await read(progressFile)).sort()).toEqual(["OFF-115-1-S3-01", "OFF-115-1-S3-03"]);
    const { client: c2, calls } = variantClient(({ count }) => fresh(count));
    const r2 = await runVariants({ ...o, client: c2 });
    expect(calls.map((c) => [c.id, c.count])).toEqual([["OFF-115-1-S3-02", 2]]);
    expect(r2.shortfall).toBe(0);
    expect(await read(outFile)).toHaveLength(6);
    // raising N asks only for the difference
    const { client: c3, calls: calls3 } = variantClient(({ count }) => fresh(count));
    await runVariants({ ...o, client: c3, perQuestion: 3 });
    expect(calls3.map((c) => c.count)).toEqual([1, 1, 1]);
    // and a finished run is a no-op
    const { client: c4, calls: calls4 } = variantClient(({ count }) => fresh(count));
    await runVariants({ ...o, client: c4, perQuestion: 3 });
    expect(calls4).toHaveLength(0);
  });

  it("regenerates variants the progress file claims but the output file lost", async () => {
    const { client, calls } = variantClient(({ count }) => fresh(count));
    const { o, outFile, progressFile } = await base(client, { official: [OFF[0]!] });
    await runVariants(o);
    const qs = await read(outFile);
    await fs.writeFile(outFile, JSON.stringify(qs.slice(0, 1)));
    calls.length = 0;
    await runVariants(o);
    expect(calls.map((c) => c.count)).toEqual([1]);
    expect((await read<Record<string, string[]>>(progressFile))["OFF-115-1-S3-01"]).toHaveLength(2);
  });

  it("keeps other subjects' progress when one subject runs (S3, then S1, then S3 again regenerates nothing)", async () => {
    const off1 = fullQ({ id: "OFF-115-1-S1-01", subject: 1, item: "L21101", source: "official", stem: "官方科目一第1題：某醫院導入影像辨識系統，請問下列何者最適當？" });
    const { client: c1 } = variantClient(({ count }) => fresh(count));
    const { o, dir, progressFile } = await base(c1, { official: [OFF[0]!, off1], perQuestion: 2 });
    await runVariants(o); // subject 3: only OFF-...-S3-01 belongs here
    const { client: c2, calls: calls2 } = variantClient(({ count }) => fresh(count));
    await runVariants({ ...o, client: c2, subject: 1, outFile: path.join(dir, "subject-1.json") });
    expect(calls2.map((c) => c.id)).toEqual(["OFF-115-1-S1-01"]);
    const progress = await read<Record<string, string[]>>(progressFile);
    expect(Object.keys(progress).sort()).toEqual(["OFF-115-1-S1-01", "OFF-115-1-S3-01"]);
    expect(progress["OFF-115-1-S3-01"]).toHaveLength(2);
    const { client: c3, calls: calls3 } = variantClient(({ count }) => fresh(count));
    const r = await runVariants({ ...o, client: c3 });
    expect(calls3).toHaveLength(0);
    expect(r.shortfall).toBe(0);
    expect((await read<Record<string, string[]>>(progressFile))["OFF-115-1-S1-01"]).toHaveLength(2);
  });

  it("a crash between the two writes of a save leaves no orphan variants: the retry ends at exactly N per official", async () => {
    const { client } = variantClient(({ count }) => fresh(count));
    const { o, outFile } = await base(client, { official: [OFF[0]!] });
    // fail the second atomic write (its rename) of the first save, as if the process died between the two files
    const rename = fs.rename.bind(fs);
    let renames = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (a, b) => { if (++renames === 2) throw new Error("simulated crash"); return rename(a, b); });
    await expect(runVariants(o)).rejects.toThrow(/simulated crash/);
    vi.restoreAllMocks();
    const { client: c2 } = variantClient(({ count }) => fresh(count));
    const r = await runVariants({ ...o, client: c2 });
    expect(r.shortfall).toBe(0);
    expect(await read(outFile)).toHaveLength(2); // not 4: nothing was left in the bank that the progress file did not know
  });

  it("with two workers, the files on disk are always a consistent pair (the bank never holds a variant the progress file lacks)", async () => {
    // worker 2's answer lands while worker 1's save is still between its two writes
    const { client } = variantClient(async ({ id, count }) => { await new Promise((r) => setTimeout(r, id.endsWith("01") ? 0 : 5)); return fresh(count); });
    const { o, outFile, progressFile } = await base(client, { official: [OFF[0]!, OFF[1]!], concurrency: 2 });
    const rename = fs.rename.bind(fs);
    const violations: string[] = [];
    vi.spyOn(fs, "rename").mockImplementation(async (a, b) => {
      await new Promise((r) => setTimeout(r, 15)); // make each write slow enough to interleave
      await rename(a, b);
      const bank = await fs.readFile(outFile, "utf8").then((t) => JSON.parse(t) as Question[], () => [] as Question[]);
      const owned = new Set(Object.values(await fs.readFile(progressFile, "utf8").then((t) => JSON.parse(t) as Record<string, string[]>, () => ({}))).flat());
      for (const q of bank) if (!owned.has(q.id)) violations.push(q.id);
    });
    const r = await runVariants(o);
    expect(r.shortfall).toBe(0);
    expect(violations).toEqual([]);
  });

  it("keeps variants out of the per-item quota: runGeneration still produces the full item target", async () => {
    const { client } = variantClient(({ count }) => fresh(count));
    const { o, outFile } = await base(client, { official: [OFF[0]!, OFF[1]!], perQuestion: 3 });
    await runVariants(o); // 6 variants of item L23101
    let asked = 0;
    const gen = { beta: { messages: { stream: (p: any) => {
      const c: string = p.messages[0].content;
      const item = /知識點：(L\d{5})/.exec(c)![1];
      const n = Number(/請產出 (\d+) 題/.exec(c)![1]);
      if (item === "L23101") asked += n;
      return { finalMessage: async () => msg(fresh(n)) };
    } } } };
    await runGeneration({ client: gen, syllabus: syllabus(), subject: 3, total: 24, outFile, sleep: async () => {}, log: () => {} });
    expect(asked).toBe(2); // 24 / 12 items, regardless of the 6 variants already filed under L23101
    expect((await read(outFile)).filter((q) => q.item === "L23101" && !q.id.includes("-V"))).toHaveLength(2);
  });

  it("does not trip the generator's sibling-file scan or the checker on its dot-file", async () => {
    const { client } = variantClient(({ count }) => fresh(count));
    const { dir, o } = await base(client);
    await runVariants(o);
    const { checkFiles } = await import("../src/check.js");
    const r = await checkFiles(dir, syllabus());
    expect(r.errors).toEqual([]);
    expect(await exists(path.join(dir, ".variants-progress.json"))).toBe(true);
    const out2 = path.join(dir, "subject-1.json");
    const gen = { beta: { messages: { stream: () => ({ finalMessage: async () => msg([]) }) } } };
    await expect(runGeneration({ client: gen, syllabus: syllabus(), subject: 1, total: 0 + 1, outFile: out2, maxRounds: 1, sleep: async () => {}, log: () => {} })).resolves.toBeDefined();
  });
});
