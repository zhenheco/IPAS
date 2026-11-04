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
