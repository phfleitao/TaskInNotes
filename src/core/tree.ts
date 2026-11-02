import type { Task } from './model';
export interface TaskNode { task: Task; children: TaskNode[] }
export function buildTaskTree(tasks: Task[]): TaskNode[] {
  const nodes = new Map(tasks.map(task => [task.id, { task, children: [] as TaskNode[] }]));
  const roots: TaskNode[] = [];
  for (const task of tasks) {
    const node = nodes.get(task.id)!;
    let parent = task.parentId ? nodes.get(task.parentId) : undefined;
    const seen = new Set([task.id]); let cursor = parent;
    while (cursor) {
      if (seen.has(cursor.task.id)) { parent = undefined; break; }
      seen.add(cursor.task.id); cursor = cursor.task.parentId ? nodes.get(cursor.task.parentId) : undefined;
    }
    if (parent) parent.children.push(node); else roots.push(node);
  }
  return roots;
}
