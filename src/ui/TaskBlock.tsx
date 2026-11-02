import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import type { BlockDescriptor } from '../core/runtime';
import type { BlockState, TaskController } from '../core/controller';
import { validDate } from '../core/config';
import { safeError, type TaskOptions } from '../core/model';
import { buildTaskTree, type TaskNode } from '../core/tree';
import { parseDocument } from 'yaml';

export interface BlockViewProps { descriptor: BlockDescriptor; showSuccessFeedback?: boolean; onAddTask(): void; onInitialize(): void; onResolveDuplicate(): void }
const EMPTY: BlockState = { pending: false, stale: false, uncertain: false };
const noSubscribe = () => () => {};
function useTasks(controller?: TaskController) { return useSyncExternalStore(controller?.subscribe ?? noSubscribe, controller?.getState ?? (() => EMPTY)); }

function snapshotTime(source: string): string | undefined {
  const doc = parseDocument(source, { schema: 'core' });
  if (doc.errors.length || doc.warnings.length) return;
  const value = doc.getIn(['taskSnapshot', 'fetchedAt']);
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;
}
export function TaskBlockView({ descriptor, showSuccessFeedback = false, onAddTask, onInitialize, onResolveDuplicate }: BlockViewProps) {
  const controller = descriptor.controller;
  const state = useTasks(controller);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setCollapsed(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const blocked = !controller || state.pending || state.stale || state.uncertain;
  const headingId = useId();
  const lastSync = state.snapshot?.fetchedAt ?? snapshotTime(descriptor.span.source);
  return <section className="taskinnotes-block" aria-labelledby={headingId} aria-busy={state.pending}>
    <header className="taskinnotes-toolbar">
      <span id={headingId} className="taskinnotes-brand">{descriptor.config?.title || 'Tasks'}</span>
      <div className="taskinnotes-actions">
        <button type="button" className="taskinnotes-add" onClick={onAddTask} disabled={blocked}><span className="taskinnotes-add-icon" aria-hidden="true">+</span><span>Add task</span></button>
        <button type="button" className="taskinnotes-refresh" title={lastSync ? `Last sync: ${new Date(lastSync).toLocaleString()}` : 'Not synced yet'} onClick={() => void controller?.refresh()} disabled={!controller || state.pending}><span aria-hidden="true">↻</span><span>Refresh</span></button>
      </div>
    </header>
    {descriptor.resolvedFilter && <div className="taskinnotes-filter" title="Resolved Todoist filter"><span className="taskinnotes-filter-label">Filter</span><span>{descriptor.resolvedFilter}</span></div>}
    {descriptor.error && <div className="taskinnotes-error" role="alert">{descriptor.error}</div>}
    {descriptor.duplicate && <button type="button" onClick={onResolveDuplicate}>Resolve duplicate ID</button>}
    {!descriptor.error && descriptor.config && !descriptor.config.id && <div className="taskinnotes-empty"><p>Initialize this block to generate its stable ID.</p><button type="button" onClick={onInitialize}>Initialize block</button></div>}
    {state.message && showSuccessFeedback && !state.stale && <div className="taskinnotes-message" role="status">{state.message}</div>}
    {state.error && <div className="taskinnotes-error" role="alert">{state.error}</div>}
    {state.warning && <div className="taskinnotes-warning" role="status">{state.warning} <button type="button" disabled={state.pending} onClick={() => void controller?.repair()}>Retry snapshot save</button></div>}
    {state.stale && !state.pending && !state.autoRefreshing && <p className="taskinnotes-warning">These results need reconciliation. Refresh to load current tasks.</p>}
    {state.pending && showSuccessFeedback && <p role="status">Working…</p>}
    {controller && state.tasks === undefined && !state.pending && <p className="taskinnotes-empty">Refresh to load tasks from Todoist. The snapshot is for search and reading only.</p>}
    {state.tasks?.length === 0 && <p className="taskinnotes-empty">No tasks match this filter.</p>}
    {state.tasks && state.tasks.length > 0 && <TaskTree nodes={buildTaskTree(state.tasks)} collapsed={collapsed} toggle={toggle} controller={controller!} blocked={blocked} />}
    {lastSync && <footer className="taskinnotes-fetched">Last sync: <time dateTime={lastSync}>{new Date(lastSync).toLocaleString()}</time></footer>}
  </section>;
}

function TaskTree({ nodes, collapsed, toggle, controller, blocked }: { nodes: TaskNode[]; collapsed: Set<string>; toggle(id: string): void; controller: TaskController; blocked: boolean }) {
  return <ul className="taskinnotes-list">{nodes.map(({task,children}) => <li key={task.id}>
    <div className="taskinnotes-task">
      {children.length > 0 ? <button type="button" className="taskinnotes-expand" aria-label={`${collapsed.has(task.id) ? 'Expand' : 'Collapse'} subtasks of ${task.title}`} aria-expanded={!collapsed.has(task.id)} onClick={() => toggle(task.id)}><span aria-hidden="true" /></button> : <span className="taskinnotes-expand-spacer" aria-hidden="true" />}
      <button type="button" className={`taskinnotes-complete taskinnotes-priority-${task.priority && task.priority >= 1 && task.priority <= 4 ? 5 - task.priority : 4}`} aria-label={`Complete ${task.title}`} title="Complete task" disabled={blocked || controller.isTaskLocked(task.id)} onClick={() => void controller.complete(task.id)} />
      <div className="taskinnotes-task-body"><a className="taskinnotes-title" href={`https://app.todoist.com/app/task/${encodeURIComponent(task.id)}`} target="_blank" rel="noopener noreferrer" title="Open in Todoist">{task.title}</a>{task.due && <time dateTime={task.due} className="taskinnotes-due">{task.due.replace('T', ' ')}{task.isRecurring ? ' ↻' : ''}</time>}</div>
      <span className="taskinnotes-project"><span aria-hidden="true" className="taskinnotes-project-icon">#</span>{task.project}</span>
    </div>
    {children.length > 0 && !collapsed.has(task.id) && <div className="taskinnotes-children"><TaskTree nodes={children} collapsed={collapsed} toggle={toggle} controller={controller} blocked={blocked} /></div>}
  </li>)}</ul>;
}

export function CreateTaskForm({ controller, onClose }: {controller: TaskController; onClose(): void}) {
  const [title, setTitle] = useState(''), [due, setDue] = useState(''), [description, setDescription] = useState(''), [projectId, setProjectId] = useState(''), [priority, setPriority] = useState(''), [labels, setLabels] = useState<string[]>([]);
  const [options, setOptions] = useState<TaskOptions>({ projects: [], labels: [] });
  const [optionsError, setOptionsError] = useState('');
  const [priorityOpen, setPriorityOpen] = useState(false), [labelsOpen, setLabelsOpen] = useState(false);
  useEffect(() => { let live = true; controller.getOptions().then(value => { if (live) { setOptions(value); setProjectId(value.projects.find(p => p.isInbox)?.id ?? value.projects.find(p => p.name.toLowerCase() === 'inbox')?.id ?? ''); } }).catch(error => { if (live) setOptionsError(safeError(error)); }); return () => { live = false; }; }, [controller]);
  const state = useTasks(controller), id = useId();
  const disabled = state.pending || state.uncertain || state.stale;
  const submit = async (event: FormEvent) => { event.preventDefault(); if (disabled || !title.trim() || (due && !validDate(due))) return; if (await controller.create({ title, ...(due ? { due } : {}), ...(description.trim() ? { description: description.trim() } : {}), ...(projectId ? { projectId } : {}), ...(priority ? { priority: 5 - Number(priority) } : {}), ...(labels.length ? { labels } : {}) })) onClose(); };
  return <form className="taskinnotes-create" onSubmit={event => void submit(event)}>
    <label className="taskinnotes-visually-hidden" htmlFor={`${id}-title`}>Task title</label>
    <input className="taskinnotes-create-title" id={`${id}-title`} type="text" value={title} autoFocus required disabled={disabled} onChange={event => setTitle(event.target.value)} placeholder="What needs to be done?" />
    <label htmlFor={`${id}-description`}>Description</label>
    <textarea id={`${id}-description`} value={description} disabled={disabled} onChange={event => setDescription(event.target.value)} placeholder="Description" />
    <div className="taskinnotes-create-options">
      <div className="taskinnotes-date-row"><label htmlFor={`${id}-due`}>Due date</label><input id={`${id}-due`} type="date" value={due} disabled={disabled} onChange={event => setDue(event.target.value)} /></div>
      <div className="taskinnotes-option-field"><span>Priority</span><div className="taskinnotes-dropdown" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPriorityOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') setPriorityOpen(false); }}>
        <button type="button" aria-label={`Priority: ${priority ? `Priority ${priority}` : 'Priority 4'}`} aria-haspopup="listbox" aria-expanded={priorityOpen} disabled={disabled} onClick={() => setPriorityOpen(!priorityOpen)}><PriorityFlag level={Number(priority || 4)} /> P{priority || '4'} <span aria-hidden="true">⌄</span></button>
        {priorityOpen && <FloatingMenu role="listbox" label="Priority">{[1,2,3,4].map(p => <button type="button" role="option" aria-selected={Number(priority || 4) === p} key={p} onClick={() => { setPriority(String(p)); setPriorityOpen(false); }}><PriorityFlag level={p} /> Priority {p}</button>)}</FloatingMenu>}
      </div></div>
      <label>Project<select value={projectId} disabled={disabled} onChange={event => setProjectId(event.target.value)}>{!projectId && <option value="">#Inbox</option>}{options.projects.map(p => <option key={p.id} value={p.id}>#{p.name}</option>)}</select></label>
    </div>
    <div className="taskinnotes-option-field"><span>Labels</span><div className="taskinnotes-dropdown taskinnotes-label-dropdown" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setLabelsOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') setLabelsOpen(false); }}>
      <button type="button" aria-label={`Labels${labels.length ? `: ${labels.join(', ')}` : ''}`} aria-expanded={labelsOpen} disabled={disabled} onClick={() => setLabelsOpen(!labelsOpen)}><span className="taskinnotes-selected-labels">{labels.length ? labels.map(label => <span className="taskinnotes-label-chip" key={label}>@{label}</span>) : 'Select labels'}</span><span aria-hidden="true">⌄</span></button>
      {labelsOpen && <FloatingMenu labels>{options.labels.length ? options.labels.map(label => <label key={label.id}><input type="checkbox" disabled={disabled} checked={labels.includes(label.name)} onChange={event => setLabels(old => event.target.checked ? [...old,label.name] : old.filter(name => name !== label.name))} />{label.name}</label>) : <span className="taskinnotes-no-labels">No labels available</span>}</FloatingMenu>}
    </div></div>
    {optionsError && <p role="status" className="taskinnotes-warning">Could not load projects and labels: {optionsError}</p>}
    {state.error && <p role="alert" className="taskinnotes-error">{state.error}</p>}
    <div className="taskinnotes-form-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="mod-cta" disabled={disabled || !title.trim() || (!!due && !validDate(due))}>{state.pending ? 'Adding…' : 'Add task'}</button></div>
  </form>;
}

function PriorityFlag({ level }: {level: number}) { return <svg aria-hidden="true" className={`taskinnotes-flag taskinnotes-priority-${level}`} viewBox="0 0 16 16"><path d="M3 14V2m0 1c3-2 5 2 9 0v7c-4 2-6-2-9 0" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>; }

function FloatingMenu({ children, role, label, labels = false }: {children: ReactNode; role?: 'listbox'; label?: string; labels?: boolean}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = ref.current, anchor = menu?.parentElement;
    if (!menu || !anchor || typeof menu.showPopover !== 'function') return;
    menu.showPopover();
    const position = () => {
      const box = anchor.getBoundingClientRect(), margin = 8, gap = 4;
      const below = window.innerHeight - box.bottom - margin, above = box.top - margin;
      const border = menu.offsetHeight - menu.clientHeight;
      const height = Math.min(menu.scrollHeight + border, 200, Math.max(below, above) - gap);
      const top = below >= height + gap || below >= above ? box.bottom + gap : box.top - height - gap;
      const width = Math.min(labels ? box.width : menu.scrollWidth + border, window.innerWidth - margin * 2);
      Object.assign(menu.style, { left: `${Math.max(margin, Math.min(box.left, window.innerWidth - width - margin))}px`, top: `${Math.max(margin, top)}px`, width: `${width}px`, maxHeight: `${Math.max(40, height)}px` });
    };
    position(); window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); if (menu.matches(':popover-open')) menu.hidePopover(); };
  }, [labels]);
  return <div ref={ref} popover={typeof HTMLElement.prototype.showPopover === 'function' ? 'manual' : undefined} role={role} aria-label={label} className={`taskinnotes-dropdown-menu${labels ? ' taskinnotes-label-menu' : ''}`}>{children}</div>;
}

export function DuplicateIdForm({ onDecide }: {onDecide(generate: boolean, remember: boolean): void}) {
  const [remember, setRemember] = useState(false);
  return <div>
    <p>This block ID already exists in this note. Generate a new ID for this block to use it independently?</p>
    <label><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /> Remember my choice</label>
    <div className="taskinnotes-form-actions">
      <button type="button" onClick={() => onDecide(false, remember)}>Keep block in error</button>
      <button type="button" className="mod-cta" onClick={() => onDecide(true, remember)}>Generate new ID</button>
    </div>
  </div>;
}
