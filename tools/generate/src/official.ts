import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import { assertCompleteKey } from "./answerKey.js";
import { SoftFailure, requestJson } from "./llm.js";
import { LETTERS, MODEL } from "./prompt.js";
import { writeJsonAtomic } from "./store.js";
import { getSubject, subjectItems } from "./syllabus.js";
import type { Question, Syllabus, Usage } from "./types.js";
import { QuestionValidator } from "./validate.js";
import { verifyTranscription } from "./verify.js";

/*
 * Import of one official exam PDF (50 single-choice questions of one subject) into data/official/<exam>-s<N>.json.
 *
 * Chunking: the whole PDF goes with every call (the model needs the figures and the answer column), but each call
 * asks for only 10 question numbers: 50 questions with 詳解 and 相關知識 would be ~50k+ output tokens in one reply,
 * too close to max_tokens to trust. The PDF block carries cache_control, so calls 2..5 read it from the cache.
 * The printed answer key is parsed separately (answerKey.ts) and every question must match it; a rejected question
 * is asked for again (alone) for up to `maxRounds` rounds, then reported. A final file is written only when all
 * 50 are accepted; accepted questions are kept in <file>.partial (with the PDF's sha256, so it is only ever reused for
 * the same PDF) so a re-run only asks for the rest.
 *
 * The model's words are checked against the PDF's own pdftotext text (verify.ts), not just the answer index. A
 * question that keeps failing that check is never accepted silently: it is reported as unverified and written, with
 * the model's candidate and its sha256, to <file>.unverified.json (git-ignored with the rest of data/official/) for the
 * owner to review. --approve N then accepts exactly that stored candidate (the partial records the approved content
 * hash, so a resumed run keeps it and a changed candidate does not inherit it).
 */

const SYSTEM = `你是 iPAS「AI 應用規劃師」中級的資深命題委員，現在要把使用者附上的「官方公告試題」PDF 整理成題庫資料。所有說明文字使用繁體中文（台灣用語）。

只處理使用者指定題號的題目，逐題輸出：
1. number：PDF 上的題號。
2. stem：題幹，逐字照官方原文，保留程式碼（以 \`\`\`python 圍欄）、數字與標點，表格轉成 Markdown 表格；不可改寫、簡化或補充。若數題共用一段「請依據下方資訊回答第 X~Y 題」的說明，把該段說明完整放在每一題 stem 的開頭。若題目依賴圖片（附圖、下圖）而無法用文字或表格重現，stem 保留官方原句，並在最後另起一行加上「【圖說：…】」，如實描述圖中與解題有關的資訊（座標軸、數值、標籤、趨勢）。
3. options：恰好四個，依官方順序，逐字照官方原文，但去掉開頭的「(A)」等標號與結尾用來分隔選項的「；」。選項內「名稱：說明」的寫法原樣保留。
4. answer：該題左側「答案」欄印刷的正確答案字母，轉成 0 起算的索引（A=0、B=1、C=2、D=3）。以 PDF 印刷的答案為準，不要自行解題後決定；系統會另行與答案欄核對。
5. item：從使用者提供的知識點代碼中，選最貼近該題考點的一個。
6. explanation（詳解）：先說明官方答案為什麼正確，再逐一說明每個錯誤選項為什麼錯誤。引用選項時用內容關鍵詞，不要用 A/B/C/D 或編號指稱選項。內容必須與官方答案一致且事實正確。
7. related（相關知識）：80 至 200 字，補充該題所屬知識點中值得延伸複習的概念，不可直接重述答案。
不要遺漏、新增或重複題目。`;

export function importSchema(itemCodes: string[]) {
  return {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            number: { type: "integer" },
            stem: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            answer: { type: "integer" },
            item: { type: "string", enum: itemCodes },
            explanation: { type: "string" },
            related: { type: "string" },
          },
          required: ["number", "stem", "options", "answer", "item", "explanation", "related"],
          additionalProperties: false,
        },
      },
    },
    required: ["questions"],
    additionalProperties: false,
  } as const;
}

