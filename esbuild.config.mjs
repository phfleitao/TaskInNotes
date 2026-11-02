import { build, context } from 'esbuild';
const options = { entryPoints: ['src/main.tsx'], outfile: 'main.js', bundle: true,
  external: ['obsidian', 'electron', 'fs/promises', 'os', 'path', '@codemirror/state', '@codemirror/view', '@codemirror/language'],
  format: 'cjs', platform: 'browser', target: 'es2022', jsx: 'automatic',
  minify: true, sourcemap: false, legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' } };
if (process.argv.includes('--watch')) await (await context(options)).watch();
else await build(options);
