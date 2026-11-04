import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importOfficial } from "../src/official.js";
import type { Question } from "../src/types.js";
import { msg, syllabus } from "./helpers.js";

const KEY: Record<number, number> = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, (i * 3) % 4]));
const raw = (n: number, over: Record<string, unknown> = {}) => ({
  number: n,
  stem: `官方第${n}題題幹，下列敘述何者正確？`,
  options: [0, 1, 2, 3].map((k) => `選項${n}-${k}：說明${k}；`),
  answer: KEY[n]!,
  item: "L23101",
  explanation: `詳解${n}`,
  related: `相關知識${n}`,
  ...over,
});
/** What `pdftotext -layout` would give for the 50 raw() questions: answer column, number, stem, then (A)-(D) lines. */
const PDF_TEXT = Array.from({ length: 50 }, (_, i) => {
  const q = raw(i + 1);
  return `${"ABCD"[q.answer]}   ${i + 1}. ${q.stem}\n${q.options.map((o, k) => `      (${"ABCD"[k]})${o}`).join("\n")}`;
}).join("\n\n");
const outPath = async () => path.join(await fs.mkdtemp(path.join(os.tmpdir(), "imp-")), "115-1-s3.json");
const exists = (f: string) => fs.access(f).then(() => true, () => false);

/** Fake SDK client for the import prompt: `respond` sees the requested question numbers. */
function importClient(respond: (r: { numbers: number[]; call: number; params: any }) => unknown) {
  let call = 0;
  const calls: { numbers: number[]; params: any }[] = [];
  const stream = (params: any) => {
    const text: string = params.messages[0].content.find((b: any) => b.type === "text").text;
    const numbers = /題號：([\d, ]+)/.exec(text)![1]!.split(",").map((s) => Number(s.trim()));
    call++;
    calls.push({ numbers, params });
    return { finalMessage: async () => { const r = (await respond({ numbers, call, params })) as any; return Array.isArray(r) ? msg(r) : r; } };
  };
  return { client: { beta: { messages: { stream } } } as any, calls };
}
const good = ({ numbers }: { numbers: number[] }) => numbers.map((n) => raw(n));
const opts = (client: any, outFile: string, over: object = {}) => ({
  client, syllabus: syllabus(), subject: 3 as const, exam: "115-1", pdfBase64: "UERGLWJ5dGVz", pdfText: PDF_TEXT, key: KEY, outFile,
  sleep: async () => {}, log: () => {}, ...over,
});
const read = async (f: string): Promise<Question[]> => JSON.parse(await fs.readFile(f, "utf8"));

