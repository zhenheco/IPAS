import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/** Exclusive lock file holding our pid. Returns a release function; also released on SIGINT/SIGTERM. */
export async function acquireLock(file: string): Promise<() => Promise<void>> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  let fh;
  try {
    fh = await fsp.open(file, "wx");
  } catch (e: any) {
    if (e?.code === "EEXIST")
      throw new Error(`Another generation run seems to be using this output: lock file ${file} exists. If no run is active (e.g. it was killed), delete that file and retry.`);
    throw e;
  }
  try {
    await fh.writeFile(String(process.pid));
  } finally {
    await fh.close();
  }
  const onSignal = (sig: NodeJS.Signals) => {
    fs.rmSync(file, { force: true });
    process.exit(sig === "SIGINT" ? 130 : 143);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return async () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await fsp.rm(file, { force: true });
  };
}
