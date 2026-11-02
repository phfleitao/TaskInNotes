import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskBlockView, CreateTaskForm } from '../../src/ui/TaskBlock';
import { NoteRuntime } from '../../src/core/runtime';
import type { TaskProvider } from '../../src/core/model';
afterEach(cleanup);
async function fixture(provider?: TaskProvider) {
  let note = '```taskinnotes\nid: a\nfilter: today\ntaskSnapshot:\n  tasks:\n    - title: Untrusted old task\n```';
  const runtime = new NoteRuntime({ key: 'file', read: async () => note, update: async fn => { note = fn(note); }, title: () => 'Notes', isEditing: () => false }, provider ?? { async query() { return [{ id: 't', title: '<img src=x onerror=alert(1)>', project: 'Inbox', projectId: 'p', due: '2026-11-02', isRecurring: false }]; }, async create() { return 'new'; }, async complete() {} });
  return { descriptor: (await runtime.inspect())[0]!, get note() { return note; } };
}
it('renders without trusting snapshots, then shows server tasks safely after an explicit click', async () => {
  const f = await fixture(); const user = userEvent.setup();
  const { container } = render(<TaskBlockView descriptor={f.descriptor} onAddTask={() => {}} onInitialize={() => {}} onResolveDuplicate={() => {}} />);
  expect(screen.queryByText('Untrusted old task')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('<img src=x onerror=alert(1)>');
  expect(container.querySelector('img')).toBeNull(); expect(screen.getByText('Inbox')).toBeTruthy();
  expect(f.note).toContain('title: "<img src=x onerror=alert(1)>"');
});
it('validates creation and submits only one command while pending', async () => {
  let calls = 0, closeCalls = 0, release!: (id: string) => void;
  const f = await fixture({ async query() { return []; }, create() { calls++; return new Promise(r => { release = r; }); }, async complete() {} });
  const user = userEvent.setup();
  render(<CreateTaskForm controller={f.descriptor.controller!} onClose={() => { closeCalls++; }} />);
  const submit = screen.getByRole('button', { name: 'Add task' }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  await user.type(screen.getByLabelText('Task title'), 'A new task');
  await user.type(screen.getByLabelText('Due date'), '2026-11-03');
  await user.dblClick(submit); expect(calls).toBe(1); expect(submit.disabled).toBe(true);
  release('new'); await waitFor(() => expect(closeCalls).toBe(1));
});
it('uses the native date input without a redundant picker button', async () => {
  const f = await fixture();
  render(<CreateTaskForm controller={f.descriptor.controller!} onClose={() => {}} />);
  expect((screen.getByLabelText('Due date') as HTMLInputElement).type).toBe('date');
  expect(screen.queryByRole('button', { name: 'Choose due date' })).toBeNull();
});
it('shows query errors without adding a redundant View code button', async () => {
  const f = await fixture({ async query() { throw new Error('private task payload'); }, async create() { return ''; }, async complete() {} });
  const user = userEvent.setup();
  render(<TaskBlockView descriptor={f.descriptor} onAddTask={() => {}} onInitialize={() => {}} onResolveDuplicate={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByRole('alert')).toBeTruthy(); expect(screen.queryByText('private task payload')).toBeNull();
  expect(screen.queryByRole('button', { name: 'View code' })).toBeNull();
});

it('offers duplicate resolution with an explicit remember choice', async () => {
  const { DuplicateIdForm } = await import('../../src/ui/TaskBlock');
  const decisions: unknown[] = [];
  const user = userEvent.setup();
  render(<DuplicateIdForm onDecide={(generate, remember) => { decisions.push({ generate, remember }); }} />);
  await user.click(screen.getByLabelText('Remember my choice'));
  await user.click(screen.getByRole('button', { name: 'Keep block in error' }));
  expect(decisions).toEqual([{ generate: false, remember: true }]);
});

it('shows the configured heading and expandable nested tasks with Todoist links', async () => {
  const nested = ['parent','child','grandchild'].map((id, i) => ({ id, title: id, due: null, project: 'Inbox', projectId: 'p', isRecurring: false, parentId: i === 0 ? null : ['parent','child'][i-1] }));
  const f = await fixture({ async query() { return nested; }, async create() { return ''; }, async complete() {} });
  f.descriptor.config!.title = 'My work'; const user = userEvent.setup();
  render(<TaskBlockView descriptor={f.descriptor} onAddTask={() => {}} onInitialize={() => {}} onResolveDuplicate={() => {}} />);
  expect(screen.getByText('My work')).toBeTruthy(); await user.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('grandchild')).toBeTruthy();
  const link = screen.getByRole('link', {name:'child'});
  expect(link.getAttribute('href')).toContain('/app/task/child');
  expect(link.getAttribute('title')).toBe('Open in Todoist');
  await user.click(screen.getByRole('button', {name:'Collapse subtasks of parent'}));
  expect(screen.queryByText('child')).toBeNull(); expect(screen.queryByText('grandchild')).toBeNull();
  await user.click(screen.getByRole('button', {name:'Expand subtasks of parent'})); expect(screen.getByText('grandchild')).toBeTruthy();
});

it('shows the last synchronization on Refresh and hides successful feedback unless enabled', async () => {
  const f = await fixture(); const user = userEvent.setup();
  const props = { descriptor: f.descriptor, onAddTask: () => {}, onInitialize: () => {}, onResolveDuplicate: () => {} };
  const { rerender } = render(<TaskBlockView {...props} />);
  expect(screen.getByRole('button', {name:'Refresh'}).getAttribute('title')).toMatch(/not synced/i);
  await user.click(screen.getByRole('button', {name:'Refresh'}));
  expect(screen.getByRole('button', {name:'Refresh'}).getAttribute('title')).toMatch(/last sync/i);
  await user.click(screen.getByRole('button', {name:'Complete <img src=x onerror=alert(1)>'}));
  await waitFor(() => expect(f.descriptor.controller!.getState().pending).toBe(false));
  expect(screen.queryByText(/Task completed/)).toBeNull();
  rerender(<TaskBlockView {...props} showSuccessFeedback />);
  expect(screen.getByText(/Task completed/)).toBeTruthy();
});

it('shows saved synchronization time after reopening without loading snapshot tasks', async () => {
  const f = await fixture();
  f.descriptor.span.source = 'id: a\nfilter: today\ntaskSnapshot:\n  fetchedAt: "2026-11-02T12:00:00Z"\n  tasks:\n    - title: Old task\n';
  render(<TaskBlockView descriptor={f.descriptor} onAddTask={() => {}} onInitialize={() => {}} onResolveDuplicate={() => {}} />);
  expect(screen.getByRole('button', {name:'Refresh'}).getAttribute('title')).toContain(new Date('2026-11-02T12:00:00Z').toLocaleString());
  expect(screen.getByText(/Last sync:/).closest('footer')).toBeTruthy();
  expect(screen.queryByText('Old task')).toBeNull();
});
it('loads existing project and label choices and submits optional task details', async () => {
  let submitted: unknown;
  const f = await fixture({ async query() { return []; }, async create(input) { submitted=input; return 'new'; }, async complete() {}, async getOptions() { return {projects:[{id:'p',name:'Work'},{id:'in',name:'Entrada',isInbox:true}],labels:[{id:'l',name:'Urgent'},{id:'l2',name:'Home'}]}; } });
  const user = userEvent.setup(); render(<CreateTaskForm controller={f.descriptor.controller!} onClose={() => {}} />);
  await screen.findByRole('option',{name:'#Work'});
  expect((screen.getByLabelText('Project') as HTMLSelectElement).value).toBe('in');
  await user.type(screen.getByLabelText('Task title'), 'Detailed');
  await user.type(screen.getByLabelText('Description'), 'Some context');
  await user.selectOptions(screen.getByLabelText('Project'), 'p');
  await user.click(screen.getByRole('button', {name: /Priority/}));
  await user.click(screen.getByRole('option', {name:'Priority 1'}));
  await user.click(screen.getByRole('button', {name:/Labels/}));
  await user.click(screen.getByLabelText('Urgent'));
  await user.click(screen.getByLabelText('Home'));
  await user.click(screen.getByRole('button', {name:/Labels/}));
  expect(screen.getByRole('button', {name:/Labels/}).textContent).toContain('Urgent');
  expect(screen.getByRole('button', {name:/Labels/}).textContent).toContain('Home');
  await user.click(screen.getByRole('button', {name:'Add task'}));
  await waitFor(() => expect(submitted).toEqual({title:'Detailed', description:'Some context', projectId:'p', priority:4, labels:['Urgent','Home']}));
});

it('marks task circles with Todoist priority levels', async () => {
  const f = await fixture({ async query() { return [4,3,2,1].map(priority => ({id:String(priority),title:`P${5-priority}`,due:null,project:'Inbox',projectId:'p',isRecurring:false,priority})); }, async create(){return '';}, async complete(){} });
  const user = userEvent.setup(); render(<TaskBlockView descriptor={f.descriptor} onAddTask={() => {}} onInitialize={() => {}} onResolveDuplicate={() => {}} />);
  await user.click(screen.getByRole('button',{name:'Refresh'}));
  for (let p=1;p<=4;p++) expect(screen.getByRole('button',{name:`Complete P${p}`}).className).toContain(`taskinnotes-priority-${p}`);
});

it('keeps labels in the snapshot without displaying them in the list', async () => {
  const f = await fixture({ async query() { return [{ id:'t',title:'Task',due:null,project:'Inbox',projectId:'p',isRecurring:false,labels:['PrivateLabel'] }]; }, async create(){return '';}, async complete(){} });
  const user = userEvent.setup(); render(<TaskBlockView descriptor={f.descriptor} onAddTask={() => {}} onInitialize={() => {}} onResolveDuplicate={() => {}} />);
  await user.click(screen.getByRole('button',{name:'Refresh'}));
  expect(screen.queryByText('@PrivateLabel')).toBeNull();
  expect(f.note).toContain('PrivateLabel');
});

it('hides transient reconciliation feedback and shows a warning if reconciliation fails', async () => {
  let queryCount = 0; let failQuery!: (error: Error) => void;
  const f = await fixture({
    query() { if (++queryCount === 1) return Promise.resolve([{id:'t',title:'Task',due:null,project:'Inbox',projectId:'p',isRecurring:false}]); return new Promise((_resolve,reject)=> {failQuery=reject;}); },
    async create(){return '';}, async complete(){}
  });
  const user=userEvent.setup(); render(<TaskBlockView descriptor={f.descriptor} onAddTask={()=>{}} onInitialize={()=>{}} onResolveDuplicate={()=>{}} />);
  await user.click(screen.getByRole('button',{name:'Refresh'}));
  await user.click(screen.getByRole('button',{name:'Complete Task'}));
  await waitFor(()=>expect(f.descriptor.controller!.getState().stale).toBe(true));
  expect(screen.queryByText(/These results need reconciliation/)).toBeNull();
  expect(screen.queryByText('Working…')).toBeNull();
  failQuery(new Error('offline'));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('command succeeded'));
  expect(screen.getByText(/These results need reconciliation/)).toBeTruthy();
});
