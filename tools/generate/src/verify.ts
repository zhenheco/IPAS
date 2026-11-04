/*
 * Check the model's transcription of an official question against the deterministic `pdftotext -layout` text of the
 * same PDF. The printed answer key only proves the answer index; this proves the words are the PDF's, all of them.
 *
 * Both sides are normalised the same way (NFKC, case, whitespace and text punctuation removed; operators and other
 * symbols are kept, see `norm`), so letter spacing, line wrapping, full-width forms and the 「；」 option separators
 * do not matter. On the PDF side the left "答案" column and the running page header/footer lines are dropped, and an option label "(A)".."(D)" that starts a line is kept as a
 * marker (a "(A)" inside a sentence is ordinary text).
 *
 * Rule, per question number N: some option-A label in the text must be preceded by the full stem and followed by the
 * four full options, each option ending exactly where the next label begins, and option D ending at a line break. The stem must start at a line
 * start. The matched block must contain the line that carries N's number marker, which ties it to question N and not to
 * a look-alike.
 *
 * Tolerances, and the only ones: a bracketed figure caption 【圖說：…】 (the import prompt asks for it when a question
 * depends on a picture) and Markdown code fences are dropped from the stem, a Markdown table is compared by its cells,
 * and a stem may begin with a 題組 preamble followed by its own contiguous part. That preamble counts only if the PDF
 * declares it for a question range containing N ("…請回答第 X~Y 題" / "第 X 至 Y 題") and the preamble text includes the
 * declaring line; any other text before the question's own lines (another question's stem, say) is rejected.
 *
 * Known limit: option D runs straight into the next question's first line, so a candidate D that stops short exactly at
 * a line break (a wrapped last line dropped), or a stem missing leading lines above N's marker line, cannot be told
 * from the neighbour's text. Cuts inside a line, and a dropped first line when the stem starts on the marker line, are caught.
 */

const LABELS = ["", "", "", ""]; // private-use stand-ins for line-start "(A)".."(D)"
const PAGE_NOISE = /能力鑑定【[^】]*】|^\s*第[一二三]科[：:]|考試日期[：:]|第\s*\d+\s*頁[，,]?\s*共\s*\d+\s*頁|^\s*(答|案|題目|答案\s+題目|題目\s+答案)\s*$|《以下空白》/;
const WITH_LETTER = /^\s{0,6}[A-D](?=\s|$)(?:\s+(\d{1,2})\.(?!\d))?/; // answer column, optionally followed by the number
const NUMBER_ONLY = /^\s{0,6}(\d{1,2})\.(?!\d)/;
const RANGE = /(?:第\s*(\d{1,2})\s*(?:[~\-–—]|至|到)\s*(\d{1,2})\s*題|(?:回答|作答)\s*以?\s*(\d{1,2})\s*(?:[~\-–—]|至|到)\s*(\d{1,2})\s*題)/;
const LINE_LABEL = /^\s*\(\s*([A-D])\s*\)/;

/*
 * Symbols are content: `x < 0` and `x > 0`, `a + b` and `a - b` must stay different. Only whitespace and text
 * punctuation (，。、；：？「」 quotes ...) are dropped; operators, brackets, math symbols and currency signs are kept, and
 * so is a dot or comma between digits (0.5 is not 05).
 */
const KEEP = new Set([..."<>=+-*/^%!&|()[]{}~$#@_.,"]);
const norm = (s: string) =>
  s.normalize("NFKC").replace(/\([A-D]\)/g, "").toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, (c) => (KEEP.has(c) || /[\p{Sm}\p{Sc}]/u.test(c) ? c : ""))
    .replace(/[.,](?!\d)|(?<!\d)[.,]/g, "");

interface Parsed {
  F: string; // normalised text, line after line
  starts: number[]; // offset in F where each kept line begins
  lens: number[];
  markers: Map<number, { line: number; hasText: boolean }[]>; // question number -> marker lines
  anchors: number[]; // offsets of option-A labels
  ranges: { from: number; to: number; line: number }[]; // 「請回答第 X~Y 題」 declarations
}

let last: { text: string; parsed: Parsed } | undefined;

function parse(text: string): Parsed {
  if (last?.text === text) return last.parsed;
  const p: Parsed = { F: "", starts: [], lens: [], markers: new Map(), anchors: [], ranges: [] };
  for (const raw of text.normalize("NFKC").split("\n")) {
    if (PAGE_NOISE.test(raw)) continue;
    let line = raw;
    let number: number | undefined;
    const m = WITH_LETTER.exec(line) ?? NUMBER_ONLY.exec(line);
    if (m) { line = line.slice(m[0].length); if (m[1]) number = Number(m[1]); }
    let label = -1;
    line = line.replace(LINE_LABEL, (_, l: string) => { label = "ABCD".indexOf(l); return ""; });
    const t = (label >= 0 ? LABELS[label] : "") + norm(line);
    if (label === 0) p.anchors.push(p.F.length);
    const range = RANGE.exec(line);
    if (range && t.length) p.ranges.push({ from: Number(range[1] ?? range[3]), to: Number(range[2] ?? range[4]), line: p.starts.length });
    if (number !== undefined) {
      const list = p.markers.get(number) ?? [];
      list.push({ line: p.starts.length, hasText: t.length > 0 });
      p.markers.set(number, list);
    }
    p.starts.push(p.F.length);
    p.lens.push(t.length);
    p.F += t;
  }
  last = { text, parsed: p };
  return p;
}

