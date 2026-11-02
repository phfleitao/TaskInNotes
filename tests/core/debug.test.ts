import { expect, it, vi } from 'vitest';
import { DebugLogger } from '../../src/core/debug';
import { TodoistClient } from '../../src/core/todoist';

it('uses a private user-specific folder under the system temporary directory', async () => {
  const {defaultLogDirectory} = await import('../../src/core/log-storage');
  const {join} = await import('node:path');
  vi.stubEnv('TMPDIR', '/different-app-temp');
  try {
    if (process.platform === 'linux') expect(defaultLogDirectory(true)).toBe(join('/different-app-temp', `taskinnotes-${process.getuid!()}`, 'TaskInNotes'));
  } finally { vi.unstubAllEnvs(); }
});

it('writes safe daily API diagnostics only when enabled, rotating by date and location', async () => {
  const written: {dir:string;file:string;line:string}[] = [];
  let settings = { debugEnabled: false, logDirectory: '/first' };
  let date = '2026-11-02T12:00:00.000Z';
  const logger = new DebugLogger(() => settings, async (dir,file,line) => {written.push({dir,file,line});}, () => {}, () => new Date(date));
  const client = new TodoistClient(async () => ({status:200,json:{id:'created'}}), ()=>'secret-token', 30000, event => logger.record(event));
  await client.create({title:'Private title',description:'Private description',labels:['Private label']});
  await logger.flush(); expect(written).toHaveLength(0);
  settings = { debugEnabled: true, logDirectory: '/first' };
  await client.create({title:'Private title',description:'Private description',labels:['Private label']});
  await client.complete('private-task-id');
  settings = { debugEnabled: true, logDirectory: '/second' }; date = '2026-11-03T00:00:00.000Z';
  await client.complete('private-task-id'); await logger.flush();
  expect(written.map(x => [x.dir,x.file])).toEqual([['/first','taskinnotes-2026-11-02.log'],['/first','taskinnotes-2026-11-02.log'],['/second','taskinnotes-2026-11-03.log']]);
  const output = JSON.stringify(written);
  for (const sensitive of ['secret-token','Private title','Private description','Private label']) expect(output).not.toContain(sensitive);
  expect(written[1]!.line).toContain('/tasks/{id}/close');
  expect(written[1]!.line).toContain('private-task-id');
  expect(written[0]!.line).toContain('created');
});

it('records HTTP failure and timeout without blocking the request on log write errors', async () => {
  const lines:string[]=[]; const failure=vi.fn();
  const logger = new DebugLogger(() => ({debugEnabled:true,logDirectory:''}), async (_dir,_file,line) => { lines.push(line); throw new Error('private path'); }, failure);
  const denied = new TodoistClient(async () => ({status:401,json:{}}),()=> 'secret', 1000, e=>logger.record(e));
  await expect(denied.testConnection()).rejects.toMatchObject({code:'authentication'});
  const timeout = new TodoistClient(async () => new Promise(()=>{}),()=> 'secret', 5, e=>logger.record(e));
  await expect(timeout.testConnection()).rejects.toMatchObject({code:'network'});
  await logger.flush(); expect(failure).toHaveBeenCalledTimes(1);
  expect(lines.join('')).toContain('401'); expect(lines.join('')).toContain('timeout');
});

