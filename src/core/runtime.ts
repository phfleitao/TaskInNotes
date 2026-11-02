import { parseDocument, isMap } from 'yaml';
import { parseBlock, resolveFilter } from './config';
import { findBlocks, locateUnique, replaceId, replaceSnapshot, type BlockSpan } from './document';
import { TaskError, safeError, type BlockConfig, type Snapshot, type TaskProvider } from './model';
import { MutationLocks, TaskController } from './controller';

export interface NotePort { key: string; read(): Promise<string>; update(transform: (current: string) => string): Promise<void>; title(): string; isEditing(block: BlockSpan): boolean; isOpen?(): boolean }
export interface BlockDescriptor { span: BlockSpan; config?: BlockConfig; resolvedFilter?: string; error?: string; duplicate: boolean; controller?: TaskController }

function properties(markdown: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(markdown);
  if (!match) return {};
  const doc = parseDocument(match[1]!, { schema: 'core', uniqueKeys: true });
  if (doc.errors.length || doc.warnings.length || !isMap(doc.contents)) throw new TaskError('configuration', 'The note frontmatter is invalid. Fix it before using property placeholders.');
  return doc.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
}

function scan(markdown: string, title: string): BlockDescriptor[] {
  const seen = new Set<string>();
  return findBlocks(markdown).map(span => {
    let config: BlockConfig | undefined;
    try {
      config = parseBlock(span.source).config;
      const duplicate = config.id !== undefined && seen.has(config.id);
      if (config.id) seen.add(config.id);
      const resolvedFilter = resolveFilter(config.filter, title, config.filter.includes('{{property:') ? properties(markdown) : {});
      return { span, config, resolvedFilter, duplicate };
    } catch (error) { return { span, config, duplicate: false, error: safeError(error) }; }
  });
}

export class NoteRuntime {
  private controllers = new Map<string, TaskController>();
  private writes: Promise<void> = Promise.resolve();
  private disposed = false;
  constructor(private readonly port: NotePort, private readonly provider: TaskProvider, private readonly locks = new MutationLocks()) {}
  async inspect(): Promise<BlockDescriptor[]> {
    const note = await this.port.read();
    return this.observe(note);
  }
  observe(note: string): BlockDescriptor[] {
    if (this.disposed) return [];
    const descriptors = scan(note, this.port.title());
    const active = new Set<string>();
    for (const descriptor of descriptors) {
      const { config, resolvedFilter } = descriptor;
      if (!config?.id || !resolvedFilter || descriptor.error) continue;
      active.add(config.id);
      let controller = this.controllers.get(config.id);
      if (!controller) { controller = new TaskController(this.provider, this.locks); this.controllers.set(config.id, controller); }
      if (descriptors.filter(d => d.config?.id === config.id).length > 1) {
        controller.invalidate();
        descriptor.error = descriptor.duplicate ? 'This block ID already exists in this note.' : 'Another block has this ID. Resolve the duplicate to continue.';
        continue;
      }
      const expected = { id: config.id, filter: config.filter };
      const matches = (current: string): boolean => {
        if (this.disposed) return false;
        try {
          const block = locateUnique(current, expected);
          const currentConfig = parseBlock(block.source).config;
          return resolveFilter(currentConfig.filter, this.port.title(), currentConfig.filter.includes('{{property:') ? properties(current) : {}) === resolvedFilter;
        } catch { return false; }
      };
      controller.configure({
        key: `${this.port.key}:${config.id}`, noteKey: this.port.key, isOpen: () => this.port.isOpen?.() ?? true, filter: config.filter, resolvedFilter,
        isCurrent: async () => matches(await this.port.read()),
        save: (snapshot: Snapshot, stillCurrent?: () => boolean) => this.enqueue(async () => {
          let deferred = false;
          await this.port.update(current => {
            if (stillCurrent?.() === false || !matches(current)) throw new TaskError('stale', 'The note or filter changed before the snapshot could be saved.');
            const block = locateUnique(current, expected);
            if (this.port.isEditing(block)) { deferred = true; return current; }
            return replaceSnapshot(current, expected, snapshot);
          });
          if (deferred) throw new TaskError('persistence', 'Snapshot save deferred while the block is being edited.');
        })
      });
      descriptor.controller = controller;
    }
    for (const [id, controller] of this.controllers) if (!active.has(id)) { controller.dispose(); this.controllers.delete(id); }
    return descriptors;
  }
  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.writes.then(work);
    this.writes = next.catch(() => {});
    return next;
  }
  canRelease(): boolean { return [...this.controllers.values()].every(controller => !controller.state.pending && !controller.state.uncertain); }
  assignId(block: BlockDescriptor, id: string): Promise<void> {
    return this.enqueue(() => this.port.update(current => {
      if (this.disposed) throw new TaskError('stale', 'The note is no longer available.');
      if (findBlocks(current).some(b => { try { return parseBlock(b.source).config.id === id; } catch { return false; } })) throw new TaskError('configuration', 'That block ID already exists in this note.');
      return replaceId(current, block.span, id);
    }));
  }
  dispose() { this.disposed = true; for (const c of this.controllers.values()) c.dispose(); this.controllers.clear(); }
}
