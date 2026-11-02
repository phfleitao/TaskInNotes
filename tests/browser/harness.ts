import TaskInNotes from '../../src/main';
import { TFile, MarkdownView, setRequestHandler } from './obsidian';
import { findBlocks } from '../../src/core/document';
import type { App, PluginManifest } from 'obsidian';

const textarea = document.querySelector<HTMLTextAreaElement>('#markdown')!;
const rendered = document.querySelector<HTMLDivElement>('#rendered')!;
const callsOutput = document.querySelector<HTMLOutputElement>('#calls')!;
let calls = 0, nextId = 10;
let tasks: Record<string, unknown>[] = [{ id: '1', content: 'Original server task', project_id: 'p', due: null }];
textarea.value = 'Before the block\n\n```taskinnotes\nid: a\nfilter: today\n```\n\nAfter the block';
const file = new TFile('Notes.md');
const events = new Map<string, ((...args: any[]) => unknown)[]>();
const emit = (name: string, ...args: any[]) => { for (const handler of events.get(name) || []) handler(...args); };
const on = (name: string, handler: (...args: any[]) => unknown) => { events.set(name, [...events.get(name) || [], handler]); return {}; };
const cleanups: (() => void)[] = [];
let children: any[] = [], plugin: TaskInNotes;
let renderingTimer: ReturnType<typeof setTimeout>;
const queueRender = () => { clearTimeout(renderingTimer); renderingTimer = setTimeout(() => void renderNote(), 0); };
function offsetToPos(offset: number) { const before = textarea.value.slice(0, offset).split('\n'); return { line: before.length - 1, ch: before.at(-1)!.length }; }
function posToOffset(pos: {line: number; ch: number}) { return textarea.value.split('\n').slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.ch; }
const editor = {
  getValue: () => textarea.value,
  getCursor: (which?: string) => offsetToPos(which === 'to' ? textarea.selectionEnd : textarea.selectionStart),
  listSelections: () => document.activeElement === textarea ? [{ anchor: offsetToPos(textarea.selectionStart), head: offsetToPos(textarea.selectionEnd) }] : [{ anchor: { line: 9999, ch: 0 }, head: { line: 9999, ch: 0 } }],
  offsetToPos, posToOffset,
  transaction: (tx: { changes: {from: {line: number; ch: number}; to: {line: number; ch: number}; text: string}[] }) => {
    for (const change of [...tx.changes].reverse()) textarea.setRangeText(change.text, posToOffset(change.from), posToOffset(change.to), 'preserve');
    emit('editor-change', editor, { file }); queueRender();
  },
  replaceSelection: (text: string) => { textarea.setRangeText(text); emit('editor-change', editor, { file }); queueRender(); },
  setSelection: (pos: {line: number; ch: number}) => textarea.setSelectionRange(posToOffset(pos), posToOffset(pos)),
  scrollIntoView: () => {}, focus: () => textarea.focus()
};
const view = new MarkdownView(file, editor);
const app = {
  cleanups, secretStorage: { getSecret: (id: string) => id === 'test-only' ? 'synthetic-test-token' : null },
  vault: { on, getAbstractFileByPath: () => file, read: async () => textarea.value, process: async (_file: unknown, transform: (value: string) => string) => { const before = textarea.value; textarea.value = transform(before); if (before !== textarea.value) { emit('modify', file); queueRender(); } } },
  workspace: { on, getLeavesOfType: () => [{ view }], getActiveViewOfType: () => view, getLeaf: () => ({ view, openFile: async () => { textarea.focus(); } }) }
};

setRequestHandler(async request => {
  callsOutput.textContent = String(++calls);
  if ((document.querySelector('#scenario') as HTMLSelectElement).value === 'offline') throw new Error('Synthetic offline condition');
  const url = new URL(request.url); let payload: unknown;
  if (url.pathname.endsWith('/labels/shared')) payload = { results: [], next_cursor: null };
  else if (url.pathname.endsWith('/labels')) payload = { results: (document.querySelector('#scenario') as HTMLSelectElement).value === 'many-labels' ? Array.from({length:8}, (_,i) => ({id:`label-${i}`,name:`Label ${i}`})) : [{id:'label-work',name:'Work'},{id:'label-home',name:'Home'}], next_cursor: null };
  else if (url.pathname.endsWith('/projects')) payload = { results: [{ id: 'other', name: 'Other' }, { id: 'p', name: 'Inbox', inbox_project:true }], next_cursor: null };
  else if (url.pathname.endsWith('/tasks/filter')) payload = { results: tasks, next_cursor: null };
  else if (url.pathname.endsWith('/tasks') && request.method === 'GET') payload = {results: tasks, next_cursor: null};
  else if (url.pathname.endsWith('/tasks')) {
    const input = JSON.parse(request.body); const id = String(nextId++);
    tasks = [...tasks, { id, content: input.content, project_id: input.project_id || 'p', parent_id: null, description: input.description || '', labels: input.labels || [], priority: input.priority || 1, due: input.due_date ? { date: input.due_date, is_recurring: false } : null }]; payload = { id };
  } else if (url.pathname.endsWith('/close')) { const id = url.pathname.split('/').at(-2); tasks = tasks.filter(t => t.id !== id); payload = null; }
  else throw new Error('Unexpected test request');
  return { status: 200, text: JSON.stringify(payload) };
});

async function renderNote() {
  for (const child of children) child.onunload(); children = []; rendered.replaceChildren();
  const spans = findBlocks(textarea.value);
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!, host = document.createElement('div'); rendered.append(host);
    const processor = (plugin as unknown as { processor: (source: string, el: HTMLElement, context: unknown) => unknown }).processor;
    processor(span.source, host, { sourcePath: file.path, addChild: (child: any) => { children.push(child); child.onload(); }, getSectionInfo: () => { const current = findBlocks(textarea.value)[i]; return current ? { lineStart: current.startLine, lineEnd: current.endLine, text: textarea.value } : null; } });
  }
}
async function start() {
  plugin = new TaskInNotes(app as unknown as App, { id: 'taskinnotes' } as PluginManifest);
  await plugin.onload(); await renderNote();
}
textarea.addEventListener('input', () => emit('editor-change', editor, { file }));
textarea.addEventListener('paste', event => emit('editor-paste', event, editor, { file }));
document.querySelector('#render')!.addEventListener('click', () => void renderNote());
document.querySelector('#restart')!.addEventListener('click', async () => {
  for (const child of children) child.onunload(); children = [];
  plugin.onunload(); for (const cleanup of cleanups) cleanup(); cleanups.length = 0; events.clear(); await start();
});
document.querySelector('#scenario')!.addEventListener('change', event => {
  const scenario = (event.target as HTMLSelectElement).value;
  if (scenario === 'replacement') tasks = [{ id: '2', content: 'Replacement task', project_id: 'p', due: null }];
  if (scenario === 'empty') tasks = [];
  if (scenario === 'hierarchy') tasks = [{ id:'parent',content:'Parent task',project_id:'p',parent_id:null,due:null },{ id:'child',content:'Child task',project_id:'p',parent_id:'parent',due:null },{ id:'grand',content:'Grandchild task',project_id:'p',parent_id:'child',due:null }];
});
await start();
