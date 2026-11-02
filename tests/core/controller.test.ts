import { describe, it, expect } from 'vitest';
import { TaskController, MutationLocks } from '../../src/core/controller';
import { TaskError, type Snapshot, type Task, type TaskProvider } from '../../src/core/model';
import { findBlocks, replaceSnapshot } from '../../src/core/document';
const task: Task = { id: 'one', title: 'First', due: null, project: 'Inbox', projectId: 'p', isRecurring: false };
it('invalidates other blocks after an unknown mutation outcome without automatically querying', async () => {
  let queries = 0; const locks = new MutationLocks();
  const provider: TaskProvider = { async query() { queries++; return [task]; }, async create() { return ''; }, async complete() { throw new TaskError('unknown-outcome', 'Unknown'); } };
  const a = new TaskController(provider, locks), b = new TaskController(provider, locks);
  for (const [controller, key] of [[a, 'a'], [b, 'b']] as const) controller.configure({key, noteKey:'note', filter:'today', resolvedFilter:'today', async isCurrent(){return true;}, async save(){}});
  await a.refresh(); await b.refresh(); await a.complete(task.id); await Promise.resolve();
  expect(b.state.stale).toBe(true); expect(queries).toBe(2);
});
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function fixture(provider?: TaskProvider, locks = new MutationLocks()) {
  let note = 'Before\n```taskinnotes\nid: a\nfilter: today\ntaskSnapshot:\n  tasks:\n    - title: Never trust this\n```\nAfter';
  let valid = true, failSave = false, queries = 0, writes = 0, creates = 0, completes = 0;
  let tasks = [task];
  const remote: TaskProvider = provider ?? {
    async query() { queries++; return tasks; }, async create() { creates++; return 'created'; }, async complete() { completes++; }
  };
  const context = {
    key: 'note:a', filter: 'today', resolvedFilter: 'today',
    async isCurrent() { return valid; },
    async save(snapshot: Snapshot) { if (failSave) throw new Error('disk'); const next = replaceSnapshot(note, { id: 'a', filter: 'today' }, snapshot); if (next !== note) { note = next; writes++; } }
  };
  const controller = new TaskController(remote, locks, () => '2026-11-02T12:00:00Z'); controller.configure(context);
  return { controller, context, get note() { return note; }, set note(value) { note = value; }, set valid(value: boolean) { valid = value; }, set failSave(value: boolean) { failSave = value; }, set tasks(value: Task[]) { tasks = value; }, get counts() { return { queries, writes, creates, completes }; } };
}

describe('trusted state and refresh', () => {
  it('starts empty without a network call and never reconstructs tasks from the snapshot', () => {
    const f = fixture();
    expect(f.controller.state.tasks).toBeUndefined(); expect(f.counts.queries).toBe(0);
    expect(f.note).toContain('Never trust this');
  });
  it('replaces full snapshots on successive refreshes including empty results', async () => {
    const f = fixture(); await f.controller.refresh();
    expect(f.controller.state.tasks?.[0]?.title).toBe('First'); expect(f.note).not.toContain('Never trust this');
    f.tasks = []; await f.controller.refresh();
    expect(f.controller.state.tasks).toEqual([]); expect(f.note).toContain('tasks: []');
    expect(f.note.startsWith('Before\n')).toBe(true); expect(f.note.endsWith('\nAfter')).toBe(true);
  });
  it('preserves snapshot on API failure but keeps fresh interactive data on a write failure', async () => {
    const f = fixture(); f.failSave = true; await f.controller.refresh();
    expect(f.controller.state.tasks?.[0]?.title).toBe('First'); expect(f.controller.state.warning).toBeTruthy();
    f.failSave = false; await f.controller.repair();
    expect(f.note).toContain('First'); expect(f.counts.queries).toBe(1);
    const offline = fixture({ async query() { throw new TaskError('network', 'Offline'); }, async create() { return ''; }, async complete() {} });
    const before = offline.note; await offline.controller.refresh();
    expect(offline.note).toBe(before); expect(offline.controller.state.error).toBe('Offline');
    expect(offline.controller.state.tasks).toBeUndefined();
  });
  it('discards delayed responses when filter changes, including changes back to the same filter', async () => {
    const pending = deferred<Task[]>();
    const f = fixture({ query: () => pending.promise, async create() { return ''; }, async complete() {} });
    const fetch = f.controller.refresh(); await Promise.resolve();
    f.controller.configure({ ...f.context, filter: 'overdue', resolvedFilter: 'overdue' });
    f.controller.configure(f.context); pending.resolve([task]); await fetch;
    expect(f.controller.state.tasks).toBeUndefined(); expect(f.note).not.toContain('title: "First"');
  });
  it('repairs only compatible in-memory results, with no remote commands or write loops', async () => {
    const f = fixture(); await f.controller.repair(); expect(f.counts.writes).toBe(0);
    await f.controller.refresh();
    f.note = f.note.replace('title: "First"', 'title: "Edited"');
    await f.controller.repair(); await f.controller.repair();
    expect(f.note).not.toContain('Edited'); expect(f.counts).toEqual({ queries: 1, writes: 2, creates: 0, completes: 0 });
    f.valid = false; f.note = 'Integration removed'; await f.controller.repair();
    expect(f.note).toBe('Integration removed');
    expect(findBlocks(f.note)).toEqual([]);
  });
});

