import { it, expect, vi } from 'vitest';
import { NoteRuntime } from '../../src/core/runtime';
import { TaskError, type Task, type TaskProvider } from '../../src/core/model';
const block = '```taskinnotes\nid: a\nfilter: "date: {{property:date}}"\n```';
function setup(text: string) {
  let note = text, title = '2026-11-02', writes = 0, calls = 0, editing = false;
  const provider: TaskProvider = { async query() { calls++; return [{ id: 't', title: 'Fresh task', project: 'Inbox', projectId: 'p', due: null, isRecurring: false }]; }, async create() { return 'id'; }, async complete() {} };
  const runtime = new NoteRuntime({ key: 'file', read: async () => note, update: async transform => { const next = transform(note); if (next !== note) { note = next; writes++; } }, title: () => title, isEditing: () => editing }, provider);
  return { runtime, get note() { return note; }, set note(value) { note = value; }, set title(value: string) { title = value; }, set editing(value: boolean) { editing = value; }, get counts() { return { writes, calls }; } };
}
it('uses current frontmatter and invalidates trusted state when a used property changes', async () => {
  const f = setup('---\ndate: 2026-11-02\n---\n' + block);
  const first = (await f.runtime.inspect())[0]!;
  await first.controller!.refresh(); expect(f.note).toContain('Fresh task');
  f.note = f.note.replace('date: 2026-11-02', 'date: 2026-11-03');
  const changed = (await f.runtime.inspect())[0]!;
  expect(changed.resolvedFilter).toBe('date: 2026-11-03'); expect(changed.controller!.state.tasks).toBeUndefined();
  expect(f.counts.calls).toBe(1);
});
it('initializes and resolves duplicates only against a fresh unambiguous document', async () => {
  const f = setup('```taskinnotes\nfilter: today\n```');
  let blocks = await f.runtime.inspect(); await f.runtime.assignId(blocks[0]!, 'first');
  expect(f.note).toContain('id: "first"');
  f.note += '\n' + f.note;
  blocks = await f.runtime.inspect(); expect(blocks[1]!.duplicate).toBe(true);
  await f.runtime.assignId(blocks[1]!, 'copy');
  expect((await f.runtime.inspect()).map(b => b.config?.id)).toEqual(['first', 'copy']);
  const stale = (await f.runtime.inspect())[1]!; f.note = 'Concurrent\n' + f.note;
  await expect(f.runtime.assignId(stale, 'wrong')).rejects.toThrow();
  expect(f.note).not.toContain('wrong');
});
it('defers repair while editing and preserves unrelated concurrent edits', async () => {
  const f = setup('```taskinnotes\nid: a\nfilter: today\n```');
  const original = (await f.runtime.inspect())[0]!; await original.controller!.refresh();
  f.note = 'User added a paragraph\n' + f.note.replace('Fresh task', 'Edited snapshot');
  f.editing = true; await original.controller!.repair(); expect(f.note).toContain('Edited snapshot');
  f.editing = false; await original.controller!.repair();
  expect(f.note).toContain('Fresh task'); expect(f.note.startsWith('User added a paragraph')).toBe(true);
  expect(f.counts.calls).toBe(1);
});

it('observes rapid filter edits immediately so an old result cannot revive after changing back', async () => {
  let release!: (tasks: never[]) => void;
  let note = '```taskinnotes\nid: a\nfilter: today\n```';
  const runtime = new NoteRuntime({ key: 'file', read: async () => note, update: async fn => { note = fn(note); }, title: () => 'Notes', isEditing: () => false }, { query: () => new Promise(r => { release = r; }), async create() { return ''; }, async complete() {} });
  const controller = (await runtime.inspect())[0]!.controller!;
  const fetch = controller.refresh();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  note = note.replace('today', 'overdue'); runtime.observe(note);
  note = note.replace('overdue', 'today'); runtime.observe(note);
  release([]); await fetch;
  expect(controller.state.tasks).toBeUndefined(); expect(note).not.toContain('taskSnapshot');
});

