import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const folder = 'dist/taskinnotes';
await mkdir(folder, { recursive: true });
const files = ['manifest.json', 'main.js', 'styles.css'];
for (const file of files) await copyFile(file, `${folder}/${file}`);
const notices = [];
for (const name of ['react', 'react-dom', 'scheduler', 'yaml']) {
  notices.push(`${name}\n${await readFile(`node_modules/${name}/LICENSE`, 'utf8')}`);
}
const noticePath = `${folder}/THIRD_PARTY_NOTICES.txt`;
await writeFile(noticePath, notices.join('\n\n--------------------\n\n'));
// zip is a packaging tool only; the installed plugin has no system dependencies.
const archive = `dist/taskinnotes-${manifest.version}.zip`;
execFileSync('zip', ['-q', '-j', archive, ...files.map(file => `${folder}/${file}`), noticePath]);
console.log(`Private plugin folder: ${folder}\nPrivate ZIP: ${archive}`);