const lineAt = (p: Parsed, offset: number) => {
  for (let i = p.starts.length - 1; i >= 0; i--) if (p.lens[i]! > 0 && p.starts[i]! <= offset) return i;
  return -1;
};

/** A Markdown table row is compared by its cells (the PDF has no pipes); the |---| rule row is dropped. */
const tableRow = (l: string) => (/^\s*\|.*\|\s*$/.test(l) ? (/^[\s|:-]+$/.test(l) ? "" : l.replace(/\|/g, " ")) : l);

function stemSegments(stem: string): string[] {
  return stem.replace(/【圖說[：:][^】]*】/g, "").split("\n").filter((l) => !/^\s*```/.test(l)).map(tableRow).map(norm).filter(Boolean);
}

/** Is `lead` (the model's stem lines before the question's own) a preamble the PDF declares for a range containing `number`? */
function declared(p: Parsed, lead: string, number: number): boolean {
  for (const r of p.ranges) {
    if (number < r.from || number > r.to) continue;
    const hs = p.starts[r.line]!, he = hs + p.lens[r.line]!;
    for (let i = p.F.indexOf(lead); i >= 0; i = p.F.indexOf(lead, i + 1))
      if (i <= hs && i + lead.length >= he && p.starts.some((st, l) => st === i && p.lens[l]! > 0)) return true; // starts at a line start
  }
  return false;
}

const preview = (s: string) => (s.length > 16 ? `${s.slice(0, 16)}…` : s);

/** Returns why the transcription of question `number` does not match the PDF text, or undefined when it does. */
export function verifyTranscription(q: { stem: string; options: string[] }, pdfText: string, number: number): string | undefined {
  const p = parse(pdfText);
  const segs = stemSegments(q.stem);
  if (!segs.length) return "stem is empty";
  const options = q.options.map(norm);
  const empty = options.findIndex((o) => !o);
  if (empty >= 0) return `option ${"ABCD"[empty]} is empty`;
  const mine = p.markers.get(number)?.map((m) => m.line) ?? [];
  if (!mine.length) return `question ${number}'s number marker was not found in the PDF text`;
  if (!p.anchors.length) return "no option labels (A) were found in the PDF text";

  const boundary = new Set([...p.starts, p.F.length]);
  let best = 0, why = "";
  const fail = (stage: number, msg: string) => { if (stage > best) { best = stage; why = msg; } };

  for (const a of p.anchors) {
    // stem: the longest contiguous tail of its lines that ends right before this label; earlier lines are a shared preamble
    const before = p.F.slice(0, a);
    let k = 0;
    while (k < segs.length && !before.endsWith(segs.slice(k).join(""))) k++;
    if (k === segs.length) { fail(1, `stem text does not end right before an option A in the PDF ("${preview(segs[segs.length - 1]!)}")`); continue; }
    if (k > 0 && !declared(p, segs.slice(0, k).join(""), number)) { fail(1, `stem lines before the question's own ("${preview(segs[0]!)}") are not a preamble the PDF declares for question ${number}`); continue; }
    const s = a - segs.slice(k).join("").length;
    const stemLine = lineAt(p, s);
    if (stemLine < 0 || p.starts[stemLine] !== s) { fail(2, "stem does not start at a PDF line start (truncated?)"); continue; }

    let pos = a + 1;
    let ok = true;
    for (let i = 0; i < 4 && ok; i++) {
      if (!p.F.startsWith(options[i]!, pos)) { fail(3, `option ${"ABCD"[i]} differs from the PDF (altered, reordered or from another question)`); ok = false; break; }
      pos += options[i]!.length;
      if (i < 3 && p.F[pos] !== LABELS[i + 1]) { fail(3, `option ${"ABCD"[i]} does not end where option ${"ABCD"[i + 1]} begins in the PDF (truncated or padded)`); ok = false; break; }
      if (i < 3) pos++;
    }
    if (!ok) continue;
    const endLine = lineAt(p, pos - 1);
    if (!mine.some((m) => m >= stemLine && m <= endLine)) { fail(6, `the matching text is not question ${number}'s block (its number marker lies elsewhere)`); continue; }
    // Option D runs straight into the next question's first line, whose number marker may sit on a later line, so only
    // a line break can be required here; after the last question the text must be over.
    const endsRight = boundary.has(pos) && (p.markers.has(number + 1) || pos === p.F.length);
    if (!endsRight) { fail(5, "option D does not end where the PDF question ends (truncated or padded)"); continue; }
    return undefined;
  }
  return why;
}