describe("importOfficial", () => {
  it("imports 50 questions in 5 chunks of 10 with official ids, source and the printed answers", async () => {
    const f = await outPath();
    const { client, calls } = importClient(good);
    const r = await importOfficial(opts(client, f));
    expect(r.missing).toEqual([]);
    expect(calls.map((c) => c.numbers.length)).toEqual([10, 10, 10, 10, 10]);
    const qs = await read(f);
    expect(qs).toHaveLength(50);
    expect(qs.map((q) => q.id)).toEqual(Array.from({ length: 50 }, (_, i) => `OFF-115-1-S3-${String(i + 1).padStart(2, "0")}`));
    expect(qs[0]).toMatchObject({ subject: 3, source: "official", item: "L23101", answer: KEY[1] });
    expect(Object.keys(qs[0]!).sort()).toEqual(["answer", "explanation", "id", "item", "options", "related", "source", "stem", "subject"]);
    expect(qs[0]!.options[0]).toBe("選項1-0：說明0"); // trailing list separator dropped, 名稱：說明 kept
    expect(r.usage).toEqual({ input: 500, output: 250 });
    expect(await exists(`${f}.partial`)).toBe(false);
  });

  it("sends the PDF as a cached base64 document block, claude-opus-5-5, no fallbacks, item enum limited to the subject", async () => {
    const f = await outPath();
    const { client, calls } = importClient(good);
    await importOfficial(opts(client, f));
    const p = calls[0]!.params;
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.fallbacks).toBeUndefined();
    expect(p.betas).toBeUndefined();
    const doc = p.messages[0].content[0];
    expect(doc).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "UERGLWJ5dGVz" }, cache_control: { type: "ephemeral" } });
    const item = p.output_config.format.schema.properties.questions.items.properties.item;
    expect(item.enum).toContain("L23101");
    expect(item.enum).not.toContain("L21101");
    expect(p.system).toContain("答案");
  });

  it("rejects a question whose answer differs from the printed key and retries only that question", async () => {
    const f = await outPath();
    const { client, calls } = importClient(({ numbers, call }) =>
      numbers.map((n) => raw(n, n === 7 && call === 1 ? { answer: (KEY[7]! + 1) % 4 } : {})));
    const logs: string[] = [];
    const r = await importOfficial(opts(client, f, { log: (l: string) => logs.push(l) }));
    expect(r.missing).toEqual([]);
    expect(calls).toHaveLength(6);
    expect(calls[5]!.numbers).toEqual([7]);
    expect(calls[5]!.params.messages[0].content.find((b: any) => b.type === "text").text).toMatch(/第 7 題.*答案/);
    expect(logs.join("\n")).toMatch(/#7.*key/);
    expect((await read(f)).find((q) => q.id.endsWith("-07"))!.answer).toBe(KEY[7]);
  });

  it("gives up after maxRounds, reports the question, and writes no final file", async () => {
    const f = await outPath();
    const { client, calls } = importClient(({ numbers }) => numbers.map((n) => raw(n, n === 7 ? { answer: (KEY[7]! + 1) % 4 } : {})));
    const r = await importOfficial(opts(client, f, { maxRounds: 3 }));
    expect(r.missing).toEqual([{ number: 7, reason: expect.stringMatching(/printed key/) }]);
    expect(calls.filter((c) => c.numbers.includes(7))).toHaveLength(3);
    expect(await exists(f)).toBe(false);
    expect((JSON.parse(await fs.readFile(`${f}.partial`, "utf8")).questions as Question[])).toHaveLength(49);
  });

  it("requires exactly 50: a question the model never returns is missing and nothing is written", async () => {
    const f = await outPath();
    const { client } = importClient(({ numbers }) => numbers.filter((n) => n !== 50).map((n) => raw(n)));
    const r = await importOfficial(opts(client, f));
    expect(r.missing.map((m) => m.number)).toEqual([50]);
    expect(r.missing[0]!.reason).toMatch(/not returned/);
    expect(await exists(f)).toBe(false);
  });

  it("refuses to start when the printed key is not exactly 1..50 (no API call)", async () => {
    const { client, calls } = importClient(good);
    const { 50: _x, ...key49 } = KEY;
    await expect(importOfficial(opts(client, await outPath(), { key: key49 }))).rejects.toThrow(/missing.*50/);
    expect(calls).toHaveLength(0);
  });

  it("rejects wrong item codes, numbers outside the request, duplicates and (A) option prefixes, then retries", async () => {
    const f = await outPath();
    const { client } = importClient(({ numbers, call }) => {
      if (call !== 1) return good({ numbers });
      return [
        raw(1, { item: "L21101" }), // subject 1 code in subject 3
        raw(2, { options: ["(A)甲", "(B)乙", "(C)丙", "(D)丁"] }),
        raw(3), raw(3), // duplicate in one response
        raw(99), // not requested
        ...numbers.slice(3).map((n) => raw(n)),
      ];
    });
    const r = await importOfficial(opts(client, f));
    expect(r.missing).toEqual([]);
    expect(await read(f)).toHaveLength(50);
  });

  it("treats a response from another model as a soft failure and retries", async () => {
    const f = await outPath();
    const { client, calls } = importClient(({ numbers, call }) => (call === 1 ? msg(good({ numbers }), { model: "claude-sonnet-5-5" }) : good({ numbers })));
    const r = await importOfficial(opts(client, f));
    expect(r.missing).toEqual([]);
    expect(calls).toHaveLength(6);
    expect(calls[5]!.numbers).toEqual(calls[0]!.numbers);
  });

  it("resumes from <file>.partial: only the questions not yet accepted are requested", async () => {
    const f = await outPath();
    const first = importClient(({ numbers, call }) => (call <= 4 ? good({ numbers }) : msg("not json")));
    const r1 = await importOfficial(opts(first.client, f, { maxRounds: 1 }));
    expect(r1.missing).toHaveLength(10);
    expect(await exists(f)).toBe(false);
    const second = importClient(good);
    const r2 = await importOfficial(opts(second.client, f));
    expect(second.calls.map((c) => c.numbers)).toEqual([[41, 42, 43, 44, 45, 46, 47, 48, 49, 50]]);
    expect(r2.missing).toEqual([]);
    expect(await read(f)).toHaveLength(50);
  });
});

