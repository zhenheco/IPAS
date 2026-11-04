import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  integrations: [preact()],
});