it('stores logs under a TaskInNotes subfolder and clears only matching daily files', async () => {
  const { appendLog, clearLogs, defaultLogDirectory } = await import('../../src/core/log-storage');
  const { mkdtemp, readFile, rm, writeFile, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const folder = await mkdtemp(join(tmpdir(),'taskinnotes-test-'));
  try {
    expect(defaultLogDirectory(true)).toContain(tmpdir());
    await appendLog(true, {} as never, folder, 'taskinnotes-2026-11-02.log', 'line\n');
    const dir=join(folder,'TaskInNotes');
    await appendLog(true, {} as never, folder, 'taskinnotes-2026-11-03.log', 'line2\n');
    await writeFile(join(dir,'unrelated.log'),'keep');
    await writeFile(join(folder,'taskinnotes-2026-11-02.log'),'keep');
    expect(await readFile(join(dir,'taskinnotes-2026-11-02.log'),'utf8')).toBe('line\n');
    expect(await clearLogs(true, folder)).toBe(2);
    expect(await readdir(dir)).toEqual(['unrelated.log']);
    expect(await readFile(join(folder,'taskinnotes-2026-11-02.log'),'utf8')).toBe('keep');
    await expect(appendLog(false, {} as never, '','taskinnotes-2026-11-02.log','x')).rejects.toThrow();
  } finally { await rm(folder,{recursive:true,force:true}); }
});

it('records messages and action IDs while removing the secret from all diagnostic fields', async () => {
  const lines:string[]=[];
  const logger=new DebugLogger(()=>({debugEnabled:true,logDirectory:''}),async (_d,_f,line)=>{lines.push(line);},()=>{});
  const client=new TodoistClient(async()=>({status:400,json:{message:'Request rejected: secret-token'}}),()=> 'secret-token',1000,e=>logger.record(e));
  await expect(client.complete('task-42')).rejects.toBeTruthy();
  await logger.flush();
  expect(lines[0]).toContain('task-42'); expect(lines[0]).toContain('Request rejected');
  expect(lines[0]).not.toContain('secret-token');
});

it('serializes clearing after pending writes without deleting unrelated files', async () => {
  let release!:()=>void; const calls:string[]=[];
  const logger=new DebugLogger(()=>({debugEnabled:true,logDirectory:''}),async()=>{await new Promise<void>(r=>{release=r;}); calls.push('written');},()=>{});
  logger.record({method:'GET',endpoint:'/projects',status:200,durationMs:1,action:'Read projects',message:'Request succeeded'});
  await Promise.resolve();
  const clear=logger.clear(async()=>{calls.push('cleared');return 1;});
  release(); expect(await clear).toBe(1); expect(calls).toEqual(['written','cleared']);
});

it('creates the configured debug folder as soon as logging is enabled', async () => {
  const {ensureLogDirectory, defaultLogDirectory} = await import('../../src/core/log-storage');
  const {mkdtemp, stat, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os'); const {join}=await import('node:path');
  const root=await mkdtemp(join(tmpdir(),'taskinnotes-start-'));
  try {
    expect(defaultLogDirectory(true)).toContain(tmpdir());
    await ensureLogDirectory(true,root);
    expect((await stat(join(root,'TaskInNotes'))).isDirectory()).toBe(true);
  } finally {await rm(root,{recursive:true,force:true});}
});

it('refuses a preexisting symlink for the daily file without modifying its target', async () => {
  const {appendLog} = await import('../../src/core/log-storage');
  const {mkdtemp, mkdir, symlink, writeFile, readFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os'); const {join} = await import('node:path');
  const base = await mkdtemp(join(tmpdir(), 'taskinnotes-link-'));
  try {
    const target = join(base, 'target'); await writeFile(target, 'original');
    await mkdir(join(base, 'TaskInNotes')); await symlink(target, join(base, 'TaskInNotes', 'taskinnotes-2026-11-02.log'));
    await expect(appendLog(true, {} as never, base, 'taskinnotes-2026-11-02.log', 'bad')).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe('original');
  } finally { await rm(base, {recursive:true, force:true}); }
});

it('rejects a linked log directory and hard-linked files and protects normal logs', async () => {
  const {appendLog} = await import('../../src/core/log-storage');
  const {mkdtemp, mkdir, symlink, link, writeFile, readFile, stat, rm, unlink} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os'); const {join} = await import('node:path');
  if (process.platform === 'win32') return; // Windows link creation can require developer privileges.
  const base = await mkdtemp(join(tmpdir(), 'taskinnotes-links-'));
  try {
    const other = join(base,'other'), dir = join(base,'TaskInNotes'), target = join(base,'target');
    await mkdir(other); await symlink(other, dir); await writeFile(target, 'original');
    await expect(appendLog(true, {} as never, base, 'taskinnotes-2026-11-02.log', 'bad')).rejects.toThrow();
    await unlink(dir); await mkdir(dir); const file = join(dir,'taskinnotes-2026-11-02.log');
    await link(target,file);
    await expect(appendLog(true, {} as never, base, 'taskinnotes-2026-11-02.log', 'bad')).rejects.toThrow();
    expect(await readFile(target,'utf8')).toBe('original');
    await unlink(file); await appendLog(true, {} as never, base, 'taskinnotes-2026-11-02.log', 'safe');
    expect((await stat(dir)).mode & 0o777).toBe(0o700); expect((await stat(file)).mode & 0o777).toBe(0o600);
  } finally { await rm(base,{recursive:true,force:true}); }
});
