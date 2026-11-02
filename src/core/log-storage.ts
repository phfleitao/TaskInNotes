import type { DataAdapter } from 'obsidian';

const filenamePattern = /^taskinnotes-\d{4}-\d{2}-\d{2}\.log$/;
export function defaultLogDirectory(desktop: boolean): string {
  if (!desktop) return '';
  const path = require('path') as typeof import('path');
  const os = require('os') as typeof import('os');
  const temp = os.tmpdir();
  const userTemp = process.platform === 'win32' ? temp : path.join(temp, `taskinnotes-${process.getuid?.() ?? 'user'}`);
  return path.join(userTemp, 'TaskInNotes');
}
function resolveDirectory(desktop: boolean, configured: string): string {
  if (!desktop) throw new Error('Local diagnostic logs are available on desktop only');
  const path = require('path') as typeof import('path');
  if (!configured.trim()) return defaultLogDirectory(true);
  if (!path.isAbsolute(configured.trim())) throw new Error('Log directory must be absolute');
  return path.join(configured.trim(), 'TaskInNotes');
}
export async function appendLog(desktop: boolean, _adapter: DataAdapter, configured: string, filename: string, line: string): Promise<void> {
  if (!filenamePattern.test(filename)) throw new Error('Invalid log filename');
  const directory = resolveDirectory(desktop, configured);
  const path = require('path') as typeof import('path');
  const fs = require('fs/promises') as typeof import('fs/promises');
  await ensureLogDirectory(desktop, configured);
  const file = path.join(directory, filename);
  let existing: import('fs').Stats | undefined;
  try { existing = await fs.lstat(file); if (existing.isSymbolicLink()) throw new Error('Log file cannot be a symbolic link'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const constants = fs.constants;
  const handle = await fs.open(file, constants.O_WRONLY | constants.O_APPEND | (existing ? 0 : constants.O_CREAT | constants.O_EXCL) | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (existing && (existing.dev !== stat.dev || existing.ino !== stat.ino)) || (process.getuid && stat.uid !== process.getuid())) throw new Error('Unsafe log file');
    if (process.platform !== 'win32') await handle.chmod(0o600);
    await handle.writeFile(line, { encoding: 'utf8' });
  } finally { await handle.close(); }
}
async function secureDirectory(directory: string): Promise<void> {
  const fs = require('fs/promises') as typeof import('fs/promises');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Unsafe log directory');
  if (process.platform !== 'win32') await fs.chmod(directory, 0o700);
}
export async function ensureLogDirectory(desktop: boolean, configured: string): Promise<void> {
  const directory = resolveDirectory(desktop, configured);
  if (!configured.trim() && process.platform !== 'win32') {
    const path = require('path') as typeof import('path');
    await secureDirectory(path.dirname(directory));
  }
  await secureDirectory(directory);
}
export async function clearLogs(desktop: boolean, configured: string): Promise<number> {
  const directory = resolveDirectory(desktop, configured);
  const path = require('path') as typeof import('path');
  const fs = require('fs/promises') as typeof import('fs/promises');
  let entries: import('fs').Dirent[];
  try { const stat = await fs.lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Unsafe log directory'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
  const matching = entries.filter(entry => entry.isFile() && filenamePattern.test(entry.name));
  for (const entry of matching) await fs.unlink(path.join(directory, entry.name));
  return matching.length;
}
