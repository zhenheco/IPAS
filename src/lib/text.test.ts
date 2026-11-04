import { describe, expect, it } from 'vitest';
import { splitBlocks } from './text';

describe('splitBlocks', () => {
  it('plain text is one text block', () => {
    expect(splitBlocks('hello')).toEqual([{ type: 'text', text: 'hello' }]);
  });
  it('extracts fenced python code blocks', () => {
    const out = splitBlocks('前文\n```python\nprint(1)\n```\n後文');
    expect(out).toEqual([
      { type: 'text', text: '前文' },
      { type: 'code', lang: 'python', text: 'print(1)' },
      { type: 'text', text: '後文' },
    ]);
  });
  it('handles fences without a language and multiple blocks', () => {
    const out = splitBlocks('```\na\n```\n```py\nb\n```');
    expect(out).toEqual([{ type: 'code', lang: '', text: 'a' }, { type: 'code', lang: 'py', text: 'b' }]);
  });
  it('an unclosed fence stays as text instead of swallowing everything', () => {
    expect(splitBlocks('x\n```python\nnever closed')).toEqual([{ type: 'text', text: 'x\n```python\nnever closed' }]);
  });
});
