import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyTranscription } from "../src/verify.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => fs.readFileSync(path.join(here, "fixtures", n), "utf8");
const A = fixture("pdftotext-114-2-s2.txt"); // tight "D   1. stem" layout
const B = fixture("pdftotext-115-1-s1.txt"); // lone answer letters, even mid-stem; letter-spaced text

const q1B = {
  stem: "某位分析師正在建置一套虛構報表解析系統，在進行欄位對應（Field Mapping）之前，需要先對報表進行區塊標記（Block Tagging, BT）。\n請問此步驟的主要目的為何？",
  options: ["將報表轉換為另一種檔案格式", "將報表拆成單一字元，以便後續處理", "判斷各區塊的閱讀順序", "為每個區塊標示其類型，如標題、表格與註腳"],
};
const q2A = {
  stem: "使用虛構套件 foo 處理各門市營收資料（變數為 tb）時，若需取得「月營收」欄位的摘要統計量（如中位數、四分位數等），應使用下列哪一種語法？",
  options: ["tb['月營收'].total()", "tb['月營收'].summary()", "tb['月營收'].ranked()", "tb['月營收'].peek()"],
};

describe("verifyTranscription", () => {
  it("accepts a faithful transcription despite answer-column letters, letter spacing and wrapped lines", () => {
    expect(verifyTranscription(q1B, B, 1)).toBeUndefined();
    expect(verifyTranscription(q2A, A, 2)).toBeUndefined();
  });
  it("accepts a wrapped option and an option label the model left out", () => {
    const q = {
      stem: "一家虛構公司想替 Zeta9 模型做領域微調（Domain Tuning），建立內部問答助理，然而顯示卡容量不足，放不下整套模型的梯度。\n技術主管要求保留原本的參數不動，只新增一小組可學習的部件，因此打算採用 Delta 做法。請問這個做法的最大好處是什麼？",
      options: ["把大模型縮小成學生模型", "逐層刪除不重要的參數後再微調", "原參數維持固定，僅在每層附加低秩的可學習矩陣，使需訓練的參數與顯存占用大減", "改用分段式的注意力運算，減輕長輸入的計算負擔"],
    };
    expect(verifyTranscription(q, B, 2)).toBeUndefined();
  });
  it("rejects options reordered while the answer index would stay the same", () => {
    const swapped = { ...q2A, options: [q2A.options[0]!, q2A.options[2]!, q2A.options[1]!, q2A.options[3]!] };
    expect(verifyTranscription(swapped, A, 2)).toMatch(/option B/);
  });
  it("rejects a fabricated stem and fabricated options", () => {
    expect(verifyTranscription({ ...q1B, stem: "完全捏造的題幹，PDF 裡沒有這段文字" }, B, 1)).toMatch(/stem/);
    expect(verifyTranscription({ ...q1B, options: ["甲甲甲甲甲", "乙乙乙乙乙", "丙丙丙丙丙", "丁丁丁丁丁"] }, B, 1)).toMatch(/option A/);
  });
  it("rejects a stem paired with the options of another question", () => {
    expect(verifyTranscription({ stem: q2A.stem, options: q1B.options }, A, 2)).toMatch(/option/);
  });
  it("tolerates only a bracketed 圖說 caption added to the stem", () => {
    const withCaption = { ...q2A, stem: `${q2A.stem}\n【圖說：長條圖，橫軸為月份，縱軸為營收，七月最高】` };
    expect(verifyTranscription(withCaption, A, 2)).toBeUndefined();
    expect(verifyTranscription({ ...q2A, stem: `${q2A.stem}（圖說：多出來的文字）` }, A, 2)).toMatch(/stem/);
  });
  it("ignores markdown code fences and finds a shared preamble elsewhere in the PDF", () => {
    const pdf = "請依據下方資訊回答第 3~4 題\n 某表有欄位 x 與 y\n\n  3. 哪個欄位是索引？\n (A)x；\n (B)y；\n (C)z；\n (D)w\n  4. 哪個欄位是值？\n (A)x；\n (B)y；\n (C)z；\n (D)w";
    const q = { stem: "請依據下方資訊回答第 3~4 題\n某表有欄位 x 與 y\n哪個欄位是值？", options: ["x", "y", "z", "w"] };
    expect(verifyTranscription(q, pdf, 4)).toBeUndefined();
    expect(verifyTranscription({ stem: "```python\nprint(1)\n```\n輸出為何？", options: ["一", "二", "三", "四"] }, "  5. print(1)\n輸出為何？\n (A)一；\n (B)二；\n (C)三；\n (D)四", 5)).toBeUndefined();
  });
  it("reads through a page break (footer + header lines) in the middle of a stem or an option", () => {
    const pdf = "           某位分析師完成報表模型後，繪製差異圖，發現差異隨預\n C    5.\n\n                           第 1 頁，共 18 頁\n          000 年第零次 測試檢定-中級能力鑑定【虛構範例】\n                       第三科：虛構科目\n                                            考試日期：000 年 00 月 00 日\n 答案   題目\n           測值增大而擴散，最可能代表什麼問題？\n           (A)資料漏失；\n           (B)變異數不齊；\n           (C)特徵不足；\n           (D)標籤錯置";
    const q = { stem: "某位分析師完成報表模型後，繪製差異圖，發現差異隨預測值增大而擴散，最可能代表什麼問題？", options: ["資料漏失", "變異數不齊", "特徵不足", "標籤錯置"] };
    expect(verifyTranscription(q, pdf, 5)).toBeUndefined();
  });
});

