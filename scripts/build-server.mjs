import { build } from 'esbuild'

await build({
  entryPoints: ['server-v2.js'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'server-bundle.cjs',
  define: {
    'import.meta.url': '__import_meta_url',
  },
  banner: {
    js: 'var __import_meta_url=require("url").pathToFileURL(__filename).href;',
  },
})
