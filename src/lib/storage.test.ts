import { describe, expect, it } from 'vitest';
import { STORAGE_KEY, emptyState, exportJson, importJson, loadState, parseState, saveState, updateState, withLock } from './storage';
import type { AppState, Session } from './types';

const session: Session = {
  id: 's1', mode: 'practice', subject: 3, startedAt: '2026-11-01T00:00:00.000Z', submittedAt: '2026-11-01T00:10:00.000Z',
  questionIds: ['a', 'b'], answers: [0, null], score: 50,
};
const fakeStore = (init: Record<string, string> = {}) => {
  const m = { ...init };
  return {
    getItem: (k: string) => (k in m ? m[k] : null),
    setItem: (k: string, v: string) => { m[k] = v; },
    dump: () => m,
  };
};
const throwing = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('quota'); },
};

describe('parseState', () => {
  it('empty state has schemaVersion 1', () => {
    expect(emptyState()).toEqual({ schemaVersion: 1, sessions: [], questionStats: {}, active: null, fullExam: null });
  });
  it('null / corrupt JSON / non-object / wrong version -> empty state, never throws', () => {
    for (const raw of [null, '', '{bad', '[]', '"x"', 'null', '{"schemaVersion":2,"sessions":[]}', '{"sessions":[]}']) {
      expect(parseState(raw)).toEqual(emptyState());
    }
  });
  it('round-trips a valid state', () => {
    const s: AppState = { ...emptyState(), sessions: [session], questionStats: { a: { attempts: 1, correct: 0, wrong: 1, lastWrongAt: session.submittedAt, redoStreak: 0, inWrongBook: true } } };
    expect(parseState(JSON.stringify(s))).toEqual(s);
  });
  it('drops malformed pieces but keeps valid ones', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      sessions: [session, { id: 'bad' }, 5],
      questionStats: { a: { attempts: 1, correct: 1, wrong: 0, lastWrongAt: null, redoStreak: 0, inWrongBook: false }, b: 'nope' },
      active: { nonsense: true },
      fullExam: 3,
    });
    const s = parseState(raw);
    expect(s.sessions).toEqual([session]);
    expect(Object.keys(s.questionStats)).toEqual(['a']);
    expect(s.active).toBeNull();
    expect(s.fullExam).toBeNull();
  });
});

describe('loadState / saveState', () => {
  it('load returns empty when storage throws or is missing', () => {
    expect(loadState(throwing)).toEqual(emptyState());
    expect(loadState(undefined)).toEqual(emptyState());
  });
  it('save returns false (no throw) when storage throws', () => {
    expect(saveState(emptyState(), throwing)).toBe(false);
    expect(saveState(emptyState(), undefined)).toBe(false);
  });
  it('save then load', () => {
    const store = fakeStore();
    const s = { ...emptyState(), sessions: [session] };
    expect(saveState(s, store)).toBe(true);
    expect(Object.keys(store.dump())).toEqual([STORAGE_KEY]);
    expect(loadState(store)).toEqual(s);
  });
});

describe('export / import', () => {
  const state: AppState = {
    ...emptyState(),
    sessions: [session],
    questionStats: { a: { attempts: 1, correct: 0, wrong: 1, lastWrongAt: null, redoStreak: 0, inWrongBook: true } },
    active: { id: 'x', mode: 'exam', subject: 1, startedAt: 1, deadline: 2, questionIds: ['a'], answers: [null], flagged: [false] },
  };
  it('export carries schemaVersion, sessions and stats but not the in-progress session', () => {
    const o = JSON.parse(exportJson(state));
    expect(o.schemaVersion).toBe(1);
    expect(o.sessions).toHaveLength(1);
    expect(o.questionStats.a.wrong).toBe(1);
    expect(o.active).toBeUndefined();
  });
  it('import replaces sessions and stats, keeps the local in-progress session', () => {
    const res = importJson(exportJson(state), { ...emptyState(), active: state.active });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.sessions).toEqual([session]);
      expect(res.state.active).toEqual(state.active);
    }
  });
  it('import rejects corrupt or wrong-version input without touching state', () => {
    expect(importJson('{oops', emptyState()).ok).toBe(false);
    expect(importJson('{"schemaVersion":9}', emptyState()).ok).toBe(false);
    expect(importJson('[]', emptyState()).ok).toBe(false);
  });
});

