import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { NOINDEX_PATHS, SITE, articleJsonLd, faqJsonLd, isIndexable } from './seo';

const pagesDir = new URL('../pages/', import.meta.url);
const astroPages = (readdirSync(pagesDir, { recursive: true }) as string[]).filter((f) => f.endsWith('.astro'));
const src = (f: string) => readFileSync(new URL(f, pagesDir), 'utf8');

describe('seo', () => {
  it('sitemap filter drops exactly the noindex pages', () => {
    const flagged = astroPages.filter((f) => /<Base\b[^>]*\bnoindex\b/.test(src(f))).map((f) => `/${f.replace(/(index)?\.astro$/, '')}`.replace(/([^/])$/, '$1/'));
    expect(flagged.sort()).toEqual([...NOINDEX_PATHS].sort());
    for (const p of NOINDEX_PATHS) expect(isIndexable(`${SITE}${p}`)).toBe(false);
    expect(isIndexable(`${SITE}/guide/`)).toBe(true);
    expect(isIndexable(`${SITE}/`)).toBe(true);
  });

  it('every page gives Base.astro a description (directly or via the Article layout)', () => {
    for (const f of astroPages) expect(src(f), f).toMatch(/<Base\b[^>]*\bdescription=|<Article\b[^>]*\bpath=/);
  });

  it('builds absolute Article and FAQPage JSON-LD', () => {
    const a = articleJsonLd({ title: 't', description: 'd', path: '/guide/x/', image: '/guide/x.svg', published: '2026-11-06', modified: '2026-11-06' });
    expect(a.mainEntityOfPage).toBe(`${SITE}/guide/x/`);
    expect(a.image).toBe(`${SITE}/guide/x.svg`);
    expect(faqJsonLd([{ q: 'Q', a: 'A' }]).mainEntity[0]).toEqual({ '@type': 'Question', name: 'Q', acceptedAnswer: { '@type': 'Answer', text: 'A' } });
  });
});

describe('guides', async () => {
  const { GUIDES } = await import('./guides');
  it('every guide has its own page, hero images and a meta-length description', () => {
    for (const g of GUIDES) {
      expect(astroPages).toContain(`guide/${g.path.split('/')[2]}.astro`);
      for (const ext of ['jpg', 'webp']) expect(() => readFileSync(new URL(`../../public/guide/img/${g.image}.${ext}`, import.meta.url))).not.toThrow();
      expect(g.description.length).toBeGreaterThan(50);
      expect(g.description.length).toBeLessThanOrEqual(160);
    }
  });
});
