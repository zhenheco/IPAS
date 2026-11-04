import fsp from "node:fs/promises";
import path from "node:path";
import type { Question } from "./types.js";

export async function readQuestions(file: string): Promise<Question[]> {
  let text: string;
  try {
    text = await fsp.readFile(file, "utf8");
  } catch (e: any) {
    if (e?.code === "ENOENT") return [];
    throw e;
  }
  const data = JSON.parse(text); // a corrupt file must stop the run, not be overwritten
  if (!Array.isArray(data)) throw new Error(`${file} is not a JSON array`);
  return data;
}

type Fs = Pick<typeof fsp, "mkdir" | "writeFile" | "rename" | "rm">;
let n = 0;

/** Write to a temp file in the same directory, then rename over the target. */
export async function writeJsonAtomic(file: string, data: unknown, fs: Fs = fsp): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${n++}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

/** Variant questions are filed as `<item>-V<NNN>`; they never count toward a 知識點's per-item quota. */
export const isVariantId = (id: unknown): boolean => /-V\d+$/.test(String(id));

/** Question files in a directory; dot-files (.variants-progress.json) are bookkeeping, not questions. */
export const questionFileNames = async (dir: string): Promise<string[]> =>
  (await fsp.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json") && !f.startsWith("."));

/** Every question in the sibling question files (sample.json, the other subjects): duplicate baseline only, never quota. */
export async function readOtherQuestions(outFile: string): Promise<Question[]> {
  const dir = path.dirname(outFile);
  const out: Question[] = [];
  for (const f of (await questionFileNames(dir)).filter((f) => path.join(dir, f) !== outFile)) {
    try {
      const data = JSON.parse(await fsp.readFile(path.join(dir, f), "utf8"));
      if (!Array.isArray(data)) throw new Error("not a JSON array");
      out.push(...data);
    } catch (e) {
      throw new Error(`cannot read ${path.join(dir, f)} for the duplicate check: ${(e as Error).message}`);
    }
  }
  return out;
}
