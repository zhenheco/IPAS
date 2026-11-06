/** Canonical origin; astro.config.mjs `site` and robots.txt use the same value. */
export const SITE = 'https://ipas.zhenhe-co.com';
export const SITE_NAME = 'iPAS AI 應用規劃師練習';
export const DEFAULT_OG_IMAGE = '/og/default.jpg';

/** Pages that pass `noindex` to Base.astro; the sitemap leaves them out (robots.test.ts keeps the two in sync). */
export const NOINDEX_PATHS = ['/account/', '/login/', '/result/', '/session/'];

export const isIndexable = (url: string) => !NOINDEX_PATHS.includes(new URL(url, SITE).pathname);

const ORG = { '@type': 'Organization', '@id': `${SITE}/#org`, name: '振禾有限公司', url: SITE };

/** WebSite + Organization graph rendered on every page. */
export const siteJsonLd = () => ({
  '@context': 'https://schema.org',
  '@graph': [
    ORG,
    { '@type': 'WebSite', '@id': `${SITE}/#website`, name: SITE_NAME, url: `${SITE}/`, inLanguage: 'zh-Hant', publisher: { '@id': ORG['@id'] } },
  ],
});

export interface ArticleMeta { title: string; description: string; path: string; image: string; published: string; modified: string }

export const articleJsonLd = (a: ArticleMeta) => ({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: a.title,
  description: a.description,
  image: new URL(a.image, SITE).href,
  datePublished: a.published,
  dateModified: a.modified,
  inLanguage: 'zh-Hant',
  mainEntityOfPage: new URL(a.path, SITE).href,
  author: { '@id': ORG['@id'] },
  publisher: { '@id': ORG['@id'] },
});

export const faqJsonLd = (items: { q: string; a: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});

export const breadcrumbJsonLd = (crumbs: [name: string, path: string][]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: crumbs.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: new URL(path, SITE).href })),
});
