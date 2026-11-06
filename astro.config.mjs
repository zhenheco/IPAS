import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import { SITE, isIndexable } from './src/lib/seo.ts';

export default defineConfig({
  site: SITE,
  output: 'static',
  trailingSlash: 'always',
  integrations: [preact(), sitemap({ filter: isIndexable })],
});
