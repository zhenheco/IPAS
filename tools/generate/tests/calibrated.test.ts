import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runGeneration } from "../src/generate.js";
import type { Question } from "../src/types.js";
import { fakeClient, fullQ, rawQ, syllabus } from "./helpers.js";

const off = (n: number, item: string, over: Partial<Question> = {}): Question =>
  fullQ({ id: `OFF-115-1-S3-${String(n).padStart(2, "0")}`, item, source: "official", stem: `官方範例${n}號：這是一道關於${item}的官方歷屆試題題幹`, ...over });
const official = [...Array.from({ length: 9 }, (_, i) => off(i + 1, "L23101")), ...Array.from({ length: 9 }, (_, i) => off(i + 10, "L23201"))];
const setup = async () => path.join(await fs.mkdtemp(path.join(os.tmpdir(), "cal-")), "subject-3.json");
const base = (outFile: string, client: any, over: object = {}) => ({
  client, syllabus: syllabus(), subject: 3 as const, total: 12, outFile, sleep: async () => {}, log: () => {}, ...over,
});
const ok = ({ count }: { count: number }) => Array.from({ length: count }, () => rawQ());
const userContent = (stream: any, i: number): string => stream.mock.calls[i][0].messages[0].content;

describe("calibrated generation", () => {
  it("adds 6-8 official questions of the same 評鑑主題 as style exemplars", async () => {
    const f = await setup();
    const { client, stream } = fakeClient(ok);
    await runGeneration(base(f, client, { official }));
    const first = userContent(stream, 0); // item L23101 (topic L231)
    const shown = official.filter((q) => first.includes(q.stem));
    expect(shown.length).toBeGreaterThanOrEqual(6);
    expect(shown.length).toBeLessThanOrEqual(8);
    expect(shown.every((q) => q.item === "L23101")).toBe(true);
    expect(first).toMatch(/官方歷屆試題/);
    expect(first).toMatch(/[Aa]\)|\(A\)/); // options are rendered with letters for the model to see the format
  });

  it("tells the model to match difficulty/length/scenario/option style but never reuse scenario, numbers or wording", async () => {
    const f = await setup();
    const { client, stream } = fakeClient(ok);
    await runGeneration(base(f, client, { official }));
    const system: string = stream.mock.calls[0][0].system;
    expect(system).toMatch(/難度/);
    expect(system).toMatch(/名稱：說明/);
    expect(system).toMatch(/不得.*(沿用|重用).*(情境|數字|用字)/);
  });

  it("sends no exemplar section at all when no official questions exist for the subject", async () => {
    const f = await setup();
    const { client, stream } = fakeClient(ok);
    await runGeneration(base(f, client, { official: [off(1, "L21101", { subject: 1 })] }));
    expect(userContent(stream, 0)).not.toMatch(/官方歷屆試題/);
    expect(stream.mock.calls[0][0].system).not.toMatch(/官方歷屆試題範例/);
  });

  it("rotates the sample between batches", async () => {
    const f = await setup();
    const { client, stream } = fakeClient(ok);
    await runGeneration(base(f, client, { official, total: 12 * 20, batchSize: 5, concurrency: 1 }));
    const l23101 = [...Array(stream.mock.calls.length).keys()].map((i) => userContent(stream, i)).filter((c) => c.includes("知識點：L23101"));
    const sets = new Set(l23101.map((c) => official.filter((q) => c.includes(q.stem)).map((q) => q.id).join()));
    expect(sets.size).toBeGreaterThan(1);
  });

  it("drops a generated question that is too similar to an official stem", async () => {
    const f = await setup();
    const { client } = fakeClient(({ count, itemCall, item }) =>
      item === "L23101" && itemCall === 1
        ? [rawQ({ stem: official[0]!.stem.replace("這是一道", "此為一道") }), ...Array.from({ length: count - 1 }, () => rawQ())]
        : Array.from({ length: count }, () => rawQ()));
    const r = await runGeneration(base(f, client, { official }));
    expect(r.perItem.find((s) => s.code === "L23101")).toMatchObject({ dropped: 1, added: 1, rounds: 2 });
  });

  it("drops a generated question whose stem is new but whose options are verbatim official options", async () => {
    const f = await setup();
    const withOptions = official.map((q, i) => (i === 0 ? { ...q, options: ["官方選項甲：逐字照抄的第一個選項說明", "官方選項乙：逐字照抄的第二個選項說明", "官方選項丙：逐字照抄的第三個選項說明", "官方選項丁：逐字照抄的第四個選項說明"] as Question["options"] } : q));
    const { client } = fakeClient(({ count, itemCall, item }) =>
      item === "L23101" && itemCall === 1
        ? [rawQ({ options: [...withOptions[0]!.options] }), ...Array.from({ length: count - 1 }, () => rawQ())]
        : Array.from({ length: count }, () => rawQ()));
    const logs: string[] = [];
    const r = await runGeneration(base(f, client, { official: withOptions, log: (l: string) => logs.push(l) }));
    expect(r.perItem.find((s) => s.code === "L23101")).toMatchObject({ dropped: 1, added: 1, rounds: 2 });
    expect(logs.join("\n")).toMatch(/option [A-D].*OFF-115-1-S3-01/);
    expect(JSON.parse(await fs.readFile(f, "utf8")).some((q: Question) => q.options.includes("官方選項甲：逐字照抄的第一個選項說明"))).toBe(false);
  });
});
