import { describe, expect, it } from "vitest";
import { getSubject, subjectItems } from "../src/syllabus.js";
import { syllabus } from "./helpers.js";

describe("syllabus.json", () => {
  const s = syllabus();
  it("has the 34 official 知識點 over 3 subjects", () => {
    expect(s.subjects.map((x) => x.code)).toEqual(["L21", "L22", "L23"]);
    expect(s.subjects.flatMap((x) => subjectItems(x)).length).toBe(34);
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
