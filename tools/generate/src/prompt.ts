import type { ItemRef, Question, SyllabusSubject } from "./types.js";

export const MODEL = "claude-opus-5-5";

export const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          stem: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          answer: { type: "integer" },
          explanation: { type: "string" },
          related: { type: "string" },
        },
        required: ["stem", "options", "answer", "explanation", "related"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

const BASE_RULES = `你是 iPAS「AI 應用規劃師」{LEVEL}的資深命題委員，負責為本站撰寫原創練習題。所有文字使用繁體中文（台灣用語），專有名詞可附英文。

命題規則：
1. 難度對標{LEVEL}正式考試：每科 50 題單選題，每題四個選項、只有一個正確答案。題目要能區分「真正理解」與「死背名詞」，不要只考名詞定義的逐字背誦。
2. 題型要混合：概念辨析題、情境應用題（給一段企業或專案情境，問最適當的做法或判斷）、計算題（給數字，要求算出結果、比較或判讀指標）。若該知識點不適合計算，以情境應用題取代，不要硬湊不合理的數字。
3. 完全原創：不得抄襲、改寫或默寫任何既有考題、歷屆試題、教科書或網頁文字；題幹情境與數字都要自行設計。
4. 選項要彼此平行：長度相近、句型一致、語氣相同，不可讓正確答案特別長或特別詳細；干擾選項要似是而非（常見迷思、容易混淆的概念），而不是明顯荒謬。不要使用「以上皆是」「以上皆非」，選項文字內不要加 A/B/C/D 或 1/2/3/4 標號。
5. 正確答案必須客觀、無爭議，不可依賴主觀偏好；題幹不可暗示答案。
6. 正確答案的位置依使用者訊息逐題指定的 answer 值（0 起算的選項索引），不得自行調整。
7. explanation（詳解）：先說明正確答案為什麼正確，再逐一說明每個錯誤選項為什麼錯誤。提到選項時引用其內容關鍵詞，不要用 A/B/C/D 或編號指稱選項。
8. related（相關知識）：80 至 200 字，補充該題所屬知識點中值得延伸複習的概念，不可直接重述答案。
9. 同一批題目彼此不可重複同一考法或同一情境，也要避開使用者列出的「已出過的題幹」。
10. 只依使用者指定的知識點命題，不要跨到其他知識點。`;

const BEGINNER_RULES = `

初級的額外規則：考生多為非資訊背景的職場人士與學生，重概念理解與職場應用判斷。不出程式碼題、不考複雜數學推導；計算題只限簡單比例、準確率、精確率、召回率等基本判讀。否定題（何者「不」正確）不超過兩成，且須以引號強調「不」。`;

const CODE_RULES = `

科目 3 的額外規則：約三成題目應為 Python 程式碼閱讀題（使用 scikit-learn、PyTorch 或 numpy），在 stem 中以 Markdown 圍欄 \`\`\`python 附上 5 至 15 行可執行的短程式，問輸出結果、張量形狀、錯誤原因、資料洩漏、超參數意義或最適當的修改。程式要正確且自成一體；若問輸出，答案必須是你能確定的輸出（不要依賴隨機性）。若該知識點不適合程式題（例如治理、法規、偏見與公平性的概念面），改以概念或情境題取代，不要硬塞程式碼。`;

const CALIBRATION_RULES = `

官方歷屆試題範例（校準用）：使用者訊息會附上數題官方歷屆試題作為範例。請對標它們的難度、題幹長度、情境寫法與選項格式；若自然，採用官方常見的「名稱：說明」選項寫法（例如「LoRA：凍結原權重並加入低秩矩陣」）。範例只用來校準風格：不得沿用範例的情境、數字、人物或公司設定、用字，也不得改寫範例題幹；你的題目必須針對指定的知識點，並考與範例不同的觀念與角度。`;


export const LETTERS = ["A", "B", "C", "D"] as const;

/** An official question as the model sees it in a prompt: stem and lettered options, plus the printed answer. */
export const renderQuestion = (q: Question): string =>
  `題幹：${q.stem}\n${q.options.map((o, i) => `(${LETTERS[i]})${o}`).join("\n")}\n（官方答案：${LETTERS[q.answer]}）`;

/** `n` target answer positions (0..3), as even as possible, in random order. */
export function balancedPositions(n: number, rng: () => number = Math.random): number[] {
  const offset = Math.floor(rng() * 4);
  const p = Array.from({ length: n }, (_, i) => (i + offset) % 4);
  for (let i = p.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  return p;
}

/** Rules for a 科目: 初級 (11, 12) get the 初級 rules, 中級 科目3 the code-reading rule; `extra` is appended (calibration, variants). */
export function systemPrompt(n: number, extra = ""): string {
  const beginner = n >= 11;
  const base = BASE_RULES.replaceAll("{LEVEL}", beginner ? "初級" : "中級");
  return (beginner ? base + BEGINNER_RULES : n === 3 ? base + CODE_RULES : base) + extra;
}

export interface RequestArgs {
  subject: SyllabusSubject;
  item: ItemRef;
  count: number;
  positions: number[];
  existingStems: string[];
  /** official questions to calibrate difficulty and style against (see selectExemplars); none = no calibration */
  exemplars?: Question[];
}

export function buildRequest({ subject, item, count, positions, existingStems, exemplars = [] }: RequestArgs) {
  const seen = existingStems.length
    ? `\n\n已出過的題幹（避免重複主題與考法）：\n${existingStems.map((s) => `- ${s}`).join("\n")}`
    : "";
  const calibration = exemplars.length
    ? `\n\n官方歷屆試題範例（只供對標難度與寫法，不可沿用其情境、數字或用字）：\n${exemplars.map((q, i) => `範例 ${i + 1}（${q.item}）\n${renderQuestion(q)}`).join("\n\n")}`
    : "";
  const content = `科目：科目${subject.subject}「${subject.name}」（${subject.code}）
評鑑主題：${item.topicCode} ${item.topicName}
知識點：${item.code} ${item.name}

請產出 ${count} 題原創單選題。各題正確答案的位置如下（answer 為 0 起算的選項索引）：
${positions.map((p, i) => `第 ${i + 1} 題 answer = ${p}`).join("\n")}${seen}${calibration}`;

  return {
    model: MODEL,
    max_tokens: 64000,
    // Opus 5.5 always thinks; its default effort is medium, so set it explicitly.
    output_config: { effort: "high" as const, format: { type: "json_schema" as const, schema: QUESTION_SCHEMA as unknown as Record<string, unknown> } },
    system: systemPrompt(subject.subject, exemplars.length ? CALIBRATION_RULES : ""),
    messages: [{ role: "user" as const, content }],
  };
}