// A transcription must equal the PDF's question in full, not merely occur inside it.
describe("verifyTranscription: truncated or padded candidates", () => {
  const cut = (s: string, n: number) => s.slice(0, s.length - n);
  it("rejects a stem cut short at its end, at its start, or without its first line", () => {
    expect(verifyTranscription({ ...q2A, stem: cut(q2A.stem, 12) }, A, 2)).toMatch(/stem/);
    expect(verifyTranscription({ ...q2A, stem: q2A.stem.slice(q2A.stem.indexOf("統計量")) }, A, 2)).toMatch(/line start|truncated/);
    expect(verifyTranscription({ ...q2A, stem: q2A.stem.slice(q2A.stem.indexOf("取得")) }, A, 2)).toMatch(/question 2/); // whole first line dropped
    expect(verifyTranscription({ ...q1B, stem: q1B.stem.slice(q1B.stem.indexOf("請問")) }, B, 1)).toMatch(/question 1|stem/);
  });
  it("rejects an option cut short (including the last one) or padded with extra text", () => {
    for (const [k, letter] of [[0, "A"], [1, "B"], [2, "C"], [3, "D"]] as const) {
      const options = [...q2A.options]; options[k] = options[k]!.slice(0, -3);
      expect(verifyTranscription({ ...q2A, options }, A, 2)).toMatch(new RegExp(`option ${letter}`));
    }
    const padded = [...q2A.options]; padded[3] = `${padded[3]}，並且多出來的一段文字`;
    expect(verifyTranscription({ ...q2A, options: padded }, A, 2)).toMatch(/option D/);
    const midPadded = [...q2A.options]; midPadded[1] = `${midPadded[1]}多出`;
    expect(verifyTranscription({ ...q2A, options: midPadded }, A, 2)).toMatch(/option B/);
  });
  it("binds the match to the question's own number", () => {
    expect(verifyTranscription(q2A, A, 3)).toMatch(/question 3/);
    expect(verifyTranscription(q2A, A, 1)).toMatch(/question 1/);
    expect(verifyTranscription(q2A, A, 9)).toMatch(/question 9/);
  });
  it("does not take an option label inside the stem (行(A)) for an option", () => {
    const pdf = "  7. 程式中行(A)與行(B)各做什麼？\n (A)甲甲；\n (B)乙乙；\n (C)丙丙；\n (D)丁丁";
    expect(verifyTranscription({ stem: "程式中行(A)與行(B)各做什麼？", options: ["甲甲", "乙乙", "丙丙", "丁丁"] }, pdf, 7)).toBeUndefined();
  });
});

