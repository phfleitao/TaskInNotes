import { it, expect } from 'vitest';
import { parseBlock } from '../../src/core/config';
import { buildTaskTree } from '../../src/core/tree';
import { TodoistClient } from '../../src/core/todoist';
import type { Task } from '../../src/core/model';
const task = (id: string, parentId?: string): Task => ({ id, title: id, due: null, project: 'Inbox', projectId: 'p', isRecurring: false, parentId });
it('allows a custom title and defaults when omitted', () => {
 expect(parseBlock('filter: today\ntitle: "Work tasks"').config.title).toBe('Work tasks');
 expect(parseBlock('filter: today').config.title).toBeUndefined();
 expect(() => parseBlock('filter: today\ntitle: 4')).toThrow();
});
it('builds nested trees independent of order and keeps orphans and cycles visible', () => {
 const tree = buildTaskTree([task('grandchild','child'), task('child','root'), task('root'), task('orphan','missing'), task('cycle','cycle')]);
 expect(tree.map(n => n.task.id)).toEqual(['root','orphan','cycle']);
 expect(tree[0]!.children[0]!.children[0]!.task.id).toBe('grandchild');
});
it('loads existing projects and labels and submits optional task fields', async () => {
 const requests: {url:string;body?:string}[]=[];
 const client = new TodoistClient(async r => { requests.push(r); if(r.method==='POST') return {status:200,json:{id:'new'}}; return {status:200,json:{results:r.url.includes('/labels/shared')?[]:r.url.includes('/labels')?[{id:'l',name:'Work'}]:[{id:'p',name:'Entrada',inbox_project:true}],next_cursor:null}}; },()=> 'test');
 expect(await client.getOptions()).toEqual({projects:[{id:'p',name:'Entrada',isInbox:true}],labels:[{id:'l',name:'Work'}]});
 await client.create({title:'Task',description:'Notes',due:'2026-11-03',priority:4,projectId:'p',labels:['Work']});
 expect(JSON.parse(requests.at(-1)!.body!)).toEqual({content:'Task',description:'Notes',due_date:'2026-11-03',priority:4,project_id:'p',labels:['Work']});
});
it('includes ancestor context and all descendants of matching tasks', async () => {
 const items = [
  {id:'p',content:'parent',project_id:'project',parent_id:null,due:null},
  {id:'c',content:'child',project_id:'project',parent_id:'p',due:null},
  {id:'g',content:'grandchild',project_id:'project',parent_id:'c',due:null},
  {id:'s',content:'unrelated sibling',project_id:'project',parent_id:'p',due:null}
 ];
 const client = new TodoistClient(async r => ({status:200,json:{results:r.url.includes('/projects')?[{id:'project',name:'Inbox'}]:r.url.includes('/filter')?[items[1]]:items,next_cursor:null}}),()=> 'test');
 const tasks = await client.query('today'); expect(tasks.map(t=>t.id).sort()).toEqual(['c','g','p']);
});
it('includes existing shared labels as well as personal labels', async () => {
 const client = new TodoistClient(async r => ({status:200,json:{results:r.url.includes('/labels/shared')?['Shared','Work']:r.url.includes('/labels')?[{id:'1',name:'Work'}]:[{id:'p',name:'Inbox'}],next_cursor:null}}),()=> 'test');
 expect((await client.getOptions()).labels.map(x=>x.name)).toEqual(['Work','Shared']);
});
