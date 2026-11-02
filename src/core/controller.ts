import { safeError, TaskError, type Snapshot, type Task, type TaskProvider, type CreateTaskInput, type TaskOptions } from './model';
export interface BlockContext { key: string; filter: string; resolvedFilter: string; noteKey?: string; isOpen?(): boolean; isCurrent(): Promise<boolean>; save(snapshot: Snapshot, stillCurrent?: () => boolean): Promise<void> }
export interface BlockState { tasks?: Task[]; snapshot?: Snapshot; pending: boolean; autoRefreshing?: boolean; error?: string; warning?: string; message?: string; stale: boolean; uncertain: boolean }
const emptyState = (): BlockState => ({ pending: false, stale: false, uncertain: false });

export class MutationLocks {
  private tasks = new Set<string>();
  private blocks = new Set<string>();
  private listeners = new Set<() => void>();
  private changes = new Set<(origin: string, noteKey?: string, uncertain?: boolean) => void>();
  has(id: string) { return this.tasks.has(id); }
  acquire(id: string): boolean { if (this.has(id)) return false; this.tasks.add(id); this.emit(); return true; }
  release(id: string) { this.tasks.delete(id); this.emit(); }
  hasBlock(key: string) { return this.blocks.has(key); }
  acquireBlock(key: string): boolean { if (this.blocks.has(key)) return false; this.blocks.add(key); this.emit(); return true; }
  releaseBlock(key: string) { this.blocks.delete(key); this.emit(); }
  subscribe(cb: () => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  onMutation(cb: (origin: string, noteKey?: string, uncertain?: boolean) => void) { this.changes.add(cb); return () => { this.changes.delete(cb); }; }
  changed(origin: string, noteKey?: string, uncertain = false) { for (const cb of this.changes) cb(origin, noteKey, uncertain); }
  private emit() { for (const cb of this.listeners) cb(); }
}

export class TaskController {
  state: BlockState = emptyState();
  private context: BlockContext | null = null;
  private epoch = 0;
  private configEpoch = 0;
  private listeners = new Set<() => void>();
  private saves: Promise<void> = Promise.resolve();
  private commandPending = false;
  private queryEpoch: number | null = null;
  private autoRefreshRequested = false;
  private autoRefreshScheduled = false;
  private unsubscribeLocks: () => void;
  private unsubscribeChanges: () => void;
  constructor(private readonly provider: TaskProvider, private readonly locks = new MutationLocks(), private readonly now = () => new Date().toISOString()) {
    this.unsubscribeLocks = locks.subscribe(() => { this.patch({ pending: this.pending() }); this.scheduleAutoRefresh(); });
    this.unsubscribeChanges = locks.onMutation((origin, noteKey, uncertain) => {
      if (this.context && origin !== this.context.key) {
        this.epoch++;
        if (uncertain) this.autoRefreshRequested = false;
        else if (noteKey && this.context.noteKey === noteKey && (this.context.isOpen?.() ?? true)) this.autoRefreshRequested = true;
        this.patch({ stale: true, pending: this.pending(), autoRefreshing: this.autoRefreshRequested, message: 'Tasks may have changed in another block. Refresh to reconcile.' });
        this.scheduleAutoRefresh();
      }
    });
  }
  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; };
  getState = () => this.state;
  isTaskLocked = (id: string) => this.locks.has(id);
  private pending() { return this.commandPending || this.queryEpoch === this.epoch || !!(this.context && this.locks.hasBlock(this.context.key)); }
  private patch(update: Partial<BlockState>) { this.state = { ...this.state, ...update }; for (const cb of this.listeners) cb(); }
  private scheduleAutoRefresh() {
    if (!this.autoRefreshRequested || this.autoRefreshScheduled) return;
    this.autoRefreshScheduled = true;
    queueMicrotask(() => {
      this.autoRefreshScheduled = false;
      if (!this.autoRefreshRequested) return;
      if (!this.context || !(this.context.isOpen?.() ?? true) || !this.state.stale || this.state.uncertain) { this.autoRefreshRequested = false; this.patch({ autoRefreshing: false }); return; }
      if (this.pending() || this.commandPending) return;
      this.autoRefreshRequested = false;
      void this.refresh();
      this.patch({ autoRefreshing: false });
    });
  }
  configure(context: BlockContext | null): void {
    const previous = this.context;
    this.context = context;
    if (previous?.key === context?.key && previous?.filter === context?.filter && previous?.resolvedFilter === context?.resolvedFilter) return;
    this.autoRefreshRequested = false;
    this.epoch++; this.configEpoch++; this.state = { ...emptyState(), pending: this.pending(), uncertain: this.state.uncertain, ...(this.state.uncertain ? { error: this.state.error } : {}) }; this.patch({});
  }
  invalidate() { this.configure(null); }
  dispose() { this.invalidate(); this.unsubscribeLocks(); this.unsubscribeChanges(); }
  private async current(context: BlockContext, epoch: number): Promise<boolean> {
    if (epoch !== this.epoch || this.context?.key !== context.key) return false;
    try {
      if (await context.isCurrent()) return epoch === this.epoch;
    } catch { /* A broken or deleted note is not a valid destination. */ }
    if (epoch === this.epoch) this.invalidate();
    return false;
  }
  private async load(context: BlockContext, epoch: number): Promise<boolean> {
    const tasks = await this.provider.query(context.resolvedFilter);
    if (!await this.current(context, epoch)) return false;
    const snapshot: Snapshot = { fetchedAt: this.now(), resolvedFilter: context.resolvedFilter, tasks: tasks.map(({ id, title, due, project, parentId, description, labels, priority }) => ({ id, title, due, project, ...(parentId ? { parentId } : {}), ...(description ? { description } : {}), ...(labels?.length ? { labels } : {}), ...(priority ? { priority } : {}) })) };
    this.patch({ tasks, snapshot, stale: false, uncertain: false, error: undefined });
    await this.save(context, epoch, snapshot);
    return true;
  }
  private save(context: BlockContext, epoch: number, snapshot: Snapshot): Promise<void> {
    const next = this.saves.then(async () => {
      if (this.state.snapshot !== snapshot || !await this.current(context, epoch)) return;
      try { await context.save(snapshot, () => epoch === this.epoch && this.context?.key === context.key && this.state.snapshot === snapshot); if (epoch === this.epoch) this.patch({ warning: undefined }); }
      catch (error) { if (epoch === this.epoch && this.state.snapshot === snapshot) this.patch({ warning: error instanceof TaskError && error.code === 'persistence' ? error.message : 'Tasks loaded, but the snapshot could not be saved. Retry the local save or edit the block source.' }); }
    });
    this.saves = next.catch(() => {});
    return next;
  }
  async refresh(): Promise<boolean> {
    const context = this.context, epoch = this.epoch;
    if (!context || this.state.pending || this.commandPending) return false;
    this.queryEpoch = epoch;
    this.patch({ pending: true, error: undefined, message: undefined });
    try { if (!await this.current(context, epoch)) return false; return await this.load(context, epoch); }
    catch (error) { if (epoch === this.epoch) this.patch({ error: safeError(error) }); return false; }
    finally { if (epoch === this.epoch) { this.queryEpoch = null; this.patch({ pending: this.pending() }); } this.scheduleAutoRefresh(); }
  }
  async repair(): Promise<void> {
    const context = this.context, snapshot = this.state.snapshot, epoch = this.epoch;
    if (!context || !snapshot || this.state.pending || this.state.stale || this.state.uncertain) return;
    await this.save(context, epoch, snapshot);
  }
  async getOptions(): Promise<TaskOptions> { if (!this.provider.getOptions) return { projects: [], labels: [] }; return this.provider.getOptions(); }
  async create(input: CreateTaskInput): Promise<boolean> {
    if (!input.title.trim()) { this.patch({ error: 'Enter a task title.' }); return false; }
    return this.mutate(() => this.provider.create(input), 'Task created.');
  }
  async complete(id: string): Promise<boolean> {
    if (!this.state.tasks?.some(task => task.id === id) || this.state.stale || !this.locks.acquire(id)) return false;
    try { return await this.mutate(() => this.provider.complete(id), 'Task completed. Recurring tasks may move to their next date.'); }
    finally { this.locks.release(id); }
  }
  private async mutate(command: () => Promise<unknown>, success: string): Promise<boolean> {
    const context = this.context, epoch = this.epoch;
    const configEpoch = this.configEpoch;
    if (!context || this.state.pending || this.commandPending || this.state.uncertain || this.state.stale) return false;
    if (!this.locks.acquireBlock(context.key)) return false;
    this.commandPending = true;
    this.patch({ pending: true, error: undefined, message: undefined });
    let confirmed = false;
    try {
      if (!await this.current(context, epoch)) return false;
      await command(); confirmed = true;
      this.locks.changed(context.key, context.noteKey);
      // Another block can invalidate query results without changing this block's
      // configuration. Reconcile using a fresh query generation in that case.
      const reconciliationEpoch = this.epoch;
      if (configEpoch !== this.configEpoch || !await this.current(context, reconciliationEpoch)) { this.patch({ message: `${success} Refresh to reconcile.`, stale: true }); return true; }
      this.patch({ message: success, stale: true });
      try { await this.load(context, reconciliationEpoch); }
      catch (error) { if (reconciliationEpoch === this.epoch) this.patch({ error: `${safeError(error)} The command succeeded; Refresh to reconcile.`, stale: true }); }
      return true;
    } catch (error) {
      if (error instanceof TaskError && error.code === 'unknown-outcome') this.locks.changed(context.key, context.noteKey, true);
      this.patch({ error: safeError(error), uncertain: error instanceof TaskError && error.code === 'unknown-outcome', stale: confirmed || this.state.stale });
      return confirmed;
    } finally { this.commandPending = false; this.locks.releaseBlock(context.key); this.patch({ pending: this.pending() }); this.scheduleAutoRefresh(); }
  }
}
