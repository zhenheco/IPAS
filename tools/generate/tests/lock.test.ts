import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { acquireLock } from "../src/lock.js";

const tmp = async () => path.join(await fs.mkdtemp(path.join(os.tmpdir(), "lock-")), "out.json.lock");
const exists = (f: string) => fs.access(f).then(() => true, () => false);

describe("acquireLock", () => {
  it("creates the lock with our pid and removes it on release", async () => {
    const f = await tmp();
    const release = await acquireLock(f);
    expect((await fs.readFile(f, "utf8")).trim()).toBe(String(process.pid));
    await release();
    expect(await exists(f)).toBe(false);
  });

  it("refuses to start when the lock exists, names the path and leaves the other lock alone", async () => {
    const f = await tmp();
    await fs.writeFile(f, "12345");
    await expect(acquireLock(f)).rejects.toThrow(f);
    expect(await fs.readFile(f, "utf8")).toBe("12345");
  });

  it("removes the lock when the process gets SIGINT", async () => {
    const f = await tmp();
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/hold-lock.ts");
    const child = spawn(process.execPath, ["--import", "tsx", script, f], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((res, rej) => {
      child.stdout.once("data", () => res());
      child.once("exit", () => rej(new Error("child exited before locking")));
    });
    expect(await exists(f)).toBe(true);
    const code = new Promise<number | null>((r) => child.once("exit", r));
    child.kill("SIGINT");
    expect(await code).toBe(130);
    expect(await exists(f)).toBe(false);
  });
});
