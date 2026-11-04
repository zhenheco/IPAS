import { describe, expect, it } from "vitest";
import { getSubject, subjectItems } from "../src/syllabus.js";
import { syllabus } from "./helpers.js";

describe("syllabus.json", () => {
  const s = syllabus();
  it("has the 34 中級 知識點 over 3 subjects and the 16 初級 知識點 over 2", () => {
    expect(s.subjects.map((x) => x.code)).toEqual(["L21", "L22", "L23", "L11", "L12"]);
    const count = (codes: string[]) => s.subjects.filter((x) => codes.includes(x.code)).flatMap((x) => subjectItems(x)).length;
    expect(count(["L21", "L22", "L23"])).toBe(34);
    expect(count(["L11", "L12"])).toBe(16);
    for (const x of s.subjects) for (const i of subjectItems(x)) expect(i.code.startsWith(x.code)).toBe(true);
  });
  it("lists subject 3 items in order with their topic", () => {
    const items = subjectItems(getSubject(s, 3));
    expect(items).toHaveLength(12);
    expect(items[0]).toMatchObject({ code: "L23101", topicCode: "L231" });
    expect(items.at(-1)).toMatchObject({ code: "L23402", name: "演算法偏見與公平性", topicCode: "L234" });
  });
  it("item codes start with their subject code", () => {
    for (const sub of s.subjects) for (const i of subjectItems(sub)) expect(i.code.startsWith(sub.code)).toBe(true);
  });
  it("throws on unknown subject", () => expect(() => getSubject(s, 9)).toThrow());
});