const SHA = createHash("sha256").update(Buffer.from("UERGLWJ5dGVz", "base64")).digest("hex");
const readJson = async (f: string) => JSON.parse(await fs.readFile(f, "utf8"));

describe("verification against the PDF text", () => {
  const reordered = (n: number) => { const q = raw(n); return { options: [q.options[0], q.options[2], q.options[1], q.options[3]] }; };

  it("does not accept a question whose options were reordered even though the answer index matches; reports it as unverified", async () => {
    const f = await outPath();
    const { client, calls } = importClient(({ numbers }) => numbers.map((n) => raw(n, n === 7 ? reordered(7) : {})));
    const r = await importOfficial(opts(client, f, { maxRounds: 2 }));
    expect(r.missing).toEqual([]);
    expect(r.unverified).toEqual([{ number: 7, reason: expect.stringMatching(/option B/) }]);
    expect(calls.filter((c) => c.numbers.includes(7))).toHaveLength(2); // asked again once, with a hint
    expect(calls[5]!.params.messages[0].content.find((b: any) => b.type === "text").text).toMatch(/第 7 題.*PDF/);
    expect(r.questions.map((q) => q.id)).not.toContain("OFF-115-1-S3-07");
    expect(await exists(f)).toBe(false); // an incomplete set is never the final file
    const review = await readJson(`${f}.unverified.json`);
    expect(review).toEqual({
      pdfSha256: SHA,
      entries: [{ number: 7, reason: expect.any(String), sha256: expect.stringMatching(/^[0-9a-f]{64}$/), question: expect.objectContaining({ id: "OFF-115-1-S3-07", options: raw(7, reordered(7)).options.map((o) => o.replace(/；$/, "")) }) }],
    });
    expect(review.entries[0].sha256).toBe(createHash("sha256").update(JSON.stringify(review.entries[0].question)).digest("hex"));
    expect((await readJson(`${f}.partial`)).questions).toHaveLength(49);
  });

  it("rejects fabricated stem text that is not in the PDF", async () => {
    const f = await outPath();
    const { client } = importClient(({ numbers }) => numbers.map((n) => raw(n, n === 3 ? { stem: "模型自己編的題幹" } : {})));
    const r = await importOfficial(opts(client, f, { maxRounds: 1 }));
    expect(r.unverified).toEqual([{ number: 3, reason: expect.stringMatching(/stem/) }]);
  });

  it("accepts a question after a retry fixes the transcription, and clears an old review file", async () => {
    const f = await outPath();
    await fs.writeFile(`${f}.unverified.json`, "[]");
    const { client } = importClient(({ numbers, call }) => numbers.map((n) => raw(n, n === 7 && call === 1 ? reordered(7) : {})));
    const r = await importOfficial(opts(client, f));
    expect(r.unverified).toEqual([]);
    expect(await read(f)).toHaveLength(50);
    expect(await exists(`${f}.unverified.json`)).toBe(false);
  });

  it("keeps a non-verification failure out of the unverified list", async () => {
    const f = await outPath();
    const { client } = importClient(({ numbers }) => numbers.filter((n) => n !== 50).map((n) => raw(n)));
    const r = await importOfficial(opts(client, f, { maxRounds: 1 }));
    expect(r.unverified).toEqual([]);
    expect(r.missing.map((m) => m.number)).toEqual([50]);
  });

  describe("--approve is bound to the candidate the owner reviewed", () => {
    const firstRun = async (f: string, over: (n: number) => Record<string, unknown> = reordered) => {
      const { client } = importClient(({ numbers }) => numbers.map((n) => raw(n, n === 7 ? over(7) : {})));
      return importOfficial(opts(client, f, { maxRounds: 1 }));
    };
    const reviewed = async (f: string) => (await readJson(`${f}.unverified.json`)).entries[0].question;

    it("accepts the stored reviewed candidate, never asks the model about it again, and persists the approval", async () => {
      const f = await outPath();
      await firstRun(f);
      const stored = await reviewed(f);
      const { client, calls } = importClient(({ numbers }) => numbers.map((n) => raw(n, n === 7 ? { options: [raw(7).options[3], raw(7).options[2], raw(7).options[1], raw(7).options[0]] } : {}))); // a different failing candidate
      const logs: string[] = [];
      const r = await importOfficial(opts(client, f, { approve: [7], log: (l: string) => logs.push(l) }));
      expect(r.unverified).toEqual([]);
      expect(calls.flatMap((c) => c.numbers)).not.toContain(7);
      expect((await read(f)).find((q) => q.id.endsWith("-07"))).toEqual(stored);
      expect(logs.join("\n")).toMatch(/#7.*approved/);
      expect(await exists(`${f}.unverified.json`)).toBe(false);
    });

    it("keeps the approval when the run is resumed from the partial, but only for that exact content", async () => {
      const f = await outPath();
      await firstRun(f);
      const stored = await reviewed(f);
      // approve while questions 20-29 are still outstanding and the model keeps failing, so a partial remains
      const part = await readJson(`${f}.partial`);
      await fs.writeFile(`${f}.partial`, JSON.stringify({ ...part, questions: part.questions.filter((q: Question) => !/-2\d$/.test(q.id)) }));
      const none = importClient(() => msg("not json"));
      await importOfficial(opts(none.client, f, { approve: [7], maxRounds: 1 }));
      const p = await readJson(`${f}.partial`);
      expect(p.approved["7"]).toMatch(/^[0-9a-f]{64}$/);
      const again = importClient(good);
      await importOfficial(opts(again.client, f)); // no --approve this time
      expect(again.calls.flatMap((c) => c.numbers)).not.toContain(7);
      expect((await read(f)).find((q) => q.id.endsWith("-07"))).toEqual(stored);
      // an edited candidate in the partial no longer matches its approval and is asked again
      const f2 = await outPath();
      await fs.writeFile(`${f2}.partial`, JSON.stringify({ pdfSha256: SHA, questions: [{ ...stored, stem: "被改過的題幹" }], approved: { "7": p.approved["7"] } }));
      const third = importClient(good);
      await importOfficial(opts(third.client, f2));
      expect(third.calls.flatMap((c) => c.numbers)).toContain(7);
    });

    it("refuses a number that has no reviewed candidate, a tampered entry, or a review file of another PDF", async () => {
      const f = await outPath();
      await firstRun(f);
      const { client, calls } = importClient(good);
      await expect(importOfficial(opts(client, f, { approve: [8] }))).rejects.toThrow(/#8.*no reviewed candidate/);
      const file = await readJson(`${f}.unverified.json`);
      await fs.writeFile(`${f}.unverified.json`, JSON.stringify({ ...file, entries: [{ ...file.entries[0], question: { ...file.entries[0].question, stem: "手改" } }] }));
      await expect(importOfficial(opts(client, f, { approve: [7] }))).rejects.toThrow(/#7.*changed/);
      await fs.writeFile(`${f}.unverified.json`, JSON.stringify({ ...file, pdfSha256: "0".repeat(64) }));
      await expect(importOfficial(opts(client, f, { approve: [7] }))).rejects.toThrow(/different PDF/);
      expect(calls).toHaveLength(0);
    });
  });

  it("re-verifies questions resumed from the partial file and re-asks the ones that fail", async () => {
    const f = await outPath();
    const tampered = { id: "OFF-115-1-S3-05", subject: 3, item: "L23101", stem: "partial 裡被改過的題幹", options: raw(5).options.map((o) => o.replace(/；$/, "")), answer: KEY[5], explanation: "e", related: "r", source: "official" };
    await fs.writeFile(`${f}.partial`, JSON.stringify({ pdfSha256: SHA, questions: [tampered] }));
    const { client, calls } = importClient(good);
    await importOfficial(opts(client, f));
    expect(calls.flatMap((c) => c.numbers)).toContain(5);
    expect((await read(f)).find((q) => q.id.endsWith("-05"))!.stem).toBe(raw(5).stem);
  });
});

describe("the .partial file is bound to its PDF", () => {
  const legacy = () => [{ id: "OFF-115-1-S3-01", subject: 3, item: "L23101", stem: raw(1).stem, options: raw(1).options.map((o) => o.replace(/；$/, "")), answer: KEY[1], explanation: "e", related: "r", source: "official" }];

  it("writes the PDF's sha256 with the accepted questions", async () => {
    const f = await outPath();
    const { client } = importClient(({ numbers, call }) => (call === 1 ? good({ numbers }) : msg("not json")));
    await importOfficial(opts(client, f, { maxRounds: 1 }));
    const p = await readJson(`${f}.partial`);
    expect(p.pdfSha256).toBe(SHA);
    expect(p.questions).toHaveLength(10);
  });

  it("refuses a partial made from a different PDF, before any API call", async () => {
    const f = await outPath();
    await fs.writeFile(`${f}.partial`, JSON.stringify({ pdfSha256: "0".repeat(64), questions: legacy() }));
    const { client, calls } = importClient(good);
    await expect(importOfficial(opts(client, f))).rejects.toThrow(/different PDF/);
    expect(calls).toHaveLength(0);
    expect((await readJson(`${f}.partial`)).pdfSha256).toBe("0".repeat(64)); // left untouched
  });

  it("refuses an old partial without a hash unless explicitly told to trust it, and says how", async () => {
    const f = await outPath();
    await fs.writeFile(`${f}.partial`, JSON.stringify(legacy()));
    const { client, calls } = importClient(good);
    await expect(importOfficial(opts(client, f))).rejects.toThrow(/--resume-unhashed/);
    expect(calls).toHaveLength(0);
  });

  it("reuses an old partial without a hash when trusted, and upgrades it with the hash", async () => {
    const f = await outPath();
    await fs.writeFile(`${f}.partial`, JSON.stringify(legacy()));
    const { client, calls } = importClient(good);
    const r = await importOfficial(opts(client, f, { trustUnhashedPartial: true }));
    expect(r.missing).toEqual([]);
    expect(calls.flatMap((c) => c.numbers)).not.toContain(1);
  });

  it("an unreadable partial still stops the run", async () => {
    const f = await outPath();
    await fs.writeFile(`${f}.partial`, "{}");
    const { client } = importClient(good);
    await expect(importOfficial(opts(client, f))).rejects.toThrow(/partial/);
  });
});

describe("request shapes", () => {
  it("import and variant requests are assignable to the SDK's beta stream params (compile-time check, see `npm run typecheck`)", async () => {
    const { buildImportRequest } = await import("../src/official.js");
    const { buildVariantRequest } = await import("../src/variants.js");
    const { getSubject, subjectItems } = await import("../src/syllabus.js");
    type P = Parameters<import("@anthropic-ai/sdk").default["beta"]["messages"]["stream"]>[0];
    const sub = getSubject(syllabus(), 3);
    const a: P = buildImportRequest({ syllabus: syllabus(), subject: 3, exam: "115-1", pdfBase64: "x", numbers: [1], hints: new Map() });
    const b: P = buildVariantRequest({ subject: sub, item: subjectItems(sub)[0]!, source: { id: "OFF-1", item: "L23101", stem: "s", options: ["a", "b", "c", "d"], answer: 0, explanation: "e" } as any, count: 1, positions: [0], existingStems: [] });
    expect([a.model, b.model]).toEqual(["claude-opus-5-5", "claude-opus-5-5"]);
  });
});
