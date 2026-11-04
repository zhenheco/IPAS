import { execFileSync } from "node:child_process";

/**
 * The official answer letter sits in a 「答案」 column left of each question number. `pdftotext -layout` renders it
 * either inline ("C    2.   stem", "D   1. stem") or, for some first questions, on a line of its own right next
 * to the number line. Option markers "(A)" never match because the letter must be bare, at indent <= 6.
 */
const INLINE = /^\s{0,6}([A-D])\s+(\d{1,2})\.(?!\d)/;
const LONE = /^\s{0,6}([A-D])\s*$/;
const NUMBER = /^\s*(\d{1,2})\.(?!\d)\s/;

/** question number -> answer index 0..3, read from `pdftotext -layout` output. */
export function parseAnswerKey(text: string): Record<number, number> {
  const lines = text.normalize("NFKC").split("\n");
  const key: Record<number, number> = {};
  const put = (n: number, letter: string) => {
    const idx = "ABCD".indexOf(letter);
    if (key[n] !== undefined && key[n] !== idx) throw new Error(`question ${n} has two different printed answers (${"ABCD"[key[n]!]} and ${letter})`);
    key[n] = idx;
  };
  lines.forEach((line, i) => {
    const inline = INLINE.exec(line);
    if (inline) return put(Number(inline[2]), inline[1]!);
    const lone = LONE.exec(line);
    if (!lone) return;
    // A lone letter belongs to the numbered line directly before or after it.
    const m = NUMBER.exec(lines[i - 1] ?? "") ?? NUMBER.exec(lines[i + 1] ?? "");
    if (m) put(Number(m[1]), lone[1]!);
  });
  return key;
}

/** The printed key must name every question 1..expected exactly once; anything else means the parse (or the PDF) is wrong. */
export function assertCompleteKey(key: Record<number, number>, expected: number): void {
  const extra = Object.keys(key).map(Number).filter((n) => n < 1 || n > expected);
  if (extra.length) throw new Error(`answer key has question numbers outside 1..${expected}: ${extra.join(", ")}`);
  const missing = Array.from({ length: expected }, (_, i) => i + 1).filter((n) => key[n] === undefined);
  if (missing.length) throw new Error(`answer key is missing question(s) ${missing.join(", ")} (read ${expected - missing.length}/${expected})`);
}

/** Deterministic `pdftotext -layout` text of a PDF: the reference for the answer key and for transcription checks. */
export function pdfLayoutText(pdf: string): string {
  // execFileSync with an argv array: the path is never interpreted by a shell.
  return execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 64 << 20 });
}

export const pdfAnswerKey = (pdf: string): Record<number, number> => parseAnswerKey(pdfLayoutText(pdf));
