import { describe, expect, it } from "vitest";
import { distribute } from "../src/distribute.js";

describe("distribute", () => {
  it("splits evenly", () => expect(distribute(300, 10)).toEqual(Array(10).fill(30)));
  it("gives the remainder to the first items", () => expect(distribute(10, 4)).toEqual([3, 3, 2, 2]));
  it("handles total < n", () => expect(distribute(2, 4)).toEqual([1, 1, 0, 0]));
  it("always sums to total", () => {
    for (const [t, n] of [[300, 11], [299, 14], [7, 3], [0, 5]] as const)
      expect(distribute(t, n).reduce((a, b) => a + b, 0)).toBe(t);
  });
  it("rejects bad input", () => {
    expect(() => distribute(-1, 3)).toThrow();
    expect(() => distribute(5, 0)).toThrow();
    expect(() => distribute(1.5, 3)).toThrow();
  });
});
