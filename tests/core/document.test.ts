import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseBlock, resolveFilter } from '../../src/core/config';
import { findBlocks, replaceSnapshot, replaceId, transformPaste } from '../../src/core/document';

const snapshot = { fetchedAt: '2026-11-02T12:00:00Z', resolvedFilter: 'today', tasks: [
  { id: '2', title: 'New task', due: null, project: 'Inbox' }
] };
const block = (body: string) => '```taskinnotes\n' + body + '\n```';

describe('configuration and templates', () => {
  it('validates configuration independently from structurally damaged snapshot data', () => {
    expect(parseBlock('id: abc\nfilter: today\ntaskSnapshot: [not, trusted]').config).toEqual({ schemaVersion: 1, id: 'abc', filter: 'today' });
    expect(parseBlock('filter: today').config.id).toBeUndefined();
    for (const source of ['filter: 2', 'filter: ""', 'filter: today\nextra: yes', 'schemaVersion: 2\nfilter: today', 'filter: today\nfilter: overdue', 'filter: today\ntaskSnapshot: [broken']) {
      expect(() => parseBlock(source)).toThrow();
    }
  });
  it('resolves raw Todoist filters and note inputs exactly once', () => {
    expect(resolveFilter('today | date: {{property:date}} | date: {{title}}', '2026-11-02', { date: '2026-11-01' })).toBe('today | date: 2026-11-01 | date: 2026-11-02');
    expect(resolveFilter('{{property:query}}', 'Notes', { query: '#Work & p1' })).toBe('#Work & p1');
    expect(resolveFilter('#{{title}} & @{{property:label}}', 'Work', { label: 'urgent' })).toBe('#Work & @urgent');
    expect(resolveFilter('{{property:query}}', 'Notes', { query: '{{title}}' })).toBe('{{title}}');
    for (const [filter, title, props] of [
      ['{{noteDate}}', '2026-02-30', {}], ['date: {{title}}', 'Notes', {}],
      ['date: {{property:date}}', 'Notes', { date: '2026-02-30' }],
      ['{{property:missing}}', 'Notes', {}], ['{{property:date}}', 'Notes', { date: 22 }],
      ['{{unknown}}', 'Notes', {}]
    ] as const) expect(() => resolveFilter(filter, title, props)).toThrow();
  });
});

