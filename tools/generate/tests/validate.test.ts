import { describe, expect, it } from "vitest";
import { QuestionValidator, normalizeStem } from "../src/validate.js";
import type { Question } from "../src/types.js";
import { fullQ, syllabus } from "./helpers.js";

const v = (existing: Question[] = []) => new QuestionValidator(syllabus(), existing);

describe("normalizeStem", () => {
  it("ignores whitespace, punctuation, width and case", () => {
    expect(normalizeStem("下列 何者，正確？ A")).toBe(normalizeStem("下列何者正確?a"));
  });
});

describe("QuestionValidator.check", () => {
  it("accepts a valid question", () => expect(v().check(fullQ())).toEqual([]));

  it("rejects non-objects", () => expect(v().check("x")).not.toEqual([]));

  it.each([
    ["3 options", { options: ["a", "b", "c"] }],
    ["5 options", { options: ["a", "b", "c", "d", "e"] }],
    ["empty option", { options: ["a", "b", "c", "  "] }],
    ["duplicate options", { options: ["a", "b", "c", " a "] }],
    ["non-string option", { options: ["a", "b", "c", 4] }],
    ["answer 4", { answer: 4 }],
    ["answer -1", { answer: -1 }],
    ["answer 1.5", { answer: 1.5 }],
    ["answer as string", { answer: "1" }],
    ["empty stem", { stem: "  " }],
    ["empty explanation", { explanation: "" }],
    ["empty related", { related: "" }],
    ["unknown item", { item: "L99999" }],
    ["item from another subject", { item: "L21101" }],
    ["bad source", { source: "official" }],
    ["empty id", { id: "" }],
  ])("rejects %s", (_n, over) => {
    expect(v().check({ ...fullQ(), ...over })).not.toEqual([]);
  });

  it("rejects a question whose subject differs from the requested one", () => {
    expect(v().check(fullQ(), 1)).not.toEqual([]);
    expect(v().check(fullQ(), 3)).toEqual([]);
  });

  it("rejects duplicate ids, including ones from existing questions", () => {
    const a = fullQ({ id: "L23301-001" });
    const val = v([a]);
    expect(val.check(fullQ({ id: "L23301-001" }))).not.toEqual([]);
    val.add(fullQ({ id: "L23301-002" }));
    expect(val.check(fullQ({ id: "L23301-002" }))).not.toEqual([]);
  });

  it("rejects normalized-duplicate stems but not different ones", () => {
    const a = fullQ({ stem: "下列何者是梯度下降的目的？" });
    const val = v([a]);
    expect(val.check(fullQ({ stem: "下列何者是梯度下降的目的?  " }))).not.toEqual([]);
    expect(val.check(fullQ({ stem: "下列何者是反向傳播的目的？" }))).toEqual([]);
  });

  it("tolerates malformed questions in the baseline instead of crashing", () => {
    expect(() => new QuestionValidator(syllabus(), [{ id: "x" } as unknown as Question, null as unknown as Question])).not.toThrow();
  });
});
