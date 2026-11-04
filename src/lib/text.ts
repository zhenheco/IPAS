export type Block = { type: 'text'; text: string } | { type: 'code'; lang: string; text: string };

/** Split text into prose and fenced code blocks; an unclosed fence stays prose. */
export function splitBlocks(input: string): Block[] {
  const out: Block[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)\n?```/g;
  let last = 0;
  for (const m of input.matchAll(re)) {
    const before = input.slice(last, m.index).replace(/\n$/, '');
    if (before.trim()) out.push({ type: 'text', text: before });
    out.push({ type: 'code', lang: m[1].trim(), text: m[2] });
    last = m.index + m[0].length;
  }
  const rest = input.slice(last).replace(/^\n/, '');
  if (rest.trim()) out.push({ type: 'text', text: rest });
  return out;
}
