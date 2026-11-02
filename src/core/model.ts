export interface BlockConfig { schemaVersion: 1; id?: string; filter: string; title?: string }
export interface Task { id: string; title: string; due: string | null; project: string; projectId: string; isRecurring: boolean; parentId?: string | null; description?: string; labels?: string[]; priority?: number }
export interface Snapshot { fetchedAt: string; resolvedFilter: string; tasks: (Pick<Task, 'id' | 'title' | 'due' | 'project'> & Partial<Pick<Task, 'parentId' | 'description' | 'labels' | 'priority'>>)[] }
export interface CreateTaskInput { title: string; due?: string; description?: string; priority?: number; projectId?: string; labels?: string[] }
export interface TaskOptions { projects: {id: string; name: string; isInbox?: boolean}[]; labels: {id: string; name: string}[] }
export interface TaskProvider { query(filter: string): Promise<Task[]>; create(input: CreateTaskInput): Promise<string>; complete(id: string): Promise<void>; getOptions?(): Promise<TaskOptions> }
export type ErrorCode = 'configuration' | 'authentication' | 'rate-limit' | 'network' | 'remote' | 'unknown-outcome' | 'stale' | 'persistence';
export class TaskError extends Error {
  constructor(public readonly code: ErrorCode, message: string) { super(message); this.name = 'TaskError'; }
}
export const configurationError = (message: string): never => { throw new TaskError('configuration', message); };
export function safeError(error: unknown): string {
  return error instanceof TaskError ? error.message : 'The operation failed. Please try again.';
}