describe('explicit commands', () => {
  it('confirms creation without injecting a task outside the filter', async () => {
    const f = fixture(); await f.controller.refresh(); f.tasks = [];
    expect(await f.controller.create({ title: 'Outside filter' })).toBe(true);
    expect(f.controller.state.tasks).toEqual([]); expect(f.controller.state.message).toContain('created');
    expect(f.counts.creates).toBe(1);
  });
  it('does not repeat a successful mutation when reconciliation or persistence fails', async () => {
    let queries = 0, creates = 0;
    const f = fixture({ async query() { if (++queries > 1) throw new TaskError('network', 'Offline'); return [task]; }, async create() { creates++; return 'id'; }, async complete() {} });
    await f.controller.refresh(); expect(await f.controller.create({ title: 'New' })).toBe(true);
    expect(f.controller.state.message).toContain('created'); expect(f.controller.state.error).toContain('Offline');
    expect(f.controller.state.stale).toBe(true); await f.controller.repair(); expect(creates).toBe(1);
  });
  it('prevents double commands and keeps recurring tasks returned by the server', async () => {
    const done = deferred<void>(); let completes = 0;
    const f = fixture({ async query() { return [{ ...task, due: '2026-11-03', isRecurring: true }]; }, async create() { return ''; }, async complete() { completes++; await done.promise; } });
    await f.controller.refresh();
    const first = f.controller.complete('one'); const second = f.controller.complete('one');
    await Promise.resolve(); await Promise.resolve(); done.resolve(); await Promise.all([first, second]);
    expect(completes).toBe(1); expect(f.controller.state.tasks?.[0]?.due).toBe('2026-11-03');
  });
  it('locks the same Todoist task across controllers', async () => {
    const locks = new MutationLocks(), done = deferred<void>(); let completes = 0;
    const provider: TaskProvider = { async query() { return [task]; }, async create() { return ''; }, async complete() { completes++; await done.promise; } };
    const a = fixture(provider, locks), b = fixture(provider, locks);
    await Promise.all([a.controller.refresh(), b.controller.refresh()]);
    const first = a.controller.complete('one'); await Promise.resolve(); await Promise.resolve();
    const second = b.controller.complete('one'); done.resolve(); await Promise.all([first, second]); expect(completes).toBe(1);
  });
  it('requires refresh after an unknown command outcome and never retries automatically', async () => {
    let creates = 0;
    const f = fixture({ async query() { return []; }, async create() { creates++; throw new TaskError('unknown-outcome', 'Unknown outcome'); }, async complete() {} });
    await f.controller.refresh(); await f.controller.create({ title: 'Maybe created' }); await f.controller.create({ title: 'Maybe created' });
    expect(creates).toBe(1); expect(f.controller.state.uncertain).toBe(true);
    await f.controller.refresh(); expect(f.controller.state.uncertain).toBe(false);
  });
});

it('keeps an in-flight command locked when another block confirms a mutation', async () => {
  const locks = new MutationLocks(), firstCommand = deferred<string>(); let calls = 0;
  const provider: TaskProvider = { async query() { return []; }, create() { calls++; return calls === 1 ? firstCommand.promise : Promise.resolve('confirmed'); }, async complete() {} };
  const a = fixture(provider, locks), b = fixture(provider, locks);
  b.controller.configure({ ...b.context, key: 'other-note:b' });
  const first = a.controller.create({ title: 'First command' });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await b.controller.create({ title: 'Other command' });
  expect(a.controller.state.pending).toBe(true);
  await a.controller.refresh(); await a.controller.create({ title: 'Duplicate command' });
  expect(calls).toBe(2);
  firstCommand.resolve('first'); await first;
  expect(a.controller.state.pending).toBe(false);
  expect(a.controller.state.stale).toBe(false);
});

it('preserves the operation lock and reports an unknown outcome after its filter changes', async () => {
  let rejectCommand!: (error: unknown) => void, calls = 0;
  const pending = new Promise<string>((_resolve, reject) => { rejectCommand = reject; });
  const f = fixture({ async query() { return []; }, create() { calls++; return pending; }, async complete() {} });
  const command = f.controller.create({ title: 'Pending' });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  f.controller.configure({ ...f.context, filter: 'overdue', resolvedFilter: 'overdue' });
  expect(f.controller.state.pending).toBe(true);
  rejectCommand(new TaskError('unknown-outcome', 'Check Todoist before retrying.')); await command;
  expect(f.controller.state.uncertain).toBe(true); expect(f.controller.state.error).toContain('Check Todoist');
  expect(calls).toBe(1);
});

it('keeps a block command locked when editing recreates its controller', async () => {
  const locks = new MutationLocks(), pending = deferred<string>(); let calls = 0;
  const provider: TaskProvider = { async query() { return []; }, create() { calls++; return calls === 1 ? pending.promise : Promise.resolve('duplicate'); }, async complete() {} };
  const old = fixture(provider, locks), command = old.controller.create({ title: 'In flight' });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  old.controller.dispose();
  const replacement = fixture(provider, locks);
  expect(replacement.controller.state.pending).toBe(true);
  await replacement.controller.create({ title: 'Do not duplicate' }); expect(calls).toBe(1);
  pending.resolve('created'); await command;
  expect(replacement.controller.state.pending).toBe(false);
});
it('persists searchable details and hierarchy from the trusted response', async () => {
 const detailed = { ...task, parentId:'parent', description:'Find this description', labels:['Work'], priority:2 };
 const f = fixture({ async query() { return [detailed]; }, async create() { return ''; }, async complete() {} });
 await f.controller.refresh();
 expect(f.note).toContain('parentId: "parent"'); expect(f.note).toContain('Find this description'); expect(f.note).toContain('Work'); expect(f.note).toContain('priority: 2');
});
