import { describe, expect, it } from "vitest";
import { SIMILARITY_LIMIT, ngramJaccard, officialOverlap, tooSimilar } from "../src/similarity.js";
import type { Question } from "../src/types.js";

describe("ngramJaccard (character 4-grams)", () => {
  it("is 1 for identical text and 0 for disjoint text", () => {
    expect(ngramJaccard("某公司導入機器學習模型進行需求預測", "某公司導入機器學習模型進行需求預測")).toBe(1);
    expect(ngramJaccard("甲乙丙丁戊己庚辛", "壬癸子丑寅卯辰巳")).toBe(0);
  });
  it("ignores case, width, whitespace and punctuation", () =>
    expect(ngramJaccard("Ａｂｃ，de fg！Hi", "abcdefghi")).toBe(1));
  it("computes |A∩B| / |A∪B| on 4-grams", () => {
    // "abcde" -> {abcd,bcde}; "abcdf" -> {abcd,bcdf}: 1 shared of 3
    expect(ngramJaccard("abcde", "abcdf")).toBeCloseTo(1 / 3);
  });
  it("treats text shorter than 4 characters as one gram, so equal short stems still match", () => {
    expect(ngramJaccard("abc", "abc")).toBe(1);
    expect(ngramJaccard("abc", "abd")).toBe(0);
  });
  it("is 0 when either side is empty", () => expect(ngramJaccard("", "abcd")).toBe(0));
});

describe("tooSimilar", () => {
  it("rejects at exactly the 0.5 limit and above, accepts below", () => {
    expect(SIMILARITY_LIMIT).toBe(0.5);
    // "abcdef" -> {abcd,bcde,cdef}; "abcdxy" -> {abcd,bcdx,cdxy}: 1/5 = 0.2
    expect(tooSimilar("abcdef", "abcdxy")).toBe(false);
    // 2 shared of 4 grams -> exactly 0.5
    expect(ngramJaccard("abcdef", "abcdeg")).toBeCloseTo(0.5);
    expect(tooSimilar("abcdef", "abcdeg")).toBe(true);
  });
  it("catches a light paraphrase of a long stem but not a new scenario on the same concept", () => {
    const src = "某連鎖咖啡店導入客流量預估系統，店長想了解系統放到新開幕的分店之後是否依然準確，請問下列何者做法最恰當？";
    expect(tooSimilar("某連鎖咖啡店導入客流量預估系統，店長想了解系統放到新開幕的分店之後是否依然準確，請問下列何者做法最合宜？", src)).toBe(true);
    expect(tooSimilar("一間電信業者訓練了流失客戶預測模型，想確認換成新年度客群後結果是否可信，應採用哪種檢驗方法？", src)).toBe(false);
  });
});

describe("officialOverlap (stem, options, explanation and related against official text)", () => {
  const off = {
    id: "OFF-1", stem: "某連鎖咖啡店導入客流量預估系統，店長想了解系統放到新開幕的分店之後是否依然準確，請問下列何者做法最恰當？",
    options: ["使用時間序列交叉驗證，依時間順序切分訓練與驗證資料", "隨機打亂全部資料後再切分訓練集與測試集", "只用訓練資料計算準確率", "增加模型的層數直到訓練誤差為零"],
    explanation: "時間序列資料有先後順序，必須以時間順序切分驗證集，才能避免未來資訊洩漏到訓練階段，因此第一個選項正確，其餘做法都會高估模型表現。",
    related: "交叉驗證的變體包含滾動視窗與擴張視窗，適用於具有趨勢與季節性的資料，並可搭配誤差指標比較不同預測期間的穩定度與偏差。",
  } as unknown as Question;
  const fresh = {
    stem: "一間電信業者訓練了流失客戶預測模型，想確認換成新年度客群後結果是否可信，應採用哪種檢驗方法？",
    options: ["以最近三個月作為驗證區間，之前的資料訓練", "把所有貨單隨機分成兩半", "直接沿用上一季的報表數字", "只觀察訓練時的損失曲線"],
    explanation: "貨運量具有時間先後關係，驗證區間必須晚於訓練區間，所以以最近三個月驗證的做法最合理，隨機切分會讓未來資料進入訓練集。",
    related: "預測模型上線後還需要持續監控偏移，例如輸入分布變化與誤差上升，並定期以新資料重新訓練與回測，以維持預測品質。",
  };
  it("passes an original question", () => expect(officialOverlap(fresh, [off])).toBeUndefined());
  it("rejects a new stem that carries a verbatim official option, naming the option and the official id", () => {
    const q = { ...fresh, options: [off.options[0]!, ...fresh.options.slice(1)] };
    expect(officialOverlap(q, [off])).toMatch(/option A.*OFF-1/);
  });
  it("sees through case, width, whitespace and punctuation changes in a copied option", () => {
    const q = { ...fresh, options: [fresh.options[0]!, "使用時間序列交叉驗證 ， 依時間順序切分訓練與驗證資料。", ...fresh.options.slice(2)] };
    expect(officialOverlap(q, [off])).toMatch(/option B/);
  });
  it("does not reject short generic options that merely coincide", () => {
    const short = { ...off, options: ["Precision", "Recall", "F1", "AUC"] } as unknown as Question;
    expect(officialOverlap({ ...fresh, options: ["Precision", "Recall", "F1", "AUC"] }, [short])).toBeUndefined();
  });
  it("rejects a copied or lightly reworded explanation or related text", () => {
    expect(officialOverlap({ ...fresh, explanation: off.explanation.replace("正確", "合理") }, [off])).toMatch(/explanation.*OFF-1/);
    expect(officialOverlap({ ...fresh, related: off.related }, [off])).toMatch(/related.*OFF-1/);
  });
  it("still rejects a near-copy of the stem", () =>
    expect(officialOverlap({ ...fresh, stem: off.stem.replace("最恰當", "最合宜") }, [off])).toMatch(/stem.*OFF-1/));
  it("rejects an official text pasted into a different field of the generated question (20+ shared characters)", () => {
    const paste = (field: string, text: string) => ({ ...fresh, [field]: `${(fresh as any)[field]}（${text}）` });
    expect(officialOverlap(paste("explanation", off.options[0]!), [off])).toMatch(/OFF-1.*verbatim|verbatim.*OFF-1/); // official option in a new explanation
    expect(officialOverlap(paste("related", off.explanation.slice(5, 40)), [off])).toMatch(/verbatim/);
    expect(officialOverlap(paste("stem", off.related.slice(3, 30)), [off])).toMatch(/verbatim/);
    expect(officialOverlap({ ...fresh, options: [`${fresh.options[0]}，${off.stem.slice(2, 30)}`, ...fresh.options.slice(1)] }, [off])).toMatch(/verbatim/);
  });
  it("does not reject a short coincidence across fields", () =>
    expect(officialOverlap({ ...fresh, explanation: `${fresh.explanation}時間序列交叉驗證` }, [off])).toBeUndefined());
});
