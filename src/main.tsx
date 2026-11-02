import { MarkdownRenderChild, MarkdownView, Modal, Notice, Platform, Plugin, TFile, requestUrl, type Editor, type MarkdownPostProcessorContext } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { TaskBlockView, CreateTaskForm, DuplicateIdForm } from './ui/TaskBlock';
import { TaskInNotesSettingsTab, loadSettings, type Settings } from './settings';
import { NoteRuntime, type BlockDescriptor } from './core/runtime';
import { MutationLocks } from './core/controller';
import { TodoistClient } from './core/todoist';
import { transformPaste, type BlockSpan } from './core/document';
import { parseBlock } from './core/config';
import { safeError, TaskError } from './core/model';
import { DebugLogger } from './core/debug';
import { appendLog, clearLogs, ensureLogDirectory } from './core/log-storage';

interface FileSession { runtime: NoteRuntime; views: Set<BlockChild>; timer?: ReturnType<typeof setTimeout>; releaseTimer?: ReturnType<typeof setTimeout>; generation: number; repairing: boolean; prompted: Set<string> }

export default class TaskInNotes extends Plugin {
  settings: Settings = loadSettings(null);
  private provider!: TodoistClient;
  private locks = new MutationLocks();
  private sessions = new Map<TFile, FileSession>();
  private dialogs = new Set<Modal>();
  private duplicateQueue: Promise<void> = Promise.resolve();
  private stopped = false;
  private logger!: DebugLogger;

  async onload() {
    this.settings = loadSettings(await this.loadData());
    this.logger = new DebugLogger(() => ({...this.settings, debugEnabled: Platform.isDesktopApp && this.settings.debugEnabled}), (directory, filename, line) => appendLog(Platform.isDesktopApp, this.app.vault.adapter, directory, filename, line), () => new Notice('Task in Notes could not write its debug log. Check the log directory and permissions.'));
    if (Platform.isDesktopApp && this.settings.debugEnabled) void this.ensureDebugDirectory();
    this.provider = new TodoistClient(async request => {
      const response = await requestUrl({ ...request, throw: false });
      let json: unknown = null;
      if (response.text.trim()) { try { json = JSON.parse(response.text); } catch { throw new Error('Invalid API response'); } }
      return { status: response.status, json };
    }, () => this.app.secretStorage?.getSecret(this.settings.secretId) ?? null, 30000, event => this.logger.record(event));
    this.addSettingTab(new TaskInNotesSettingsTab(this.app, this));
    this.registerMarkdownCodeBlockProcessor('taskinnotes', (source, el, context) => {
      const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
      if (!(file instanceof TFile)) { el.textContent = 'TaskInNotes could not locate the source note.'; return; }
      context.addChild(new BlockChild(el, this, file, source, context));
    });
    this.addCommand({ id: 'insert-taskinnotes-block', name: 'Insert TaskInNotes block', editorCallback: editor => {
      editor.replaceSelection('```taskinnotes\nschemaVersion: 1\nid: "' + crypto.randomUUID() + '"\nfilter: "today"\n```\n');
    } });
    this.registerEvent(this.app.workspace.on('editor-paste', (event, editor, info) => {
      if (event.defaultPrevented || !info.file || !event.clipboardData || event.clipboardData.files.length || editor.listSelections().length !== 1) return;
      const pasted = event.clipboardData.getData('text/plain');
      if (!pasted.includes('taskinnotes')) return;
      const start = editor.getCursor('from'), end = editor.getCursor('to');
      const transformed = transformPaste(editor.getValue(), editor.posToOffset(start), editor.posToOffset(end), pasted);
      if (transformed === pasted) return;
      event.preventDefault();
      editor.transaction({ changes: [{ from: start, to: end, text: transformed }] }, 'taskinnotes-paste');
    }));
    this.registerEvent(this.app.workspace.on('editor-change', (editor, info) => {
      if (info.file) { this.sessions.get(info.file)?.runtime.observe(editor.getValue()); this.schedule(info.file); }
    }));
    this.registerEvent(this.app.vault.on('modify', file => { if (file instanceof TFile) this.schedule(file); }));
    this.registerEvent(this.app.vault.on('rename', file => { if (file instanceof TFile) this.schedule(file, 0); }));
    this.registerEvent(this.app.vault.on('delete', file => {
      if (!(file instanceof TFile)) return;
      const session = this.sessions.get(file);
      if (session) { clearTimeout(session.timer); clearTimeout(session.releaseTimer); session.runtime.dispose(); this.sessions.delete(file); }
    }));
    // Focus changes can end a deferred source edit without changing the document.
    this.registerDomEvent(document, 'focusout', () => { for (const file of this.sessions.keys()) this.schedule(file); });
    this.registerDomEvent(document, 'selectionchange', () => { for (const file of this.sessions.keys()) this.schedule(file); });
  }

