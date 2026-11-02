import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
await build({ entryPoints: ['tests/browser/harness.ts'], bundle: true, outfile: '.test-build/harness.js', format: 'esm', platform: 'browser', jsx: 'automatic', external: ['fs/promises','os','path'], alias: { obsidian: resolve('tests/browser/obsidian.ts') }, define: { 'process.env.NODE_ENV': '"development"' } });
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>TaskInNotes test harness</title><link rel="stylesheet" href="/styles.css"><style>body{font:14px system-ui;max-width:1000px;margin:30px auto;background:#fafafa;color:#222}textarea{width:100%;height:260px;box-sizing:border-box;font:12px monospace}button,select{padding:7px 12px;margin:4px}#rendered{margin:20px 0}dialog{border:1px solid #bbb;border-radius:10px;max-width:460px;padding:25px}.setting-item{margin:14px 0}.setting-item input{display:block;width:100%;box-sizing:border-box;padding:8px}</style></head><body><h1>TaskInNotes integration test harness</h1><p>Simulated Obsidian and Todoist boundaries. No real credentials or remote requests.</p><label>Server scenario <select id="scenario" aria-label="Server scenario"><option value="original">Original</option><option value="replacement">Replacement</option><option value="empty">Empty</option><option value="hierarchy">Hierarchy</option><option value="many-labels">Many labels</option><option value="offline">Offline</option></select></label><p>API calls: <output aria-label="API calls" id="calls">0</output></p><label for="markdown">Note Markdown</label><textarea id="markdown"></textarea><button id="render">Render note</button><button id="restart">Restart plugin</button><div id="rendered"></div><script type="module" src="/harness.js"></script></body></html>`;
const server = createServer(async (request, response) => {
  const routes = { '/styles.css': ['styles.css', 'text/css'], '/harness.js': ['.test-build/harness.js', 'text/javascript'] };
  const route = routes[request.url];
  if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end(html); }
  else if (route) { response.setHeader('Content-Type', route[1]); response.end(await readFile(route[0])); }
  else { response.statusCode = 404; response.end(); }
});
server.listen(4175, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
