/**
 * 測試用：以 node:sqlite（記憶體資料庫）模擬 Cloudflare D1 的 prepare/bind/all/run/first/batch/exec，
 * 讓測試走與正式環境相同的 kysely-d1 與 d1Store().atomic() 路徑。batch 以 BEGIN/COMMIT 包成單一交易。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database } from '@cloudflare/workers-types';

type Param = null | number | bigint | string | Uint8Array;
const conv = (v: unknown): Param => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  return v as Param;
};

const isReader = (sql: string) => /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);

class Stmt {
  constructor(private db: DatabaseSync, private sql: string, private params: Param[] = []) {}
  bind(...p: unknown[]) { return new Stmt(this.db, this.sql, p.map(conv)); }
  exec() {
    const st = this.db.prepare(this.sql);
    if (isReader(this.sql)) {
      const rows = st.all(...this.params).map((r) => ({ ...r }));
      return { results: rows, success: true, meta: { changes: /^\s*(select|with|pragma)\b/i.test(this.sql) ? 0 : rows.length, last_row_id: 0 } };
    }
    const r = st.run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async all() { return this.exec(); }
  async run() { return this.exec(); }
  async first(col?: string) {
    const row = this.exec().results[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return col ? row[col] : row;
  }
  async raw() { return this.exec().results.map((r) => Object.values(r)); }
}

export function fakeD1(): { d1: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const d1 = {
    prepare: (sql: string) => new Stmt(raw, sql),
    async batch(stmts: Stmt[]) {
      raw.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.exec());
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql: string) { raw.exec(sql); return { count: 0, duration: 0 }; },
    async dump() { throw new Error('not supported'); },
    withSession() { return d1; },
  };
  return { d1: d1 as unknown as D1Database, raw };
}

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'migrations');

/** 依檔名順序套用 migrations/*.sql */
export function migratedD1() {
  const db = fakeD1();
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) db.raw.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  return db;
}
