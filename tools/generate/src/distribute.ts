/** Split `total` across `n` items as evenly as possible; the remainder goes to the first items. */
export function distribute(total: number, n: number): number[] {
  if (!Number.isInteger(total) || total < 0) throw new Error(`total must be a non-negative integer, got ${total}`);
  if (!Number.isInteger(n) || n < 1) throw new Error(`n must be a positive integer, got ${n}`);
  const base = Math.floor(total / n);
  const extra = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}