describe('importJson strict validation (whole file or nothing)', () => {
  const stat = { attempts: 2, correct: 1, wrong: 1, lastWrongAt: '2026-11-01T00:00:00.000Z', redoStreak: 0, inWrongBook: true };
  const file = (over: Record<string, unknown> = {}) => JSON.stringify({ schemaVersion: 1, sessions: [session], questionStats: { a: stat }, ...over });
  const local: AppState = { ...emptyState(), sessions: [{ ...session, id: 'keep' }] };
  const reject = (text: string) => {
    const r = importJson(text, local);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(3);
    return r;
  };
  it('accepts a fully valid file', () => {
    expect(importJson(file(), local).ok).toBe(true);
  });
  it('requires sessions and questionStats to be present with the right container type', () => {
    reject(JSON.stringify({ schemaVersion: 1, questionStats: {} }));
    reject(JSON.stringify({ schemaVersion: 1, sessions: [] }));
    reject(file({ sessions: {} }));
    reject(file({ questionStats: [] }));
  });
  it('rejects the whole import when any single session is invalid, naming the record', () => {
    const r = reject(file({ sessions: [session, { ...session, id: 's2', answers: [4, null] }] }));
    if (!r.ok) expect(r.error).toContain('2');
    reject(file({ sessions: [{ ...session, answers: [-1, null] }] }));
    reject(file({ sessions: [{ ...session, answers: [0.5, null] }] }));
    reject(file({ sessions: [{ ...session, answers: [0] }] })); // length != questionIds
    reject(file({ sessions: [{ ...session, score: 101 }] }));
    reject(file({ sessions: [{ ...session, score: 50.5 }] }));
    reject(file({ sessions: [{ ...session, mode: 'nap' }] }));
    reject(file({ sessions: [{ ...session, subject: 4 }] }));
    reject(file({ sessions: [{ ...session, startedAt: 'not a date' }] }));
    reject(file({ sessions: [{ ...session, fullId: 5 }] }));
    reject(file({ sessions: [session, session] })); // duplicate id
    reject(file({ sessions: [session, 5] }));
  });
  it('rejects invalid per-question stats', () => {
    reject(file({ questionStats: { a: stat, b: 'nope' } }));
    reject(file({ questionStats: { a: { ...stat, attempts: -1 } } }));
    reject(file({ questionStats: { a: { ...stat, wrong: 1.5 } } }));
    reject(file({ questionStats: { a: { ...stat, correct: 3 } } })); // correct > attempts
    reject(file({ questionStats: { a: { ...stat, inWrongBook: 'yes' } } }));
    reject(file({ questionStats: { a: { ...stat, lastWrongAt: 'garbage' } } }));
    reject(file({ questionStats: { a: { ...stat, redoStreak: -1 } } }));
  });
  it('never mutates the local state on rejection (caller keeps existing data)', () => {
    const before = JSON.stringify(local);
    importJson(file({ sessions: [{ ...session, score: 999 }] }), local);
    expect(JSON.stringify(local)).toBe(before);
  });
});

describe('updateState: read-modify-write at the moment of each write (two tabs)', () => {
  const add = (id: string) => (s: AppState): AppState => ({ ...s, sessions: [...s.sessions, { ...session, id }] });
  it("two tabs holding stale memory do not overwrite each other's writes", () => {
    const store = fakeStore();
    let memA = emptyState();
    let memB = emptyState();
    memA = updateState(add('from-A'), store, memA).state;
    memB = updateState(add('from-B'), store, memB).state; // B never saw A's write in memory
    memA = updateState(add('from-A2'), store, memA).state;
    expect(loadState(store).sessions.map((x) => x.id)).toEqual(['from-A', 'from-B', 'from-A2']);
    expect(memB.sessions.map((x) => x.id)).toEqual(['from-A', 'from-B']);
  });
  it('a stale tab cannot resurrect a session another tab already submitted', () => {
    const store = fakeStore();
    const active = { id: 'x', mode: 'practice' as const, subject: 1 as const, startedAt: 1, deadline: null, questionIds: ['a'], answers: [null], flagged: [false] };
    saveState({ ...emptyState(), active }, store);
    updateState((s) => ({ ...s, active: null, sessions: [{ ...session, id: 'x' }] }), store); // tab B submits
    const r = updateState((s) => (s.active ? { ...s, active: { ...s.active, answers: [1] } } : s), store, { ...emptyState(), active }); // tab A edits late
    expect(r.state.active).toBeNull();
    expect(loadState(store).sessions).toHaveLength(1);
  });
  it('falls back to the in-memory state when storage is unavailable, and reports saved=false', () => {
    const mem = { ...emptyState(), sessions: [session] };
    const r = updateState(add('n'), throwing, mem);
    expect(r.saved).toBe(false);
    expect(r.state.sessions.map((x) => x.id)).toEqual(['s1', 'n']);
  });
});