it('does not persist an obsolete response that was already waiting in the write queue', async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => { release = r; }), queued = new Promise<void>(r => { entered = r; });
  let note = '```taskinnotes\nid: a\nfilter: today\n```';
  const runtime = new NoteRuntime({ key: 'file', read: async () => note, update: async fn => { entered(); await gate; note = fn(note); }, title: () => 'Notes', isEditing: () => false }, { async query() { return []; }, async create() { return ''; }, async complete() {} });
  const controller = (await runtime.inspect())[0]!.controller!;
  const fetch = controller.refresh(); await queued;
  note = note.replace('today', 'overdue'); runtime.observe(note);
  note = note.replace('overdue', 'today'); runtime.observe(note);
  release(); await fetch;
  expect(note).not.toContain('taskSnapshot'); expect(controller.state.tasks).toBeUndefined();
});

it('serializes a new Refresh behind a pending local repair instead of dropping its save', async () => {
  let note = '```taskinnotes\nid: a\nfilter: today\n```', hold = false, release!: () => void, entered!: () => void, query = 0;
  const gate = new Promise<void>(r => { release = r; }), queued = new Promise<void>(r => { entered = r; });
  const runtime = new NoteRuntime({ key: 'file', read: async () => note, update: async fn => { if (hold) { entered(); await gate; } note = fn(note); }, title: () => 'Notes', isEditing: () => false }, { async query() { return [{ id: 't', title: ++query === 1 ? 'Original' : 'New response', projectId: 'p', project: 'Inbox', due: null, isRecurring: false }]; }, async create() { return ''; }, async complete() {} });
  const controller = (await runtime.inspect())[0]!.controller!;
  await controller.refresh(); note = note.replace('Original', 'Tampered'); hold = true;
  const repair = controller.repair(); await queued;
  const refresh = controller.refresh();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  release(); await Promise.all([repair, refresh]);
  expect(note).toContain('New response'); expect(note).not.toContain('Tampered');
});

it('reconciles all blocks of the open note after completion, including an unloaded block', async () => {
  let note='```taskinnotes\nid: a\nfilter: today\n```\n\n```taskinnotes\nid: b\nfilter: overdue\n```';
  let tasks=[{id:'t',title:'Shared task',project:'Inbox',projectId:'p',due:null,isRecurring:false}];
  const filters:string[]=[];
  const provider:TaskProvider={async query(filter){filters.push(filter); return [...tasks];},async create(){return 'new';},async complete(){tasks=[];}};
  const runtime=new NoteRuntime({key:'note',read:async()=>note,update:async fn=>{note=fn(note);},title:()=> 'Note',isEditing:()=>false,isOpen:()=>true},provider);
  const [first,second]=await runtime.inspect();
  expect(filters).toEqual([]);
  await first!.controller!.refresh();
  await first!.controller!.complete('t');
  await vi.waitFor(()=>expect(second!.controller!.state.tasks).toEqual([]));
  expect(second!.controller!.state.stale).toBe(false);
  await vi.waitFor(()=>expect((note.match(/tasks: \[\]/g)||[]).length).toBe(2));
  expect(filters).toContain('overdue');
  runtime.dispose();
});

it('keeps the previous snapshot and a warning if another block cannot refresh', async () => {
  let note='```taskinnotes\nid: a\nfilter: today\n```\n\n```taskinnotes\nid: b\nfilter: overdue\n```'; let fail=false;
  const task={id:'t',title:'Existing',project:'Inbox',projectId:'p',due:null,isRecurring:false};
  const provider:TaskProvider={async query(filter){if(fail && filter==='overdue') throw new TaskError('network','Offline');return [task];},async create(){fail=true;return 'new';},async complete(){}};
  const runtime=new NoteRuntime({key:'note',read:async()=>note,update:async fn=>{note=fn(note);},title:()=> 'Note',isEditing:()=>false,isOpen:()=>true},provider);
  const [first,second]=await runtime.inspect(); await second!.controller!.refresh(); const previous=second!.controller!.state.snapshot;
  await first!.controller!.create({title:'Created'});
  await vi.waitFor(()=>expect(second!.controller!.state.error).toBe('Offline'));
  expect(second!.controller!.state.stale).toBe(true); expect(second!.controller!.state.snapshot).toEqual(previous);
  runtime.dispose();
});