describe('Markdown persistence', () => {
  it('replaces the entire snapshot while preserving config, frontmatter and other blocks', () => {
    const source = '---\ndate: 2026-11-02\n---\nHeading\n' + block('id: first\n# Keep this comment\nfilter: today\ntaskSnapshot:\n  tasks:\n    - title: Old task') + '\nText\n' + block('id: second\nfilter: overdue');
    const target = findBlocks(source)[0]!;
    const result = replaceSnapshot(source, { id: 'first', filter: 'today' }, snapshot);
    expect(result).toContain('# Keep this comment\nfilter: today');
    expect(result).toContain('New task');
    expect(result).not.toContain('Old task');
    expect(result.slice(0, target.bodyStart)).toBe(source.slice(0, target.bodyStart));
    expect(findBlocks(result)[1]!.source).toBe('id: second\nfilter: overdue\n');
    expect(parse(findBlocks(result)[0]!.source).taskSnapshot).toEqual(snapshot);
    const empty = replaceSnapshot(result, { id: 'first', filter: 'today' }, { ...snapshot, tasks: [] });
    expect(empty).not.toContain('New task');
    expect(empty).toContain('tasks: []');
    expect(replaceSnapshot(empty, { id: 'first', filter: 'today' }, { ...snapshot, tasks: [] })).toBe(empty);
  });
  it('does not target nested fences, deleted blocks, changed filters or duplicate IDs', () => {
    const nested = '````markdown\n' + block('id: a\nfilter: today') + '\n````';
    expect(findBlocks(nested)).toEqual([]);
    for (const note of ['removed', block('id: a\nfilter: overdue'), block('id: a\nfilter: today') + '\n' + block('id: a\nfilter: today')]) {
      expect(() => replaceSnapshot(note, { id: 'a', filter: 'today' }, snapshot)).toThrow();
    }
  });
  it('keeps remote multiline, YAML, HTML and backticks inside the snapshot', () => {
    const title = 'Hello\n```\n<script>alert(1)</script>\nfilter: "overdue"';
    const note = replaceSnapshot(block('id: a\nfilter: today'), { id: 'a', filter: 'today' }, { ...snapshot, tasks: [{ ...snapshot.tasks[0]!, title }] });
    expect(findBlocks(note)).toHaveLength(1);
    expect(parse(findBlocks(note)[0]!.source).taskSnapshot).toMatchObject({ tasks: [{ title }] });
  });
  it('regenerates every complete pasted block and preserves surrounding text', () => {
    let n = 0;
    const text = 'Before\n' + block('id: copied\nfilter: today') + '\nBetween\n' + block('filter: overdue') + '\nAfter';
    const result = transformPaste('', 0, 0, text, () => `new-${++n}`);
    expect(result).toBe('Before\n' + block('id: "new-1"\nfilter: today') + '\nBetween\n' + block('id: "new-2"\nfilter: overdue') + '\nAfter');
    expect(transformPaste('', 0, 0, '```taskinnotes\nfilter: today')).toBe('```taskinnotes\nfilter: today');
    const outer = '````markdown\n\n````';
    expect(transformPaste(outer, 14, 14, text)).toBe(text);
  });
  it('changes only the requested duplicate occurrence', () => {
    const note = block('id: a\nfilter: today') + '\n' + block('id: a\nfilter: today');
    const duplicate = findBlocks(note)[1]!;
    const result = replaceId(note, duplicate, 'new-id');
    expect(findBlocks(result).map(b => parseBlock(b.source).config.id)).toEqual(['a', 'new-id']);
  });
});

it('recovers a broken generated subtree only when its YAML boundary is unambiguous', () => {
  const source = 'id: a\nfilter: today\ntaskSnapshot:\n  tasks:\n    - title: bad: yaml';
  expect(parseBlock(source).config.filter).toBe('today');
  const note = replaceSnapshot('```taskinnotes\n' + source + '\n```', { id: 'a', filter: 'today' }, { fetchedAt: '2026-11-02T12:00:00Z', resolvedFilter: 'today', tasks: [] });
  expect(note).toContain('tasks: []'); expect(note).not.toContain('bad: yaml');
  expect(() => parseBlock('filter: today\ntaskSnapshot:\n  tasks: [broken\nextra: "unknown"')).toThrow();
});

it('preserves valid root indentation when writing a snapshot or initializing an ID', () => {
  const note = '```taskinnotes\n  id: a\n  filter: today\n```';
  const result = replaceSnapshot(note, { id: 'a', filter: 'today' }, { fetchedAt: '2026-11-02T12:00:00Z', resolvedFilter: 'today', tasks: [] });
  expect(parseBlock(findBlocks(result)[0]!.source).config.id).toBe('a');
  const withoutId = '```taskinnotes\n  filter: today\n```';
  const initialized = replaceId(withoutId, findBlocks(withoutId)[0]!, 'generated');
  expect(parseBlock(findBlocks(initialized)[0]!.source).config.id).toBe('generated');
});
it('preserves other indented YAML properties after replacing a snapshot', () => {
  const note = '```taskinnotes\n  id: a\n  filter: today\n  taskSnapshot:\n    tasks: []\n  title: Mine\n```';
  const result = replaceSnapshot(note, {id:'a', filter:'today'}, snapshot);
  expect(parseBlock(findBlocks(result)[0]!.source).config.title).toBe('Mine');
});
it('keeps the next configuration key separate when replacing a literal-scalar ID', () => {
  const note = '```taskinnotes\nid: |-\n  a\nfilter: today\n```';
  const result = transformPaste('', 0, 0, note, () => 'new-id');
  expect(parseBlock(findBlocks(result)[0]!.source).config).toEqual({ schemaVersion: 1, id: 'new-id', filter: 'today' });
});