describe('withLock (Web Locks around every read-modify-write)', () => {
  const fakeLocks = () => {
    const log: string[] = [];
    let tail: Promise<unknown> = Promise.resolve();
    return {
      log,
      request: <T>(name: string, cb: () => T | Promise<T>) => {
        log.push(name);
        const run = tail.then(() => cb());
        tail = run.catch(() => undefined);
        return run;
      },
    };
  };
  it("runs the callback under the 'ipas-state' lock and returns its result", async () => {
    const locks = fakeLocks();
    expect(await withLock(locks, () => 42)).toBe(42);
    expect(locks.log).toEqual(['ipas-state']);
  });
  it('falls back to running directly when Web Locks is unavailable', async () => {
    expect(await withLock(undefined, () => 'direct')).toBe('direct');
  });
  it('serializes concurrent read-modify-write cycles so none is lost', async () => {
    const store = fakeStore();
    const locks = fakeLocks();
    const bump = (id: string) => withLock(locks, async () => {
      const base = parseState(store.getItem(STORAGE_KEY)); // read
      await Promise.resolve(); // another tab would interleave here without the lock
      saveState({ ...base, sessions: [...base.sessions, { ...session, id }] }, store); // write
    });
    await Promise.all([bump('t1'), bump('t2'), bump('t3')]);
    expect(loadState(store).sessions.map((x) => x.id)).toEqual(['t1', 't2', 't3']);
  });
});

describe('failed writes keep the unsaved in-memory state', () => {
  const add = (id: string) => (s: AppState): AppState => ({ ...s, sessions: [...s.sessions, { ...session, id }] });
  it('after a failed write, the next update builds on memory instead of the older stored copy', () => {
    const m: Record<string, string> = {};
    let failing = true;
    const store = {
      getItem: (k: string) => (k in m ? m[k] : null),
      setItem: (k: string, v: string) => { if (failing) throw new Error('quota'); m[k] = v; },
    };
    const r1 = updateState(add('A'), store, emptyState());
    expect(r1.saved).toBe(false);
    const r2 = updateState(add('B'), store, r1.state, true); // unsaved = true: prefer memory
    expect(r2.saved).toBe(false);
    expect(r2.state.sessions.map((x) => x.id)).toEqual(['A', 'B']);
    failing = false;
    const r3 = updateState(add('C'), store, r2.state, true);
    expect(r3.saved).toBe(true);
    expect(loadState(store).sessions.map((x) => x.id)).toEqual(['A', 'B', 'C']);
  });
  it('without the unsaved flag the stored copy still wins (normal multi-tab case)', () => {
    const store = fakeStore();
    saveState({ ...emptyState(), sessions: [{ ...session, id: 'other-tab' }] }, store);
    expect(updateState(add('mine'), store, emptyState()).state.sessions.map((x) => x.id)).toEqual(['other-tab', 'mine']);
  });
});

describe('import is applied onto the latest stored state', () => {
  it('keeps the active session and fullExam another tab wrote after this tab last loaded', () => {
    const store = fakeStore();
    const text = exportJson({ ...emptyState(), sessions: [session] });
    const stale = emptyState(); // what the Settings tab saw when the file was chosen
    expect(importJson(text, stale).ok).toBe(true);
    const active = { id: 'live', mode: 'exam' as const, subject: 3 as const, startedAt: 1, deadline: 2, questionIds: ['a'], answers: [null], flagged: [false] };
    saveState({ ...emptyState(), active, fullExam: { id: 'F', elective: 3, stage: 'break', breakDeadline: 9 } }, store); // other tab
    const r = updateState((cur) => { const i = importJson(text, cur); return i.ok ? i.state : cur; }, store, stale);
    expect(r.state.sessions).toEqual([session]);
    expect(r.state.active).toEqual(active);
    expect(r.state.fullExam).toMatchObject({ id: 'F', stage: 'break' });
  });
});
