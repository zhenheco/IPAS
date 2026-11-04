import { vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSyllabus } from "../src/syllabus.js";
import type { Question, RawQuestion } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_DATA = path.resolve(here, "../../../data");
export const syllabus = () => loadSyllabus(path.join(REPO_DATA, "syllabus.json"));

let seq = 0;
export function rawQ(over: Partial<RawQuestion> = {}): RawQuestion {
  seq++;
  return {
    stem: `第${seq}號測試題幹：下列何者正確？`,
    options: [`甲${seq}`, `乙${seq}`, `丙${seq}`, `丁${seq}`],
    answer: seq % 4,
    explanation: "詳解：甲正確，其餘錯誤。",
    related: "相關知識：這是一段相關知識。",
    ...over,
  };
}

export function fullQ(over: Partial<Question> = {}): Question {
  const r = rawQ();
  return {
    id: `L23301-${String(seq).padStart(3, "0")}`,
    subject: 3,
    item: "L23301",
    ...r,
    options: r.options as Question["options"],
    answer: r.answer as Question["answer"],
    source: "original",
    ...over,
  };
}

export const msg = (qs: unknown, extra: Record<string, unknown> = {}) => ({
  content: [{ type: "text", text: typeof qs === "string" ? qs : JSON.stringify({ questions: qs }) }],
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  usage: { input_tokens: 100, output_tokens: 50 },
  ...extra,
});

/** Fake SDK client; `respond` gets the parsed request and returns raw questions, a message, or throws. */
export function fakeClient(
  respond: (req: { item: string; count: number; call: number; itemCall: number; params: any }) => unknown,
) {
  let call = 0;
  const perItem: Record<string, number> = {};
  const stream = vi.fn((params: any) => {
    const content: string = params.messages[0].content;
    const item = /知識點：(L\d{5})/.exec(content)![1]!;
    const count = Number(/請產出 (\d+) 題/.exec(content)![1]);
    call++;
    const itemCall = (perItem[item] = (perItem[item] ?? 0) + 1);
    return {
      finalMessage: async () => {
        const r = (await respond({ item, count, call, itemCall, params })) as any;
        return Array.isArray(r) ? msg(r) : r;
      },
    };
  });
  return { client: { beta: { messages: { stream } } } as any, stream };
}
