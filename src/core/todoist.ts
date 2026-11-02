import { TaskError, type Task, type TaskProvider, type CreateTaskInput, type TaskOptions } from './model';
import { validDate } from './config';
import type { ApiDiagnostic } from './debug';
export interface ApiRequest { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }
export interface ApiResponse { status: number; json: unknown }
export type Transport = (request: ApiRequest) => Promise<ApiResponse>;
const BASE = 'https://api.todoist.com/api/v1';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function invalid(): never { throw new TaskError('remote', 'Todoist returned an incomplete or invalid response. The previous snapshot was preserved.'); }

export class TodoistClient implements TaskProvider {
  constructor(private readonly transport: Transport, private readonly secret: () => string | null, private readonly timeoutMs = 30000, private readonly diagnostic?: (event: ApiDiagnostic) => void) {}
  private async request(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<unknown> {
    let token: string | null;
    try { token = this.secret(); } catch { token = null; }
    if (!token) throw new TaskError('authentication', 'Configure a Todoist token in Obsidian SecretStorage before continuing.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const start = Date.now();
    const route = path.split('?')[0]!;
    const endpoint = /^\/tasks\/[^/]+\/close$/.test(route) ? '/tasks/{id}/close' : ['/tasks/filter', '/tasks', '/projects', '/labels', '/labels/shared'].includes(route) ? route : '/other';
    const redact = (value: string) => {
      let result = value.replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]').replace(/\b(token|authorization|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
      if (token) for (const secret of new Set([token, encodeURIComponent(token)])) if (secret) result = result.split(secret).join('[redacted]');
      return result.slice(0, 1000);
    };
    const action = method === 'POST' && endpoint === '/tasks' ? 'Create task' : endpoint === '/tasks/{id}/close' ? 'Complete task' : endpoint === '/tasks/filter' ? 'Filter tasks' : `Read ${endpoint}`;
    const report = (status: ApiDiagnostic['status'], payload?: unknown) => {
      try {
        const taskMatch = route.match(/^\/tasks\/([^/]+)\/close$/);
        const data = object(payload) ? payload : {};
        const taskId = taskMatch ? decodeURIComponent(taskMatch[1]!) : method === 'POST' && endpoint === '/tasks' && typeof data.id === 'string' ? data.id : undefined;
        const projectId = object(body) && typeof body.project_id === 'string' ? body.project_id : undefined;
        const remoteMessage = typeof data.message === 'string' ? data.message : typeof data.error === 'string' ? data.error : undefined;
        const message = remoteMessage || (typeof status === 'number' ? status >= 200 && status < 300 ? 'Request succeeded' : `Request failed with HTTP ${status}` : status === 'timeout' ? 'Request timed out' : 'Network request failed');
        this.diagnostic?.({ method, endpoint, status, durationMs: Math.max(0, Date.now() - start), action, message: redact(message), ...(taskId ? {taskId: redact(taskId)} : {}), ...(projectId ? {projectId: redact(projectId)} : {}) });
      } catch { /* Diagnostics never affect requests. */ }
    };
    let response: ApiResponse;
    try {
      response = await Promise.race([
        this.transport({ url: BASE + path, method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error('timeout')); }, this.timeoutMs); })
      ]);
    } catch {
      report(timedOut ? 'timeout' : 'network_error');
      throw new TaskError(method === 'POST' ? 'unknown-outcome' : 'network', method === 'POST'
        ? 'The Todoist command outcome is unknown. Check Todoist, then Refresh before another command. It was not retried.'
        : 'Could not reach Todoist. Check your connection and Refresh again.');
    } finally { clearTimeout(timer); }
    report(response.status, response.json);
    if (response.status === 401 || response.status === 403) throw new TaskError('authentication', 'Todoist rejected the credentials or permissions. Check your token in SecretStorage.');
    if (response.status === 429) throw new TaskError('rate-limit', 'Todoist rate limit reached. Wait before trying again.');
    if (response.status >= 500 && method === 'POST') throw new TaskError('unknown-outcome', 'Todoist could not confirm the command outcome. Check Todoist and Refresh; the command was not retried.');
    if (response.status < 200 || response.status >= 300) throw new TaskError('remote', 'Todoist rejected the request. Check the filter or task details. Multiple filter lists separated by commas are not supported.');
    return response.json;
  }
  private async pageValues(path: string): Promise<unknown[]> {
    const results: unknown[] = [], cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const payload = await this.request(path + (path.includes('?') ? '&' : '?') + 'limit=200' + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''));
      if (!object(payload) || !Array.isArray(payload.results) || !(payload.next_cursor === null || typeof payload.next_cursor === 'string')) invalid();
      results.push(...payload.results);
      cursor = payload.next_cursor as string | null;
      if (cursor !== null && (!cursor || cursors.has(cursor))) invalid();
      if (cursor) cursors.add(cursor);
    } while (cursor !== null);
    return results;
  }
  private async pages(path: string): Promise<Record<string, unknown>[]> { const values = await this.pageValues(path); if (!values.every(object)) return invalid(); return values; }
  async testConnection(): Promise<void> {
    const payload = await this.request('/projects?limit=1');
    if (!object(payload) || !Array.isArray(payload.results)) invalid();
  }
  async query(filter: string): Promise<Task[]> {
    const matched = await this.pages(`/tasks/filter?query=${encodeURIComponent(filter)}&lang=en`);
    const tasks = [...matched];
    if (matched.length && matched.some(t => Object.hasOwn(t, 'parent_id'))) {
      const all = await this.pages('/tasks');
      const included = new Set(matched.map(t => t.id));
      let changed = true;
      while (changed) {
        changed = false;
        for (const task of all) if (typeof task.id === 'string' && typeof task.parent_id === 'string' && included.has(task.parent_id) && !included.has(task.id)) {
          included.add(task.id); tasks.push(task); changed = true;
        }
      }
      const allById = new Map(all.map(task => [task.id, task]));
      for (let i = 0; i < tasks.length; i++) {
        const parentId = tasks[i]!.parent_id;
        if (typeof parentId !== 'string' || included.has(parentId)) continue;
        const parent = allById.get(parentId);
        if (parent) { included.add(parentId); tasks.push(parent); }
      }
    }
    const projects = await this.pages('/projects');
    const names = new Map<string, string>();
    for (const p of projects) { if (typeof p.id !== 'string' || typeof p.name !== 'string') invalid(); names.set(p.id, p.name); }
    const seen = new Set<string>();
    return tasks.flatMap(t => {
      if (typeof t.id !== 'string' || !t.id || typeof t.content !== 'string' || typeof t.project_id !== 'string' || !names.has(t.project_id)) invalid();
      if (seen.has(t.id)) return [];
      seen.add(t.id);
      if (t.due !== null && t.due !== undefined && (!object(t.due) || typeof t.due.date !== 'string' || typeof t.due.is_recurring !== 'boolean')) invalid();
      const due = object(t.due) ? t.due : null;
      return [{ id: t.id, title: t.content, projectId: t.project_id, project: names.get(t.project_id)!, due: due ? (typeof due.datetime === 'string' ? due.datetime : due.date as string) : null, isRecurring: due?.is_recurring === true, parentId: typeof t.parent_id === 'string' ? t.parent_id : null, description: typeof t.description === 'string' ? t.description : '', labels: Array.isArray(t.labels) ? t.labels.filter((v): v is string => typeof v === 'string') : [], priority: typeof t.priority === 'number' ? t.priority : undefined }];
    });
  }
  async getOptions(): Promise<TaskOptions> {
    const [projects, labels, shared] = await Promise.all([this.pages('/projects'), this.pages('/labels'), this.pageValues('/labels/shared')]);
    if (!shared.every(value => typeof value === 'string')) return invalid();
    const normalize = (items: Record<string, unknown>[]) => items.map(item => {
      if (typeof item.id !== 'string' || typeof item.name !== 'string') return invalid();
      return { id: item.id, name: item.name };
    });
    const known = normalize(labels);
    for (const name of shared as string[]) if (!known.some(item => item.name.toLowerCase() === name.toLowerCase())) known.push({ id: `shared:${name}`, name });
    const normalizedProjects = normalize(projects).map((project, index) => ({ ...project, ...(projects[index]?.inbox_project === true ? { isInbox: true } : {}) }));
    return { projects: normalizedProjects, labels: known };
  }
  async create(input: CreateTaskInput): Promise<string> {
    if (!input.title.trim() || (input.due !== undefined && !validDate(input.due))) throw new TaskError('configuration', 'Enter a task title and a valid optional date.');
    const task = await this.request('/tasks', 'POST', { content: input.title.trim(), ...(input.due ? { due_date: input.due } : {}), ...(input.description ? { description: input.description } : {}), ...(input.projectId ? { project_id: input.projectId } : {}), ...(input.priority ? { priority: input.priority } : {}), ...(input.labels?.length ? { labels: input.labels } : {}) });
    if (!object(task) || typeof task.id !== 'string' || !task.id) throw new TaskError('unknown-outcome', 'Todoist did not return a valid task ID. Check Todoist and Refresh before creating another task.');
    return task.id;
  }
  async complete(id: string): Promise<void> {
    if (!id || id.startsWith('tmp-')) throw new TaskError('configuration', 'A confirmed Todoist task ID is required.');
    await this.request(`/tasks/${encodeURIComponent(id)}/close`, 'POST');
  }
}