  async saveSettings() {
    await this.saveData({ secretId: this.settings.secretId, duplicateIdPolicy: this.settings.duplicateIdPolicy, showSuccessFeedback: this.settings.showSuccessFeedback, debugEnabled: this.settings.debugEnabled, logDirectory: this.settings.logDirectory });
  }
  async testConnection() { await this.provider.testConnection(); }
  async ensureDebugDirectory() {
    if (!Platform.isDesktopApp || !this.settings.debugEnabled) return;
    try { await ensureLogDirectory(true, this.settings.logDirectory); }
    catch { new Notice('Task in Notes could not create its debug log folder. Check the log directory and permissions.'); }
  }
  async clearDebugLogs() { const directory = this.settings.logDirectory; return this.logger.clear(() => clearLogs(Platform.isDesktopApp, directory)); }
  refreshViews() { for (const file of this.sessions.keys()) this.schedule(file, 0); }
  settingsChanged() {
    for (const session of this.sessions.values()) session.runtime.dispose();
    // Existing views keep their note association; replace only the in-memory runtime.
    for (const [file, session] of this.sessions) { session.runtime = this.makeRuntime(file); this.schedule(file, 0); }
  }
  private sourceEditors(file: TFile): Editor[] {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    const views = this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view).filter((view): view is MarkdownView => view instanceof MarkdownView && view.file === file && view.getMode() === 'source');
    if (active?.file === file && active.getMode() === 'source') return [active.editor, ...views.filter(view => view !== active).map(view => view.editor)];
    return views.map(view => view.editor);
  }
  private editor(file: TFile): Editor | undefined {
    const editors = this.sourceEditors(file);
    if (editors.some(editor => editor.getValue() !== editors[0]?.getValue())) throw new TaskError('persistence', 'Open editors disagree about this note. Save or close extra editors before retrying.');
    return editors[0];
  }
  private async read(file: TFile): Promise<string> {
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw new TaskError('stale', 'The source note was removed or replaced.');
    return this.editor(file)?.getValue() ?? await this.app.vault.read(file);
  }
  private async update(file: TFile, transform: (current: string) => string): Promise<void> {
    if (this.stopped || this.app.vault.getAbstractFileByPath(file.path) !== file) throw new TaskError('stale', 'The source note is no longer available.');
    const editor = this.editor(file);
    if (!editor) { await this.app.vault.process(file, transform); return; }
    const before = editor.getValue(), after = transform(before);
    if (before === after) return;
    let from = 0, endBefore = before.length, endAfter = after.length;
    while (from < endBefore && from < endAfter && before[from] === after[from]) from++;
    while (endBefore > from && endAfter > from && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
    editor.transaction({ changes: [{ from: editor.offsetToPos(from), to: editor.offsetToPos(endBefore), text: after.slice(from, endAfter) }] }, 'taskinnotes-snapshot');
  }
  private isEditing(file: TFile, block: BlockSpan): boolean {
    return this.sourceEditors(file).some(editor => editor.listSelections().some(({ anchor, head }) => Math.min(anchor.line, head.line) <= block.endLine && Math.max(anchor.line, head.line) >= block.startLine));
  }
  private makeRuntime(file: TFile) {
    return new NoteRuntime({ key: crypto.randomUUID(), read: () => this.read(file), update: transform => this.update(file, transform), title: () => file.basename, isEditing: block => this.isEditing(file, block), isOpen: () => !!this.sessions.get(file)?.views.size }, this.provider, this.locks);
  }
  private session(file: TFile): FileSession {
    let session = this.sessions.get(file);
    if (!session) { session = { runtime: this.makeRuntime(file), views: new Set(), generation: 0, repairing: false, prompted: new Set() }; this.sessions.set(file, session); }
    return session;
  }
  mount(child: BlockChild) { const session = this.session(child.file); clearTimeout(session.releaseTimer); session.views.add(child); this.schedule(child.file, 0); }
  unmount(child: BlockChild) {
    const session = this.sessions.get(child.file);
    if (session) { session.views.delete(child); if (!session.views.size) { clearTimeout(session.timer); session.generation++; this.releaseLater(child.file, session); } }
  }
  private releaseLater(file: TFile, session: FileSession) {
    clearTimeout(session.releaseTimer);
    session.releaseTimer = setTimeout(() => {
      if (this.stopped || session.views.size || this.sessions.get(file) !== session) return;
      if (!session.runtime.canRelease()) { this.releaseLater(file, session); return; }
      session.runtime.dispose(); this.sessions.delete(file);
    }, 60000);
  }
  private schedule(file: TFile, delay = 180) {
    const session = this.sessions.get(file);
    if (!session || !session.views.size || this.stopped) return;
    clearTimeout(session.timer);
    session.generation++;
    session.timer = setTimeout(() => { void this.synchronize(file, session); }, delay);
  }
  private locate(child: BlockChild, descriptors: BlockDescriptor[]): BlockDescriptor | undefined {
    let id: string | undefined;
    try { id = parseBlock(child.source).config.id; } catch { /* A configuration error still needs source editing. */ }
    const info = child.context.getSectionInfo(child.containerEl);
    if (info) {
      const candidate = descriptors.find(d => d.span.startLine === info.lineStart);
      if (candidate && (id ? candidate.config?.id === id : candidate.span.source.trimEnd() === child.source.trimEnd())) return candidate;
      return undefined;
    }
    // A formerly duplicated view must never follow its old ID to the original.
    const sameId = id ? descriptors.filter(d => d.config?.id === id) : [];
    return !child.wasDuplicate && sameId.length === 1 ? sameId[0] : undefined;
  }
  private async synchronize(file: TFile, session: FileSession) {
    const generation = session.generation;
    try {
      const descriptors = await session.runtime.inspect();
      if (this.stopped || !session.views.size || generation !== session.generation) return;
      const duplicates = new Set(descriptors.filter(d => d.duplicate).map(d => `${d.config?.id}:${d.span.start}`));
      for (const key of session.prompted) if (!duplicates.has(key)) session.prompted.delete(key);
      for (const child of session.views) {
        const descriptor = this.locate(child, descriptors);
        child.render(descriptor);
        if (descriptor?.duplicate) {
          const key = `${descriptor.config?.id}:${descriptor.span.start}`;
          if (!session.prompted.has(key)) { session.prompted.add(key); this.queueDuplicate(child); }
        }
      }
      if (!session.repairing) {
        session.repairing = true;
        try {
          const note = await this.read(file);
          for (const descriptor of descriptors) {
            const controller = descriptor.controller;
            if (!controller?.state.snapshot || this.isEditing(file, descriptor.span)) continue;
            if (controller.state.warning && !controller.state.warning.includes('deferred')) continue;
            // Repairs run outside React and save only if the current output differs.
            const { replaceSnapshot } = await import('./core/document');
            if (replaceSnapshot(note, { id: descriptor.config!.id!, filter: descriptor.config!.filter }, controller.state.snapshot) !== note) await controller.repair();
          }
        } finally { session.repairing = false; }
      }
    } catch (error) {
      if (this.stopped || generation !== session.generation) return;
      for (const child of session.views) child.renderError(safeError(error));
    }
  }
  private queueDuplicate(child: BlockChild, explicit = false) {
    if (child.prompted && !explicit) return;
    child.prompted = true;
    this.duplicateQueue = this.duplicateQueue.then(async () => {
      if (this.stopped || !this.sessions.get(child.file)?.views.has(child)) return;
      const session = this.session(child.file);
      const descriptor = this.locate(child, await session.runtime.inspect());
      if (!descriptor?.duplicate) return;
      let policy = explicit ? 'ask' : this.settings.duplicateIdPolicy;
      if (policy === 'ask') {
        const result = await new Promise<{ generate: boolean; remember: boolean } | null>(resolve => {
          const modal = new ReactModal(this, 'Duplicate block ID', root => root.render(<DuplicateIdForm onDecide={(generate, remember) => { resolve({ generate, remember }); modal.close(); }} />), () => resolve(null));
          modal.open();
        });
        if (!result || this.stopped) return;
        policy = result.generate ? 'regenerate' : 'error';
        if (result.remember) { this.settings.duplicateIdPolicy = policy; await this.saveSettings(); }
      }
      if (policy === 'regenerate') { await session.runtime.assignId(descriptor, crypto.randomUUID()); this.schedule(child.file, 0); }
    }).catch(() => { if (!this.stopped) new Notice('The duplicate block changed. Use Resolve duplicate ID or edit the block source to try again.'); });
  }
  async initialize(child: BlockChild) {
    try {
      const session = this.session(child.file), descriptor = this.locate(child, await session.runtime.inspect());
      if (!descriptor || descriptor.config?.id) return;
      await session.runtime.assignId(descriptor, crypto.randomUUID()); this.schedule(child.file, 0);
    } catch (error) { new Notice(safeError(error)); }
  }
  resolveDuplicate(child: BlockChild) { this.queueDuplicate(child, true); }
  addTask(child: BlockChild, descriptor: BlockDescriptor) {
    if (!descriptor.controller) return;
    const modal = new ReactModal(this, 'Add task', root => root.render(<CreateTaskForm controller={descriptor.controller!} onClose={() => modal.close()} />));
    modal.open();
  }
  trackDialog(modal: Modal) { this.dialogs.add(modal); }
  untrackDialog(modal: Modal) { this.dialogs.delete(modal); }
  onunload() {
    this.stopped = true;
    for (const modal of this.dialogs) modal.close(); this.dialogs.clear();
    for (const session of this.sessions.values()) { clearTimeout(session.timer); clearTimeout(session.releaseTimer); session.runtime.dispose(); for (const child of session.views) child.release(); }
    this.sessions.clear();
  }
}