export interface ImportRequestArgs { syllabus: Syllabus; subject: 1 | 2 | 3; exam: string; pdfBase64: string; numbers: number[]; hints: Map<number, string> }

export function buildImportRequest({ syllabus, subject: n, exam, pdfBase64, numbers, hints }: ImportRequestArgs) {
  const subject = getSubject(syllabus, n);
  const items = subjectItems(subject);
  const retry = hints.size
    ? `\n\n前一輪有問題的題目（請重新對照 PDF 後再答）：\n${[...hints].map(([num, why]) => `第 ${num} 題：${why}`).join("\n")}`
    : "";
  const text = `考試：${exam} 梯次，科目${subject.subject}「${subject.name}」（${subject.code}）公告試題
題號：${numbers.join(", ")}

可選的知識點代碼：
${items.map((i) => `- ${i.code} ${i.name}（評鑑主題 ${i.topicCode} ${i.topicName}）`).join("\n")}${retry}`;
  return {
    model: MODEL,
    max_tokens: 64000,
    // Opus 5.5 always thinks; its default effort is medium, so set it explicitly.
    output_config: { effort: "high" as const, format: { type: "json_schema" as const, schema: importSchema(items.map((i) => i.code)) as unknown as Record<string, unknown> } },
    system: SYSTEM,
    messages: [{
      role: "user" as const,
      content: [
        { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: pdfBase64 }, cache_control: { type: "ephemeral" as const } },
        { type: "text" as const, text },
      ],
    }],
  };
}

export interface ImportOptions {
  client: any; // Anthropic SDK client (only client.beta.messages.stream is used)
  syllabus: Syllabus;
  subject: 1 | 2 | 3;
  exam: string;
  pdfBase64: string;
  /** the printed answer key, question number -> 0..3 (answerKey.ts) */
  key: Record<number, number>;
  /** `pdftotext -layout` text of the same PDF: the reference every transcription is checked against */
  pdfText: string;
  outFile: string;
  /**
   * Question numbers the owner reviewed in <file>.unverified.json. The reviewed candidate stored there is accepted as is
   * (the model is not asked again, so a different candidate can never slip in under the same number).
   */
  approve?: number[];
  /** reuse a .partial written before partials carried the PDF hash (only if you know it came from this PDF) */
  trustUnhashedPartial?: boolean;
  expected?: number;
  chunkSize?: number;
  maxRounds?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}
export interface ImportResult {
  questions: Question[];
  missing: { number: number; reason: string }[];
  /** accepted by everything except the PDF text check; see <file>.unverified.json */
  unverified: { number: number; reason: string }[];
  usage: Usage;
  rounds: number;
}

const OPTION_PREFIX = /^\s*[(（][A-DＡ-Ｄ][)）]/;
const TRAILING_SEPARATOR = /\s*[；;]\s*$/;

const hashOf = (q: unknown) => createHash("sha256").update(JSON.stringify(q)).digest("hex");

/** Accepted questions from an earlier run, and the approvals (question number -> content hash). Throws when the file cannot be tied to `sha`, so a wrong PDF is never mixed in. */
async function readPartial(file: string, sha: string, trustUnhashed: boolean): Promise<{ questions: Question[]; approved: Record<string, string> }> {
  let text: string;
  try {
    text = await fsp.readFile(file, "utf8");
  } catch (e: any) {
    if (e?.code === "ENOENT") return { questions: [], approved: {} };
    throw e;
  }
  const data = JSON.parse(text);
  if (Array.isArray(data)) {
    if (trustUnhashed) return { questions: data, approved: {} };
    throw new Error(`${file} was written before partial files recorded their PDF hash, so it cannot be tied to this PDF. If it came from this PDF, re-run with --resume-unhashed to reuse it; otherwise delete it.`);
  }
  if (typeof data?.pdfSha256 !== "string" || !Array.isArray(data.questions)) throw new Error(`${file} is not a valid partial file`);
  if (data.pdfSha256 !== sha) throw new Error(`${file} was made from a different PDF (sha256 ${data.pdfSha256.slice(0, 12)}, this PDF ${sha.slice(0, 12)}); delete it to start this PDF fresh`);
  return { questions: data.questions, approved: data.approved ?? {} };
}

