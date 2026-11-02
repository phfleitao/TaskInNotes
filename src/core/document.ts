import { parseBlock } from './config';
import { TaskError, type Snapshot } from './model';

export interface BlockSpan { start: number; end: number; bodyStart: number; bodyEnd: number; startLine: number; endLine: number; source: string }
export interface BlockTarget { id: string; filter: string }
export const quote = (value: string): string => JSON.stringify(value).replace(/`/g, '\\u0060');

export function findBlocks(markdown: string): BlockSpan[] {
  const blocks: BlockSpan[] = [];
  let fence: { char: string; size: number; task: boolean; start: number; bodyStart: number; startLine: number } | undefined;
  let offset = 0, lineNo = 0, frontmatter = false;
  for (const match of markdown.matchAll(/[^\n]*(?:\n|$)/g)) {
    const raw = match[0];
    if (!raw) continue;
    const line = raw.replace(/\r?\n$/, '');
    if (lineNo === 0 && line === '---') frontmatter = true;
    else if (frontmatter && (line === '---' || line === '...')) frontmatter = false;
    else if (!frontmatter) {
      if (!fence) {
        const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (opening && !(opening[1]![0] === '`' && opening[2]!.includes('`'))) {
          fence = { char: opening[1]![0]!, size: opening[1]!.length, task: opening[1]![0] === '`' && opening[2]!.trim() === 'taskinnotes', start: offset, bodyStart: offset + raw.length, startLine: lineNo };
        }
      } else {
        const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
        if (closing && closing[1]![0] === fence.char && closing[1]!.length >= fence.size) {
          if (fence.task) blocks.push({ start: fence.start, end: offset + raw.length, bodyStart: fence.bodyStart, bodyEnd: offset, startLine: fence.startLine, endLine: lineNo, source: markdown.slice(fence.bodyStart, offset) });
          fence = undefined;
        }
      }
    }
    offset += raw.length; lineNo++;
  }
  return blocks;
}

export function locateUnique(markdown: string, target: BlockTarget): BlockSpan {
  const matches = findBlocks(markdown).filter(block => {
    try { return parseBlock(block.source).config.id === target.id; } catch { return false; }
  });
  if (matches.length !== 1 || parseBlock(matches[0]!.source).config.filter !== target.filter) throw new TaskError('stale', 'The block was removed, changed or has a duplicate ID. Refresh after resolving its configuration.');
  return matches[0]!;
}

export function serializeSnapshot(snapshot: Snapshot, eol = '\n', indent = ''): string {
  const lines = ['taskSnapshot:', `  fetchedAt: ${quote(snapshot.fetchedAt)}`, `  resolvedFilter: ${quote(snapshot.resolvedFilter)}`];
  if (!snapshot.tasks.length) lines.push('  tasks: []');
  else {
    lines.push('  tasks:');
    for (const task of snapshot.tasks) {
      lines.push(`    - id: ${quote(task.id)}`, `      title: ${quote(task.title)}`, `      due: ${task.due === null ? 'null' : quote(task.due)}`, `      project: ${quote(task.project)}`);
      if (task.parentId) lines.push(`      parentId: ${quote(task.parentId)}`);
      if (task.description) lines.push(`      description: ${quote(task.description)}`);
      if (task.labels?.length) lines.push(`      labels: [${task.labels.map(quote).join(', ')}]`);
      if (task.priority) lines.push(`      priority: ${task.priority}`);
    }
  }
  return lines.map(line => indent + line).join(eol) + eol;
}

export function replaceSnapshot(markdown: string, target: BlockTarget, snapshot: Snapshot): string {
  const block = locateUnique(markdown, target);
  const parsed = parseBlock(block.source);
  const eol = block.source.includes('\r\n') ? '\r\n' : '\n';
  const range = parsed.snapshotRange;
  const configText = range ? block.source.slice(0, range[0]) + block.source.slice(range[1]) : block.source;
  const body = configText.replace(/\s*$/, '') + eol + eol + serializeSnapshot(snapshot, eol, parsed.indent);
  return markdown.slice(0, block.bodyStart) + body + markdown.slice(block.bodyEnd);
}

export function replaceId(markdown: string, block: BlockSpan, id: string): string {
  const current = findBlocks(markdown).find(b => b.start === block.start && b.source === block.source);
  if (!current) throw new TaskError('stale', 'The block changed. Edit the block source or try again.');
  const { idRange, indent } = parseBlock(current.source);
  const eol = current.source.includes('\r\n') ? '\r\n' : '\n';
  const source = idRange ? current.source.slice(0, idRange[0]) + quote(id) + (current.source.slice(idRange[0], idRange[1]).endsWith('\n') ? eol : '') + current.source.slice(idRange[1]) : `${indent}id: ${quote(id)}${eol}` + current.source;
  return markdown.slice(0, current.bodyStart) + source + markdown.slice(current.bodyEnd);
}

export function transformPaste(markdown: string, from: number, to: number, pasted: string, newId: () => string = () => crypto.randomUUID()): string {
  const combined = markdown.slice(0, from) + pasted + markdown.slice(to);
  const blocks = findBlocks(combined).filter(b => b.start >= from && b.end <= from + pasted.length);
  let transformed = pasted;
  const replacements = blocks.map(block => ({ block, id: newId() }));
  for (const { block, id } of replacements.reverse()) {
    try {
      parseBlock(block.source);
      const local: BlockSpan = { ...block, start: block.start - from, end: block.end - from, bodyStart: block.bodyStart - from, bodyEnd: block.bodyEnd - from };
      transformed = replaceId(transformed, local, id);
    } catch { /* Preserve ambiguous or incomplete clipboard content. */ }
  }
  return transformed;
}