class BlockChild extends MarkdownRenderChild {
  root?: Root;
  prompted = false;
  wasDuplicate = false;
  constructor(el: HTMLElement, private plugin: TaskInNotes, readonly file: TFile, readonly source: string, readonly context: MarkdownPostProcessorContext) { super(el); }
  onload() { this.root = createRoot(this.containerEl); this.plugin.mount(this); }
  onunload() { this.plugin.unmount(this); this.release(); }
  release() { this.root?.unmount(); this.root = undefined; }
  render(descriptor?: BlockDescriptor) {
    if (!descriptor) { this.renderError('The block is changing or cannot be located safely. Reopen it or use Source mode.'); return; }
    this.wasDuplicate ||= descriptor.duplicate;
    this.root?.render(<TaskBlockView descriptor={descriptor} showSuccessFeedback={this.plugin.settings.showSuccessFeedback} onInitialize={() => void this.plugin.initialize(this)} onResolveDuplicate={() => this.plugin.resolveDuplicate(this)} onAddTask={() => this.plugin.addTask(this, descriptor)} />);
  }
  renderError(error: string) {
    this.root?.render(<TaskBlockView descriptor={{ span: { start: 0, end: 0, bodyStart: 0, bodyEnd: 0, startLine: 0, endLine: 0, source: this.source }, error, duplicate: false }} onInitialize={() => {}} onResolveDuplicate={() => {}} onAddTask={() => {}} />);
  }
}

export class ReactModal extends Modal {
  private root?: Root;
  constructor(private plugin: TaskInNotes, private title: string, private renderContent: (root: Root) => void, private closed?: () => void) { super(plugin.app); }
  onOpen() { this.plugin.trackDialog(this); this.setTitle(this.title); this.root = createRoot(this.contentEl); this.renderContent(this.root); }
  onClose() { this.root?.unmount(); this.root = undefined; this.plugin.untrackDialog(this); this.closed?.(); }
}
