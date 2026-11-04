import type { Question } from '../lib/types';
import { Rich } from './Rich';

const LETTERS = ['A', 'B', 'C', 'D'];

/** One 題目 with the correct option, the user's choice, 詳解 and 相關知識. */
export function Review({ q, picked, index }: { q: Question; picked: number | null; index?: number }) {
  return (
    <div class="review">
      <div class="qhead">{index !== undefined ? <b>第 {index + 1} 題</b> : null} <span class="muted">{q.item}</span></div>
      <Rich text={q.stem} />
      <ul class="options">
        {q.options.map((o, i) => {
          const cls = i === q.answer ? 'right' : i === picked ? 'wrong' : '';
          return (
            <li key={i} class={cls}>
              <span class="letter">{LETTERS[i]}</span>
              <span>{o}</span>
              {i === q.answer ? <em>正確答案</em> : i === picked ? <em>你的答案</em> : null}
            </li>
          );
        })}
      </ul>
      {picked === null ? <p class="muted">未作答</p> : null}
      {q.explanation ? <div class="note"><b>詳解</b><Rich text={q.explanation} /></div> : null}
      {q.related ? <div class="note"><b>相關知識</b><Rich text={q.related} /></div> : null}
    </div>
  );
}
