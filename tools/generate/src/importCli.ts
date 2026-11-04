import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAnswerKey, pdfLayoutText } from "./answerKey.js";
import { requireApiKey } from "./cli.js";
import { importOfficial } from "./official.js";
import { loadSyllabus } from "./syllabus.js";

export const ALL_EXAMS = ["114-2", "115-1"];

interface ImportFlags {
  /** reuse a .partial that predates the PDF hash (see official.ts) */
  resumeUnhashed?: true;
}
export type ImportArgs = ({ all: true } | { all: false; pdf: string; subject: 1 | 2 | 3; exam: string; approve?: number[] }) & ImportFlags;
export interface Job { pdf: string; subject: 1 | 2 | 3; exam: string; out: string }

export function parseImportArgs(all: string[]): ImportArgs {
  const argv = all.filter((a) => a !== "--resume-unhashed");
  const flags: ImportFlags = argv.length === all.length ? {} : { resumeUnhashed: true };
  if (argv.includes("--all")) {
    if (argv.length !== 1) throw new Error("--all takes no other arguments (except --resume-unhashed)");
    return { all: true, ...flags };
  }
  const v: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]!;
    if (!["--pdf", "--subject", "--exam", "--approve"].includes(k) || argv[i + 1] === undefined) throw new Error(`bad argument: ${k}`);
    v[k.slice(2)] = argv[i + 1]!;
  }
  if (!v.pdf || !v.subject || !v.exam) throw new Error("usage: import-official --pdf <file.pdf> --subject <1|2|3> --exam <e.g. 115-1> [--approve 7,12] [--resume-unhashed]   (or --all [--resume-unhashed])");
  const approve = v.approve === undefined ? undefined : v.approve.split(",").map((x) => x.trim());
  if (approve && !approve.every((x) => /^\d+$/.test(x))) throw new Error("--approve must be a comma-separated list of question numbers, e.g. 7,12");
  if (!/^[123]$/.test(v.subject)) throw new Error("--subject must be 1, 2 or 3");
  if (!/^\d+-\d$/.test(v.exam)) throw new Error("--exam must look like 115-1");
  return { all: false, pdf: v.pdf, subject: Number(v.subject) as 1 | 2 | 3, exam: v.exam, ...(approve && { approve: approve.map(Number) }), ...flags };
}

/** `dataDir` is the repo's data/ directory. */
export function plan(a: ImportArgs, dataDir: string): Job[] {
  const out = (exam: string, subject: number) => path.join(dataDir, "official", `${exam}-s${subject}.json`);
  if (!a.all) return [{ pdf: a.pdf, subject: a.subject, exam: a.exam, out: out(a.exam, a.subject) }];
  return ALL_EXAMS.flatMap((exam) =>
    ([1, 2, 3] as const).map((subject) => ({ pdf: path.join(dataDir, "official", "raw", `${exam}-s${subject}.pdf`), subject, exam, out: out(exam, subject) })));
}

async function main() {
  const args = parseImportArgs(process.argv.slice(2));
  const key = requireApiKey(process.env);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data");
  const syllabus = loadSyllabus(path.join(root, "syllabus.json"));
  const client = new Anthropic({ apiKey: key, maxRetries: 0 }); // withRetry owns retries/backoff
  let failed = 0;
  for (const job of plan(args, root)) {
    const tag = `${job.exam} subject ${job.subject}`;
    if (args.all && fs.existsSync(job.out)) { console.log(`${tag}: ${job.out} exists, skipping (delete it to re-import)`); continue; }
    if (!fs.existsSync(job.pdf)) { console.error(`${tag}: ${job.pdf} not found`); failed++; continue; }
    console.log(`\n== ${tag} (${job.pdf})`);
    const r = await Promise.resolve().then(() => {
      const pdfText = pdfLayoutText(job.pdf);
      return importOfficial({
        client, syllabus, subject: job.subject, exam: job.exam, outFile: job.out,
        pdfBase64: fs.readFileSync(job.pdf).toString("base64"),
        pdfText, key: parseAnswerKey(pdfText),
        ...(!args.all && args.approve && { approve: args.approve }),
        ...(args.resumeUnhashed && { trustUnhashedPartial: true }),
        log: console.log,
      });
    }).catch((e) => ({ error: e as Error }));
    if ("error" in r) { console.error(`${tag}: ERROR ${r.error.message}`); failed++; continue; }
    console.log(`tokens: ${r.usage.input} in / ${r.usage.output} out, rounds ${r.rounds}`);
    if (r.unverified.length) {
      failed++;
      console.error(`${tag}: UNVERIFIED, ${r.unverified.length} question(s) do not match the PDF text and were NOT accepted (review them in ${job.out}.unverified.json; after checking one by hand, re-run with --approve <numbers> to accept exactly the candidate stored there):`);
      for (const m of r.unverified) console.error(`  #${m.number}: ${m.reason}`);
    }
    if (r.missing.length) {
      failed++;
      console.error(`${tag}: FAILED, ${r.missing.length} question(s) not accepted (accepted ones kept in ${job.out}.partial; re-run to retry only these):`);
      for (const m of r.missing) console.error(`  #${m.number}: ${m.reason}`);
    } else if (!r.unverified.length) console.log(`${tag}: wrote ${r.questions.length} questions to ${job.out}`);
  }
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(`ERROR: ${e?.message ?? e}`);
    process.exitCode = 1;
  });
}
