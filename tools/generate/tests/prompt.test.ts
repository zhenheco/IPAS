import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { balancedPositions, buildRequest } from "../src/prompt.js";
import { getSubject, subjectItems } from "../src/syllabus.js";
import { syllabus } from "./helpers.js";

describe("balancedPositions", () => {
  it("is an even spread (counts differ by at most 1) and shuffled", () => {
    for (const n of [1, 4, 10, 30]) {
      const p = balancedPositions(n);
      expect(p).toHaveLength(n);
      const c = [0, 1, 2, 3].map((k) => p.filter((x) => x === k).length);
      expect(Math.max(...c) - Math.min(...c)).toBeLessThanOrEqual(1);
    }
  });
  it("uses the injected rng", () => {
    const rng = () => 0;
    expect(balancedPositions(8, rng)).toEqual(balancedPositions(8, rng));
  });
});

describe("buildRequest", () => {
  const s = syllabus();
  const args = (subject: 1 | 3) => {
    const sub = getSubject(s, subject);
    return { subject: sub, item: subjectItems(sub)[6]!, count: 10, positions: balancedPositions(10), existingStems: ["已出過的題幹甲"] };
  };
  const req = buildRequest(args(3));

  it("calls claude-opus-5-5 with structured output", () => {
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.output_config.format.type).toBe("json_schema");
    expect((req.output_config.format.schema as any).properties.questions.type).toBe("array");
    expect(req.output_config.effort).toBe("high");
    expect(req.max_tokens).toBeGreaterThanOrEqual(16000);
  });

  it("is assignable to the SDK's beta stream params (compile-time check, see `npm run typecheck`)", () => {
    const p: Parameters<Anthropic["beta"]["messages"]["stream"]>[0] = req;
    expect(p.model).toBe("claude-opus-5-5");
  });

  it("never enables server-side fallback (Opus-written questions only)", () => {
    expect(req).not.toHaveProperty("fallbacks");
    expect(req).not.toHaveProperty("betas");
  });

  it("avoids parameters Opus 5.5 rejects", () => {
    for (const k of ["temperature", "top_p", "top_k", "thinking", "tool_choice"]) expect(req).not.toHaveProperty(k);
  });

  it("puts the item, count and target answer positions in the user message", () => {
    const content: string = req.messages[0].content;
    expect(req.messages[0].role).toBe("user");
    expect(content).toContain("知識點：L23301");
    expect(content).toContain("數據準備與特徵工程");
    expect(content).toContain("請產出 10 題");
    expect(content).toContain("已出過的題幹甲");
    expect(content).toMatch(/第 10 題.*answer = [0-3]/);
  });

  it("states the key rules in the system prompt (繁體中文)", () => {
    for (const w of ["繁體中文", "中級", "單選", "原創", "不得", "情境", "計算", "長度"]) expect(req.system).toContain(w);
  });

  it("asks for python code-reading questions only for subject 3", () => {
    expect(req.system + req.messages[0].content).toMatch(/scikit-learn/);
    const r1 = buildRequest(args(1));
    expect(r1.system + r1.messages[0].content).not.toMatch(/scikit-learn/);
  });
});
