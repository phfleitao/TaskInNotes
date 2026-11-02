import { describe, it, expect } from 'vitest';
import { TodoistClient } from '../../src/core/todoist';

describe('Todoist API boundary', () => {
  it('tests the saved credentials with one read-only request and reports failures safely', async () => {
    const requests: string[] = [];
    const client = new TodoistClient(async request => { requests.push(`${request.method} ${request.url}`); return {status:200,json:{results:[],next_cursor:null}}; }, () => 'test-secret');
    await expect(client.testConnection()).resolves.toBeUndefined();
    expect(requests).toEqual(['GET https://api.todoist.com/api/v1/projects?limit=1']);
    const denied = new TodoistClient(async () => ({status:401,json:{message:'test-secret'}}), () => 'test-secret');
    await expect(denied.testConnection()).rejects.toMatchObject({code:'authentication'});
    await expect(denied.testConnection()).rejects.not.toThrow('test-secret');
  });
  it('collects all task and project pages and preserves recurring due dates', async () => {
    const urls: string[] = [];
    const client = new TodoistClient(async request => {
      const url = new URL(request.url); urls.push(request.url);
      expect(request.headers.Authorization).toBe('Bearer test-only-secret');
      if (url.pathname.endsWith('/projects')) return { status: 200, json: { results: [{ id: 'p', name: 'Inbox' }], next_cursor: url.searchParams.has('cursor') ? null : 'projects-next' } };
      return { status: 200, json: { results: [{ id: url.searchParams.has('cursor') ? '2' : '1', content: 'Task', project_id: 'p', due: { date: '2026-11-02T10:30:00', is_recurring: true } }], next_cursor: url.searchParams.has('cursor') ? null : 'tasks-next' } };
    }, () => 'test-only-secret');
    const tasks = await client.query('today | #Work');
    expect(tasks.map(t => t.id)).toEqual(['1', '2']);
    expect(tasks[0]).toMatchObject({ project: 'Inbox', due: '2026-11-02T10:30:00', isRecurring: true });
    expect(urls).toHaveLength(4);
    expect(new URL(urls[0]!).searchParams.get('query')).toBe('today | #Work');
    expect(urls.every(url => new URL(url).origin === 'https://api.todoist.com')).toBe(true);
  });
  it('creates in Inbox with explicit date and closes through the recurring-safe endpoint', async () => {
    const requests: { url: string; method: string; body?: string }[] = [];
    const client = new TodoistClient(async request => {
      requests.push(request);
      return { status: 200, json: request.url.endsWith('/close') ? null : { id: 'created' } };
    }, () => 'test-only-secret');
    expect(await client.create({ title: 'New', due: '2026-11-03' })).toBe('created');
    await client.complete('task/id');
    expect(JSON.parse(requests[0]!.body!)).toEqual({ content: 'New', due_date: '2026-11-03' });
    expect(requests[1]!.url).toBe('https://api.todoist.com/api/v1/tasks/task%2Fid/close');
  });
  it('sanitizes authentication, rate limits, invalid filters and unknown mutation outcomes', async () => {
    for (const [status, code] of [[401, 'authentication'], [429, 'rate-limit'], [400, 'remote']] as const) {
      const client = new TodoistClient(async () => ({ status, json: { message: 'Bearer test-only-secret private task' } }), () => 'test-only-secret');
      await expect(client.query('today')).rejects.toMatchObject({ code });
      await expect(client.query('today')).rejects.not.toThrow('test-only-secret');
    }
    const offline = new TodoistClient(async () => { throw new Error('test-only-secret'); }, () => 'test-only-secret');
    await expect(offline.query('today')).rejects.toMatchObject({ code: 'network' });
    await expect(offline.create({ title: 'New' })).rejects.toMatchObject({ code: 'unknown-outcome' });
    const missing = new TodoistClient(async () => { throw new Error('Must not contact the network'); }, () => null);
    await expect(missing.query('today')).rejects.toMatchObject({ code: 'authentication' });
  });
  it('rejects incomplete or looping pagination instead of treating it as a valid empty result', async () => {
    const client = new TodoistClient(async () => ({ status: 200, json: { results: [], next_cursor: 'same' } }), () => 'test');
    await expect(client.query('today')).rejects.toMatchObject({ code: 'remote' });
    const broken = new TodoistClient(async () => ({ status: 200, json: {} }), () => 'test');
    await expect(broken.query('today')).rejects.toMatchObject({ code: 'remote' });
  });
});
