import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertBankComplete, isValidQuestion, loadBank } from './bank';

const fixtures = fileURLToPath(new URL('../test/fixtures/data', import.meta.url));
const emptyDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ipas-bank-'));

describe('loadBank', () => {
  it('default build data excludes source "official" (even if one sits in questions/)', () => {
    const { questions } = loadBank({ dataDir: fixtures, includeOfficial: false });
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.filter((x) => x.source === 'official')).toEqual([]);
    expect(questions.map((x) => x.id)).not.toContain('fx-official-1');
    expect(questions.map((x) => x.id)).not.toContain('fx-leak-official');
  });
  it('includes official questions only when asked', () => {
    const ids = loadBank({ dataDir: fixtures, includeOfficial: true }).questions.map((x) => x.id);
    expect(ids).toContain('fx-official-1');
    expect(ids).toContain('fx-official-3');
  });
  it('loads data/official/variants/*.json only with includeOfficial, and never the dotfile .variants-progress.json', () => {
    const dir = emptyDir();
    const q = (id: string) => ({ id, subject: 3, item: 'L23101', stem: 's', options: ['a', 'b', 'c', 'd'], answer: 0, explanation: '', related: '', source: 'original' });
    const write = (rel: string, data: unknown) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), JSON.stringify(data));
    };
    write('questions/subject-3.json', [q('L23101-001')]);
    write('official/variants/subject-3.json', [q('L23101-V001')]);
    write('official/variants/.variants-progress.json', [q('L23101-V999')]); // shaped like a bank on purpose
    expect(loadBank({ dataDir: dir }).questions.map((x) => x.id)).toEqual(['L23101-001']);
    expect(loadBank({ dataDir: dir, includeOfficial: true }).questions.map((x) => x.id)).toEqual(['L23101-001', 'L23101-V001']);
  });
  it('loads the syllabus', () => {
    const { syllabus } = loadBank({ dataDir: fixtures });
    expect(syllabus.subjects.map((s) => s.subject)).toEqual([1, 2, 3]);
  });
  it('missing data dir still succeeds with an empty bank', () => {
    const b = loadBank({ dataDir: path.join(emptyDir(), 'nope') });
    expect(b.questions).toEqual([]);
    expect(b.syllabus).toEqual({ subjects: [] });
  });
  it('falls back to fixtures only when no question files exist', () => {
    const none = loadBank({ dataDir: emptyDir(), fallbackDir: fixtures });
    expect(none.questions.length).toBeGreaterThan(0);
    const dir = emptyDir();
    fs.mkdirSync(path.join(dir, 'questions'));
    fs.writeFileSync(path.join(dir, 'questions', 'x.json'), '[]');
    expect(loadBank({ dataDir: dir, fallbackDir: fixtures }).questions).toEqual([]);
  });
  it('skips corrupt files and invalid questions, dedupes by id', () => {
    const dir = emptyDir();
    fs.mkdirSync(path.join(dir, 'questions'));
    const good = { id: 'g', subject: 1, item: 'L21101', stem: 's', options: ['a', 'b', 'c', 'd'], answer: 2, explanation: 'e', related: 'r', source: 'original' };
    fs.writeFileSync(path.join(dir, 'questions', 'a.json'), JSON.stringify([good, { ...good, id: 'bad', answer: 7 }, { ...good, options: ['a'] , id: 'bad2' }]));
    fs.writeFileSync(path.join(dir, 'questions', 'b.json'), JSON.stringify([good]));
    fs.writeFileSync(path.join(dir, 'questions', 'c.json'), '{corrupt');
    expect(loadBank({ dataDir: dir }).questions.map((x) => x.id)).toEqual(['g']);
  });
  it('isValidQuestion enforces the data contract', () => {
    const good = { id: 'g', subject: 3, item: 'L23301', stem: 's', options: ['a', 'b', 'c', 'd'], answer: 0, explanation: '', related: '', source: 'original' };
    expect(isValidQuestion(good)).toBe(true);
    expect(isValidQuestion({ ...good, subject: 4 })).toBe(false);
    expect(isValidQuestion({ ...good, answer: -1 })).toBe(false);
    expect(isValidQuestion({ ...good, source: 'other' })).toBe(false);
    expect(isValidQuestion(null)).toBe(false);
  });
});

describe('assertBankComplete (production build gate)', () => {
  it('passes for a bank with a syllabus and questions for 科目1 and 科目3', () => {
    expect(() => assertBankComplete(loadBank({ dataDir: fixtures }))).not.toThrow();
  });
  it('fails clearly when data/syllabus.json is missing', () => {
    const b = loadBank({ dataDir: fixtures });
    expect(() => assertBankComplete({ ...b, syllabus: { subjects: [] } })).toThrow(/data\/syllabus\.json/);
  });
  it('fails clearly when there are no question files at all', () => {
    expect(() => assertBankComplete(loadBank({ dataDir: path.join(emptyDir(), 'nope') }))).toThrow(/data\/questions/);
  });
  it('fails when 科目1 or 科目3 has no questions', () => {
    const b = loadBank({ dataDir: fixtures });
    expect(() => assertBankComplete({ ...b, questions: b.questions.filter((q) => q.subject !== 1) })).toThrow(/科目1/);
    expect(() => assertBankComplete({ ...b, questions: b.questions.filter((q) => q.subject !== 3) })).toThrow(/科目3/);
  });
});
