import { afterEach, expect, it, vi } from 'vitest';
import { waitFor, screen, cleanup } from '@testing-library/react';
import { TFile, requestUrl } from './fakes/obsidian';
import TaskInNotes from '../src/main';
import { findBlocks } from '../src/core/document';
import type { App, PluginManifest } from 'obsidian';
afterEach(cleanup);
function setup(initial: string) {
  let text = initial;
  const file = new TFile('Notes.md');
  const events = new Map<string, (...args: any[]) => void>();
  const on = (name: string, callback: (...args: any[]) => void) => { events.set(name, callback); return {}; };
  const app = {
    secretStorage: { getSecret: () => 'test-secret' },
    vault: { on, getAbstractFileByPath: () => file, read: async () => text, process: async (_file: unknown, fn: (value: string) => string) => { text = fn(text); } },
    workspace: { on, getLeavesOfType: () => [], getActiveViewOfType: () => null, getLeaf: () => ({ openFile: async () => {} }) }
  };
  const plugin = new TaskInNotes(app as unknown as App, { id: 'taskinnotes' } as PluginManifest);
  return { plugin, events, file, get text() { return text; }, set text(value) { text = value; } };
}
it('registers native rendering and paste without making startup or render network calls', async () => {
  const f = setup('```taskinnotes\nid: a\nfilter: today\n```'); await f.plugin.onload();
  const host = document.createElement('div'); document.body.append(host);
  const span = findBlocks(f.text)[0]!;
  const children: any[] = [];
  await (f.plugin as unknown as { processor: (source: string, el: HTMLElement, context: unknown) => unknown }).processor(span.source, host, { sourcePath: 'Notes.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: 3, text: f.text }), addChild: (child: any) => { children.push(child); child.onload(); } });
  await screen.findByRole('button', { name: 'Refresh' });
  expect(requestUrl).not.toHaveBeenCalled();
  expect(f.events.has('editor-paste')).toBe(true);
  for (const child of children) child.onunload(); f.plugin.onunload(); host.remove();
});
it('rewrites a complete paste in a single editor transaction and leaves undo to the editor', async () => {
  const f = setup(''); await f.plugin.onload();
  let value = '';
  const transactions: unknown[] = [];
  const editor = { getValue: () => value, listSelections: () => [{ anchor: {line: 0, ch: 0}, head: {line: 0, ch: 0} }], getCursor: () => ({ line: 0, ch: 0 }), posToOffset: () => 0, offsetToPos: (n: number) => ({ line: 0, ch: n }), transaction: (tx: any) => { transactions.push(tx); value = tx.changes[0].text; } };
  const event = { defaultPrevented: false, clipboardData: { files: [], getData: () => '```taskinnotes\nid: original\nfilter: today\n```' }, preventDefault: vi.fn() };
  f.events.get('editor-paste')!(event, editor, { file: f.file });
  expect(event.preventDefault).toHaveBeenCalledOnce(); expect(transactions).toHaveLength(1);
  expect(value).toContain('filter: today'); expect(value).not.toContain('id: original');
  f.plugin.onunload();
});

it('does not bind an outdated duplicate view to the remaining original block after an ID changes', async () => {
  const body = '```taskinnotes\nid: a\nfilter: today\n```';
  const f = setup(body + '\n' + body); await f.plugin.onload(); f.plugin.settings.duplicateIdPolicy = 'error';
  const host = document.createElement('div'); document.body.append(host); const children: any[] = [];
  const span = findBlocks(f.text)[1]!;
  await (f.plugin as unknown as { processor: (source: string, el: HTMLElement, context: unknown) => unknown }).processor(span.source, host, { sourcePath: 'Notes.md', getSectionInfo: () => ({ lineStart: findBlocks(f.text)[1]!.startLine, lineEnd: findBlocks(f.text)[1]!.endLine, text: f.text }), addChild: (child: any) => { children.push(child); child.onload(); } });
  await screen.findByRole('button', { name: 'Resolve duplicate ID' });
  f.text = body + '\n' + body.replace('id: a', 'id: new'); f.events.get('modify')!(f.file);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('cannot be located safely'));
  expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true);
  for (const child of children) child.onunload(); f.plugin.onunload(); host.remove();
});

it('does not repair a cached note while none of its blocks are rendered', async () => {
  const f = setup('```taskinnotes\nid: a\nfilter: today\n```'); await f.plugin.onload();
  requestUrl.mockImplementation(async (request: {url: string}) => ({ status: 200, text: JSON.stringify(request.url.includes('/projects') ? { results: [{ id: 'p', name: 'Inbox' }], next_cursor: null } : { results: [{ id: 't', content: 'Fetched title', project_id: 'p', due: null }], next_cursor: null }) }));
  const host = document.createElement('div'); document.body.append(host); const children: any[] = [];
  await (f.plugin as unknown as { processor: (source: string, el: HTMLElement, context: unknown) => unknown }).processor(findBlocks(f.text)[0]!.source, host, { sourcePath: 'Notes.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: 3, text: f.text }), addChild: (child: any) => { children.push(child); child.onload(); } });
  (await screen.findByRole('button', { name: 'Refresh' })).click();
  await waitFor(() => expect(f.text).toContain('Fetched title'));
  for (const child of children) child.onunload(); host.remove();
  f.text = f.text.replace('Fetched title', 'Edited while closed');
  vi.useFakeTimers(); f.events.get('modify')!(f.file); await vi.advanceTimersByTimeAsync(300); vi.useRealTimers();
  expect(f.text).toContain('Edited while closed');
  f.plugin.onunload(); requestUrl.mockReset();
});

it('releases inactive note sessions after a grace period but retains them across quick remounts', async () => {
  const f = setup('```taskinnotes\nid: a\nfilter: today\n```'); await f.plugin.onload();
  const plugin = f.plugin as unknown as { mount(child: unknown): void; unmount(child: unknown): void; sessions: Map<unknown, unknown> };
  const child = {file: f.file};
  vi.useFakeTimers();
  try {
    plugin.mount(child); const session = plugin.sessions.get(f.file);
    plugin.unmount(child); await vi.advanceTimersByTimeAsync(30000);
    plugin.mount(child); expect(plugin.sessions.get(f.file)).toBe(session);
    plugin.unmount(child); await vi.advanceTimersByTimeAsync(60001);
    expect(plugin.sessions.has(f.file)).toBe(false);
  } finally { f.plugin.onunload(); vi.useRealTimers(); }
});
