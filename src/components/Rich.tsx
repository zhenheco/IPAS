import { splitBlocks } from '../lib/text';

function Inline({ text }: { text: string }) {
  return <>{text.split(/(`[^`\n]+`)/).map((p, i) => (p.startsWith('`') && p.endsWith('`') && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code> : p))}</>;
}

/** Renders question text: prose with inline `code`, and fenced code blocks as <pre><code>. */
export function Rich({ text }: { text: string }) {
  return (
    <div class="rich">
      {splitBlocks(text).map((b, i) =>
        b.type === 'code' ? (
          <pre key={i} data-lang={b.lang || undefined}><code>{b.text}</code></pre>
        ) : (
          <p key={i}><Inline text={b.text} /></p>
        ),
      )}
    </div>
  );
}