describe("verifyTranscription: symbols are content", () => {
  const pdf = "  8. 此圖資料之偏態指標較有可能為下列何者？\n (A)Gamma < 0；\n (B)Gamma > 0；\n (C)Gamma = 0；\n (D)Gamma != 0\n  9. 化簡後的結果為何？\n (A)a + b；\n (B)a - b；\n (C)a * b；\n (D)a / b";
  const stem8 = "此圖資料之偏態指標較有可能為下列何者？";
  it("accepts the faithful operators and rejects A/B swapped (x < 0 vs x > 0 must not collapse)", () => {
    const options = ["Gamma < 0", "Gamma > 0", "Gamma = 0", "Gamma != 0"];
    expect(verifyTranscription({ stem: stem8, options }, pdf, 8)).toBeUndefined();
    expect(verifyTranscription({ stem: stem8, options: [options[1]!, options[0]!, options[2]!, options[3]!] }, pdf, 8)).toMatch(/option A/);
    expect(verifyTranscription({ stem: stem8, options: [options[0]!, options[1]!, "Gamma ≠ 0", options[3]!] }, pdf, 8)).toMatch(/option C/);
  });
  it("tells + - * / apart, and keeps the dot in a decimal", () => {
    expect(verifyTranscription({ stem: "化簡後的結果為何？", options: ["a + b", "a - b", "a * b", "a / b"] }, pdf, 9)).toBeUndefined();
    expect(verifyTranscription({ stem: "化簡後的結果為何？", options: ["a - b", "a + b", "a * b", "a / b"] }, pdf, 9)).toMatch(/option A/);
    const dec = "  3. 學習率應設為多少？\n (A)0.5；\n (B)5；\n (C)0.05；\n (D)50";
    expect(verifyTranscription({ stem: "學習率應設為多少？", options: ["0.5", "5", "0.05", "50"] }, dec, 3)).toBeUndefined();
    expect(verifyTranscription({ stem: "學習率應設為多少？", options: ["05", "5", "0.05", "50"] }, dec, 3)).toMatch(/option A/);
  });
  it("still ignores width, spacing, CJK punctuation and the 「；」 separators, and reads a Markdown table against its layout rows", () => {
    expect(verifyTranscription({ stem: stem8, options: ["Ｇamma ＜ 0", "Gamma＞0", "Gamma = 0", "Gamma != 0"] }, pdf, 8)).toBeUndefined();
    const tbl = "  6. 下表中何者最大？\n   欄位     數值\n   甲       3\n   乙       7\n (A)甲；\n (B)乙；\n (C)甲乙；\n (D)皆非";
    const stem = "下表中何者最大？\n| 欄位 | 數值 |\n|---|---|\n| 甲 | 3 |\n| 乙 | 7 |";
    expect(verifyTranscription({ stem, options: ["甲", "乙", "甲乙", "皆非"] }, tbl, 6)).toBeUndefined();
  });
});

