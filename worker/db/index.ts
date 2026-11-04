import type { D1Database } from '@cloudflare/workers-types';
import { Kysely, type Compilable } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import type { Database } from './schema';

export type DB = Kysely<Database>;

/**
 * 資料存取一律經 Kysely（ADR 0002）。
 * D1 不支援互動式交易，需「全部成功或全部失敗」的多筆寫入改用 atomic()：
 * 在 D1 上以 batch() 執行（D1 batch 為單一交易）；日後換 Postgres 時改以 db.transaction() 實作同一介面即可。
 */
export interface Store {
  db: DB;
  atomic(queries: Compilable[]): Promise<{ changes: number }[]>;
}

export function d1Store(d1: D1Database): Store {
  const db = new Kysely<Database>({ dialect: new D1Dialect({ database: d1 }) });
  return {
    db,
    async atomic(queries) {
      if (queries.length === 0) return [];
      const stmts = queries.map((q) => {
        const c = q.compile();
        return d1.prepare(c.sql).bind(...(c.parameters as unknown[]));
      });
      const results = await d1.batch(stmts);
      return results.map((r) => ({ changes: Number(r.meta?.changes ?? 0) }));
    },
  };
}

/** D1 每個查詢最多 100 個綁定參數；多列 insert 依欄位數切塊。 */
export function chunk<T>(rows: T[], columns: number, maxParams = 100): T[][] {
  const size = Math.max(1, Math.floor(maxParams / columns));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export const bool = (x: unknown) => x === true || x === 1 || x === '1' || x === 't' || x === 'true';