/** The reviewed candidates in <file>.unverified.json, for --approve. Throws unless each requested number has an untouched entry for this PDF. */
async function readReviewed(file: string, sha: string, numbers: number[]): Promise<Map<number, Question>> {
  let data: any;
  try {
    data = JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (e: any) {
    if (e?.code !== "ENOENT") throw e;
  }
  if (data && data.pdfSha256 !== sha) throw new Error(`${file} was made from a different PDF; run the import again before approving`);
  const out = new Map<number, Question>();
  for (const n of numbers) {
    const entry = data?.entries?.find((x: any) => x?.number === n);
    if (!entry) throw new Error(`#${n} has no reviewed candidate in ${file}; run the import once without --approve first, then review that file`);
    if (hashOf(entry.question) !== entry.sha256) throw new Error(`#${n}: the candidate in ${file} was changed after it was written (hash mismatch); re-run the import to regenerate it`);
    out.set(n, entry.question);
  }
  return out;
}

export async function importOfficial(o: ImportOptions): Promise<ImportResult> {
  const { client, syllabus, subject, exam, outFile, expected = 50, chunkSize = 10, maxRounds = 3, log = () => {} } = o;
  assertCompleteKey(o.key, expected);
  const idOf = (num: number) => `OFF-${exam}-S${subject}-${String(num).padStart(2, "0")}`;
  const numberOf = (id: string) => Number(new RegExp(`^${idOf(0).slice(0, -2)}(\\d+)$`).exec(id)?.[1]);

  const validator = new QuestionValidator(syllabus, [], "official");
  const accepted = new Map<number, Question>();
  const partialFile = `${outFile}.partial`;
  const reviewFile = `${outFile}.unverified.json`;
  const approved = new Map<number, string>(); // question number -> hash of the exact content the owner approved
  const sha = createHash("sha256").update(Buffer.from(o.pdfBase64, "base64")).digest("hex");
  let reverified = 0;
  const prior = await readPartial(partialFile, sha, o.trustUnhashedPartial === true);
  const reviewed = o.approve?.length ? await readReviewed(reviewFile, sha, o.approve) : new Map<number, Question>();
  for (const q of prior.questions) {
    const num = numberOf(q?.id);
    if (num >= 1 && num <= expected && q.answer === o.key[num] && !validator.check(q, subject).length) {
      // a resumed question is held to the same PDF text check as a fresh one, unless the owner approved exactly this content
      if (prior.approved[num] === hashOf(q)) approved.set(num, prior.approved[num]!);
      else if (verifyTranscription(q, o.pdfText, num)) { reverified++; continue; }
      validator.add(q);
      accepted.set(num, q);
    }
  }
  for (const [num, q] of reviewed) {
    if (accepted.has(num) && !approved.has(num)) continue; // verified in the meantime (e.g. by an earlier partial): nothing to approve
    const bad = accepted.has(num) ? [] : validator.check(q, subject);
    if (bad.length) throw new Error(`#${num}: the reviewed candidate is no longer valid: ${bad.join("; ")}`);
    if (!accepted.has(num)) { validator.add(q); accepted.set(num, q); }
    approved.set(num, hashOf(q));
    log(`#${num} approved by the owner despite failing the PDF text check (reviewed candidate ${hashOf(q).slice(0, 12)})`);
  }
  if (reverified) log(`${reverified} question(s) in ${partialFile} do not match the PDF text and will be asked again`);
  if (accepted.size) log(`resuming: ${accepted.size}/${expected} already accepted in ${partialFile}`);

  const usage: Usage = { input: 0, output: 0 };
  const reasons = new Map<number, string>(); // why a still-pending question was last rejected
  const hints = new Map<number, string>();
  const unverified = new Map<number, { reason: string; question: Question }>(); // last attempt failed only the PDF text check
  const savePartial = () => writeJsonAtomic(partialFile, { pdfSha256: sha, questions: [...accepted.values()], approved: Object.fromEntries(approved) });
  if (reviewed.size) await savePartial();

  function accept(raw: any, num: number): string | undefined {
    const options: unknown = raw.options;
    if (Array.isArray(options) && options.some((x) => typeof x === "string" && OPTION_PREFIX.test(x))) return 'an option still starts with its "(A)" label';
    if (raw.answer !== o.key[num]) {
      hints.set(num, "你回報的答案與 PDF「答案」欄印刷的答案不符，請重新查看該題左側的答案欄。");
      return `answer ${LETTERS[raw.answer] ?? raw.answer} does not match the printed key ${LETTERS[o.key[num]!]}`;
    }
    const q = {
      id: idOf(num), subject, item: raw.item, stem: raw.stem,
      options: Array.isArray(options) ? options.map((x) => (typeof x === "string" ? x.replace(TRAILING_SEPARATOR, "") : x)) : options,
      answer: raw.answer, explanation: raw.explanation, related: raw.related, source: "official",
    } as unknown as Question;
    const bad = validator.check(q, subject);
    if (bad.length) return bad.join("; ");
    const mismatch = verifyTranscription(q, o.pdfText, num);
    if (mismatch) {
      hints.set(num, `你的逐字轉錄與 PDF 文字不符（${mismatch}）。請重新對照 PDF，題幹與四個選項都要逐字照抄、選項順序與 PDF 相同。`);
      unverified.set(num, { reason: mismatch, question: q });
      return mismatch;
    }
    validator.add(q);
    accepted.set(num, q);
    return undefined;
  }

  const pending = () => Array.from({ length: expected }, (_, i) => i + 1).filter((num) => !accepted.has(num));
  let rounds = 0;
  while (pending().length && rounds < maxRounds) {
    rounds++;
    const todo = pending();
    for (let i = 0; i < todo.length; i += chunkSize) {
      const numbers = todo.slice(i, i + chunkSize);
      for (const num of numbers) unverified.delete(num);
      let questions: any[];
      try {
        const parsed = await requestJson(client, buildImportRequest({ syllabus, subject, exam, pdfBase64: o.pdfBase64, numbers, hints: new Map([...hints].filter(([num]) => numbers.includes(num))) }), usage, o.sleep);
        if (!Array.isArray(parsed?.questions)) throw new SoftFailure("response has no questions array");
        questions = parsed.questions;
      } catch (e) {
        if (!(e instanceof SoftFailure)) throw e;
        log(`round ${rounds} #${numbers[0]}-${numbers[numbers.length - 1]}: ${e.message}`);
        for (const num of numbers) reasons.set(num, e.message);
        continue;
      }
      const seen = new Set<number>();
      for (const raw of questions) {
        const num = raw?.number;
        if (!numbers.includes(num) || seen.has(num)) { log(`round ${rounds}: ignored unrequested or repeated question ${String(num)}`); continue; }
        seen.add(num);
        const why = accept(raw, num);
        if (why) { reasons.set(num, why); log(`round ${rounds} #${num} rejected: ${why}`); }
      }
      for (const num of numbers) if (!accepted.has(num) && !seen.has(num)) reasons.set(num, "not returned by the model");
      await savePartial();
    }
  }

  const left = pending();
  const missing = left.filter((n) => !unverified.has(n)).map((number) => ({ number, reason: reasons.get(number) ?? "not returned by the model" }));
  const unv = left.filter((n) => unverified.has(n)).map((number) => ({ number, reason: unverified.get(number)!.reason }));
  const questions = [...accepted.entries()].sort(([a], [b]) => a - b).map(([, q]) => q);
  if (unv.length) await writeJsonAtomic(reviewFile, { pdfSha256: sha, entries: unv.map((u) => ({ ...u, sha256: hashOf(unverified.get(u.number)!.question), question: unverified.get(u.number)!.question })) });
  else await fsp.rm(reviewFile, { force: true });
  if (!missing.length && !unv.length) {
    await writeJsonAtomic(outFile, questions);
    await fsp.rm(partialFile, { force: true });
  }
  return { questions, missing, unverified: unv, usage, rounds };
}
