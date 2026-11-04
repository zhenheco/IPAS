import { useState } from 'preact/hooks';
import { emptyState, exportJson, importJson } from '../lib/storage';
import { Card, SaveWarning, useApp } from './app';

export default function Settings() {
  const { state, update, saveOk } = useApp();
  const [msg, setMsg] = useState('');
  if (!state) return <p class="muted">載入中…</p>;

  const download = () => {
    const url = URL.createObjectURL(new Blob([exportJson(state)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `ipas-records-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const text = await file.text();
    const res = importJson(text, state);
    if (!res.ok) return setMsg(`匯入失敗：${res.error}`);
    if (!confirm(`將以檔案內容取代目前的 ${state.sessions.length} 筆作答歷史與錯題本，確定嗎？`)) return;
    // applied onto the latest stored state, so an in-progress session / 全真模考 from another tab is kept
    await update((cur) => { const r = importJson(text, cur); return r.ok ? r.state : cur; });
    setMsg(`已匯入 ${res.state.sessions.length} 筆作答歷史。`);
  };

  return (
    <>
      <h1>設定</h1>
      <SaveWarning ok={saveOk} />
      <Card>
        <h3>紀錄備份</h3>
        <p class="muted">所有紀錄只存在這個瀏覽器。換裝置前請先匯出，再到另一台匯入。</p>
        <p>目前共 {state.sessions.length} 筆作答歷史、{Object.keys(state.questionStats).length} 題有作答統計。</p>
        <div class="row">
          <button class="btn" onClick={download}>匯出 JSON</button>
          <label class="btn ghost">匯入 JSON<input type="file" accept="application/json,.json" hidden onChange={onFile} /></label>
        </div>
        {msg ? <p role="status">{msg}</p> : null}
      </Card>
      <Card>
        <h3>清除紀錄</h3>
        <p class="muted">刪除這個瀏覽器中的全部作答歷史、錯題本與進行中的作答，無法復原。</p>
        <button class="btn danger" onClick={async () => { if (confirm('確定要清除全部紀錄嗎？建議先匯出備份。')) { await update(() => emptyState()); setMsg('已清除。'); } }}>清除全部紀錄</button>
      </Card>
    </>
  );
}