describe("verifyTranscription: a preamble must be declared for a question range containing N", () => {
  const pdf = "  3. 甲題：某連鎖商店分析週營收的標準差。\n (A)甲一；\n (B)甲二；\n (C)甲三；\n (D)甲四\n  4. 乙題：某工廠記錄機台的停機次數。\n (A)乙一；\n (B)乙二；\n (C)乙三；\n (D)乙四";
  const options4 = ["乙一", "乙二", "乙三", "乙四"];
  it("rejects another question's stem used as a prefix (甲題 + 乙題)", () => {
    expect(verifyTranscription({ stem: "甲題：某連鎖商店分析週營收的標準差。\n乙題：某工廠記錄機台的停機次數。", options: options4 }, pdf, 4)).toMatch(/stem/);
    expect(verifyTranscription({ stem: "乙題：某工廠記錄機台的停機次數。", options: options4 }, pdf, 4)).toBeUndefined();
  });
  const group = "請依據下方資訊回答第 5~6 題\n 某表有欄位 x 與 y\n  5. 哪個欄位是索引？\n (A)x；\n (B)y；\n (C)z；\n (D)w\n  6. 哪個欄位是值？\n (A)x；\n (B)y；\n (C)z；\n (D)w\n  7. 哪個欄位最多？\n (A)x；\n (B)y；\n (C)z；\n (D)w";
  const preamble = "請依據下方資訊回答第 5~6 題\n某表有欄位 x 與 y\n";
  it("accepts the declared preamble for every question in its range, and only for them", () => {
    expect(verifyTranscription({ stem: `${preamble}哪個欄位是索引？`, options: ["x", "y", "z", "w"] }, group, 5)).toBeUndefined();
    expect(verifyTranscription({ stem: `${preamble}哪個欄位是值？`, options: ["x", "y", "z", "w"] }, group, 6)).toBeUndefined();
    expect(verifyTranscription({ stem: `${preamble}哪個欄位最多？`, options: ["x", "y", "z", "w"] }, group, 7)).toMatch(/stem/); // 7 is outside 5~6
  });
  it("needs the declaring line itself: a preamble without it is not a 題組 preamble", () =>
    expect(verifyTranscription({ stem: "某表有欄位 x 與 y\n哪個欄位是值？", options: ["x", "y", "z", "w"] }, group, 6)).toMatch(/stem/));
  it("understands 至 and wrapped declarations", () => {
    const g = "下圖為某虛構程式片段。請回答第 8 至 9 題。\n  8. 第一個問題？\n (A)x；\n (B)y；\n (C)z；\n (D)w\n  9. 第二個問題？\n (A)x；\n (B)y；\n (C)z；\n (D)w";
    expect(verifyTranscription({ stem: "下圖為某虛構程式片段。請回答第 8 至 9 題。\n第二個問題？", options: ["x", "y", "z", "w"] }, g, 9)).toBeUndefined();
  });
  it("understands the 「回答以 X~Y 題」 wording (no 第) and a declaration that wraps onto its own line", () => {
    const g = "資料集欄位如下，請根據下述資訊回答以 11~12 題。\n 欄位 a、b 的說明\n  11. 第一個問題？\n (A)x；\n (B)y；\n (C)z；\n (D)w\n  12. 第二個問題？\n (A)x；\n (B)y；\n (C)z；\n (D)w";
    expect(verifyTranscription({ stem: "資料集欄位如下，請根據下述資訊回答以 11~12 題。\n欄位 a、b 的說明\n第二個問題？", options: ["x", "y", "z", "w"] }, g, 12)).toBeUndefined();
    const w = "下圖為某虛構程式片段。請\n 回答\n 第 21~22 題。\n  21. 第一個問題？\n (A)x；\n (B)y；\n (C)z；\n (D)w\n  22. 第二個問題？\n (A)x；\n (B)y；\n (C)z；\n (D)w";
    expect(verifyTranscription({ stem: "下圖為某虛構程式片段。請回答第 21~22 題。\n第二個問題？", options: ["x", "y", "z", "w"] }, w, 22)).toBeUndefined();
  });
  it("ignores an end-of-document line such as 《以下空白》 after the last option", () =>
    expect(verifyTranscription({ stem: "最後一題？", options: ["x", "y", "z", "w"] }, "  50. 最後一題？\n (A)x；\n (B)y；\n (C)z；\n (D)w\n\n        《以下空白》\n\n   第 14 頁，共 14 頁", 50)).toBeUndefined());
  it("rejects a preamble cut short at its head (it must start at a PDF line start)", () => {
    const g = "某虛構商店記錄了下列欄位資訊\n 欄位 x 與 y，請回答第 5~6 題\n  5. 哪個欄位是索引？\n (A)x；\n (B)y；\n (C)z；\n (D)w\n  6. 哪個欄位是值？\n (A)x；\n (B)y；\n (C)z；\n (D)w";
    const stem = (head: string) => `${head}\n欄位 x 與 y，請回答第 5~6 題\n哪個欄位是值？`;
    expect(verifyTranscription({ stem: stem("某虛構商店記錄了下列欄位資訊"), options: ["x", "y", "z", "w"] }, g, 6)).toBeUndefined();
    expect(verifyTranscription({ stem: stem("商店記錄了下列欄位資訊"), options: ["x", "y", "z", "w"] }, g, 6)).toMatch(/stem/);
  });
  it("lets option D end at a line break when the next question's number marker is not on its first line", () => {
    const g = "  1. 第一題？\n (A)x；\n (B)y；\n (C)z；\n (D)w\n 第二題的第一行\n  2. 第二行，接著是題目？\n (A)x；\n (B)y；\n (C)z；\n (D)w";
    expect(verifyTranscription({ stem: "第一題？", options: ["x", "y", "z", "w"] }, g, 1)).toBeUndefined();
  });
});