it('discards an outdated in-flight result and refreshes after a sibling mutation', async () => {
  let note='```taskinnotes\nid: a\nfilter: today\n```\n\n```taskinnotes\nid: b\nfilter: overdue\n```';
  let release!:(value:Task[])=>void; let overdueCalls=0;
  const task={id:'old',title:'Old',project:'Inbox',projectId:'p',due:null,isRecurring:false};
  const provider:TaskProvider={query(filter){if(filter==='overdue' && ++overdueCalls===1) return new Promise(resolve=>{release=resolve;});return Promise.resolve([]);},async create(){return 'new';},async complete(){}};
  const runtime=new NoteRuntime({key:'note',read:async()=>note,update:async fn=>{note=fn(note);},title:()=> 'Note',isEditing:()=>false,isOpen:()=>true},provider);
  const [first,second]=await runtime.inspect(); const old=second!.controller!.refresh();
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  await first!.controller!.create({title:'Created'});
  await vi.waitFor(()=>expect(second!.controller!.state.tasks).toEqual([]));
  release([task]); await old;
  expect(second!.controller!.state.tasks).toEqual([]); expect(note).not.toContain('title: "Old"');
  runtime.dispose();
});

it('does not refresh blocks from a different note or a note that is no longer open', async () => {
  const {MutationLocks}=await import('../../src/core/controller'); const locks=new MutationLocks(); let closedCalls=0, otherCalls=0;
  const block='```taskinnotes\nid: a\nfilter: today\n```\n```taskinnotes\nid: b\nfilter: today\n```';
  const makePort=(key:string,isOpen:()=>boolean)=>{let note=block;return {key,read:async()=>note,update:async(fn:(s:string)=>string)=>{note=fn(note);},title:()=> 'Note',isEditing:()=>false,isOpen};};
  const provider:TaskProvider={async query(){return [];},async create(){return 'new';},async complete(){}};
  const active=new NoteRuntime(makePort('active',()=>true),provider,locks);
  const closed=new NoteRuntime(makePort('closed',()=>false),{...provider,async query(){closedCalls++;return [];}},locks);
  const other=new NoteRuntime(makePort('other',()=>true),{...provider,async query(){otherCalls++;return [];}},locks);
  const [source]=await active.inspect();await closed.inspect();await other.inspect();
  await source!.controller!.create({title:'Test'});
  await vi.waitFor(()=>expect(source!.controller!.state.pending).toBe(false));
  expect(closedCalls).toBe(0);expect(otherCalls).toBe(0);
  active.dispose();closed.dispose();other.dispose();
});

it('finishes simultaneous commands without retrying mutations or losing reconciliation', async () => {
  let note='```taskinnotes\nid: a\nfilter: today\n```\n\n```taskinnotes\nid: b\nfilter: overdue\n```';
  let created=0, queries=0; let release!:()=>void; const gate=new Promise<void>(r=>{release=r;});
  const provider:TaskProvider={async query(){queries++;return [];},async create(){created++;await gate;return 'new';},async complete(){}};
  const runtime=new NoteRuntime({key:'note',read:async()=>note,update:async fn=>{note=fn(note);},title:()=> 'Note',isEditing:()=>false,isOpen:()=>true},provider);
  const [first,second]=await runtime.inspect(); const a=first!.controller!.create({title:'First'}), b=second!.controller!.create({title:'Second'});
  await vi.waitFor(()=>expect(created).toBe(2)); release(); await Promise.all([a,b]);
  await vi.waitFor(()=>{expect(first!.controller!.state.stale).toBe(false);expect(second!.controller!.state.stale).toBe(false);expect(first!.controller!.state.pending).toBe(false);expect(second!.controller!.state.pending).toBe(false);});
  expect(created).toBe(2);expect(queries).toBeLessThanOrEqual(4);runtime.dispose();
});
