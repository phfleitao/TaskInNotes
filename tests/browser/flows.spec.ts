import { test, expect } from '@playwright/test';
const block = '```taskinnotes\nid: a\nfilter: today\n```';

test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible(); });
test('Refresh replaces tasks in both the UI and raw Markdown, including empty results', async ({ page }) => {
  await expect(page.getByLabel('API calls')).toHaveText('0');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('Original server task', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Note Markdown')).toHaveValue(/Original server task/);
  await page.locator('#rendered').screenshot({ path: 'test-results/taskinnotes-list.png' });
  await page.getByLabel('Server scenario').selectOption('replacement');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('Replacement task', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Note Markdown')).not.toHaveValue(/Original server task/);
  await page.getByLabel('Server scenario').selectOption('empty');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('No tasks match this filter.')).toBeVisible();
  await expect(page.getByLabel('Note Markdown')).toHaveValue(/tasks: \[\]/);
});

test('long label lists scroll while short ones fit naturally', async ({page}) => {
  await page.getByLabel('Server scenario').selectOption('many-labels');
  await page.getByRole('button',{name:'Add task',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Labels',exact:true}).click();
  await expect(dialog.getByLabel('Label 0')).toBeVisible();
  expect(await dialog.locator('.taskinnotes-label-menu').evaluate(el=>el.scrollHeight > el.clientHeight)).toBe(true);
  await dialog.getByLabel('Label 7').check();
  await dialog.getByRole('button',{name:/Labels:/}).click();
  await expect(dialog.getByRole('button',{name:/Labels:/})).toContainText('@Label 7');
});
test('creates and completes through the production plugin UI', async ({ page }) => {
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task title').fill('Created from browser test');
  await dialog.getByLabel('Due date').fill('2026-11-03');
  await dialog.screenshot({ path: 'test-results/taskinnotes-create.png' });
  await dialog.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Created from browser test', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Complete Created from browser test', exact: true }).click();
  await expect(page.getByText('Created from browser test', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Note Markdown')).not.toHaveValue(/Created from browser test/);
});
test('handles paste and residual duplicates with a remembered decision', async ({ page }) => {
  const editor = page.getByLabel('Note Markdown');
  await editor.fill('');
  await editor.evaluate((element, text) => {
    const data = new DataTransfer(); data.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  }, block);
  await expect(editor).not.toHaveValue(/id: a\n/);
  await expect(editor).toHaveValue(/filter: today/);
  await editor.fill(block + '\n' + block);
  await page.getByRole('button', { name: 'Render note' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Remember my choice').check();
  await dialog.getByRole('button', { name: 'Generate new ID', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(2);
  await expect.poll(async () => (await editor.inputValue()).match(/id: a\n/g)?.length).toBe(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('taskinnotes-test-settings') || '{}').duplicateIdPolicy)).toBe('regenerate');
  await editor.fill(block + '\n' + block + '\n' + block);
  await page.getByRole('button', { name: 'Render note' }).click();
  await expect.poll(async () => (await editor.inputValue()).match(/id: a\n/g)?.length).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('snapshot editing repairs locally and restart never loads it as interactive state', async ({ page }) => {
  await page.getByRole('button', { name: 'Refresh' }).click();
  const editor = page.getByLabel('Note Markdown');
  await expect(editor).toHaveValue(/Original server task/);
  const calls = await page.getByLabel('API calls').textContent();
  await editor.fill((await editor.inputValue()).replace('Original server task', 'Manually edited snapshot'));
  await page.getByRole('button', { name: 'Render note' }).click();
  await expect(editor).toHaveValue(/Original server task/);
  await expect(page.getByLabel('API calls')).toHaveText(calls!);
  await page.getByRole('button', { name: 'Restart plugin' }).click();
  await expect(page.getByText('Original server task', { exact: true })).toHaveCount(0);
  await expect(editor).toHaveValue(/Original server task/);
  await expect(page.getByLabel('API calls')).toHaveText(calls!);
});

test('does not reopen a dismissed duplicate alert just because the same note renders again', async ({ page }) => {
  const editor = page.getByLabel('Note Markdown');
  await editor.fill(block + '\n' + block);
  await page.getByRole('button', { name: 'Render note' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Keep block in error' }).click();
  await page.getByRole('button', { name: 'Render note' }).click();
  await expect(page.getByRole('button', { name: 'Resolve duplicate ID' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('custom title, task details and expandable hierarchy use the production UI', async ({ page }) => {
  const editor = page.getByLabel('Note Markdown');
  await editor.fill((await editor.inputValue()).replace('filter: today', 'filter: today\ntitle: "Daily work"'));
  await page.getByRole('button', {name:'Render note'}).click();
  await expect(page.getByText('Daily work')).toBeVisible();
  await page.getByRole('button', {name:'Add task',exact:true}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task title').fill('Detailed browser task');
  await dialog.getByLabel('Description').fill('Searchable detail');
  await expect(dialog.getByLabel('Project')).toHaveValue('p');
  await expect(dialog.getByRole('option', {name:'#Inbox'})).toHaveCount(1);
  await dialog.getByRole('button', {name:/Priority:/}).click();
  await dialog.getByRole('option', {name:'Priority 1'}).click();
  await dialog.getByRole('button', {name:'Labels', exact:true}).click();
  await dialog.getByLabel('Work').check();
  await dialog.getByLabel('Home').check();
  await dialog.getByRole('button', {name:/Labels:/}).click();
  await expect(dialog.getByRole('button', {name:/Labels:/})).toContainText('@Work');
  await expect(dialog.getByRole('button', {name:/Labels:/})).toContainText('@Home');
  await dialog.getByRole('button', {name:'Add task',exact:true}).click();
  await expect(editor).toHaveValue(/Searchable detail/);
  await expect(editor).toHaveValue(/labels: \["Work", "Home"\]/);
  await expect(page.getByRole('link', {name:'Detailed browser task'})).toHaveAttribute('href', /app\.todoist\.com\/app\/task\//);
  await page.getByLabel('Server scenario').selectOption('hierarchy');
  await page.getByRole('button', {name:'Refresh'}).click();
  await expect(page.getByText('Grandchild task', {exact:true})).toBeVisible();
  const child = page.getByText('Child task', {exact:true}).locator('xpath=ancestor::li[1]');
  await expect(child).toHaveCSS('margin-left', '0px');
  await expect(child.locator('xpath=parent::ul/parent::div')).toHaveCSS('border-left-width', '0px');
  await page.getByRole('button', {name:'Collapse subtasks of Parent task'}).click();
  await expect(page.getByText('Grandchild task', {exact:true})).toHaveCount(0);
  await page.getByRole('button', {name:'Expand subtasks of Parent task'}).click();
  await expect(page.getByText('Grandchild task', {exact:true})).toBeVisible();
});

test('form controls share a row and both menus remain visible beyond a clipped dialog', async ({page}) => {
  await page.getByRole('button',{name:'Add task',exact:true}).click();
  const dialog = page.getByRole('dialog');
  const date = await dialog.getByLabel('Due date').boundingBox();
  const priority = await dialog.getByRole('button',{name:/Priority:/}).boundingBox();
  const project = await dialog.getByLabel('Project').boundingBox();
  expect(Math.abs(date!.y-priority!.y)).toBeLessThan(4);
  expect(Math.abs(date!.y-project!.y)).toBeLessThan(4);
  await dialog.evaluate(el => { el.style.overflow='hidden'; el.style.height='340px'; });
  await dialog.getByRole('button',{name:/Priority:/}).click();
  await expect(dialog.getByRole('option',{name:'Priority 4'})).toBeVisible();
  expect(await dialog.getByRole('listbox',{name:'Priority'}).evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
  const spacing = await dialog.getByRole('listbox',{name:'Priority'}).evaluate(el => {
    const menu = el.getBoundingClientRect(), button = el.querySelector('button')!, icon = button.querySelector('svg')!.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(button.lastChild!); const text = range.getBoundingClientRect();
    return {left:icon.left - menu.left, right:menu.right - text.right};
  });
  expect(spacing.left).toBeGreaterThan(0); expect(spacing.left).toBeLessThan(16);
  expect(spacing.right).toBeGreaterThan(0); expect(spacing.right).toBeLessThan(16);
  const checkHit = async (selector: string) => page.locator(selector).evaluate(el => {
    const r=el.getBoundingClientRect(); const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return Boolean(hit && (hit===el || el.contains(hit)));
  });
  expect(await checkHit('[role="option"]:last-child')).toBe(true);
  await dialog.getByRole('option',{name:'Priority 4'}).click();
  await dialog.getByRole('button',{name:'Labels',exact:true}).click();
  await expect(dialog.getByLabel('Home')).toBeVisible();
  expect(await dialog.locator('.taskinnotes-label-menu').evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
  expect(await checkHit('.taskinnotes-label-menu label:last-child')).toBe(true);
});

test('a completion automatically reconciles every block in the open note', async ({page}) => {
  const editor=page.getByLabel('Note Markdown');
  await editor.fill('```taskinnotes\nid: a\nfilter: today\n```\n\n```taskinnotes\nid: b\nfilter: overdue\n```');
  await page.getByRole('button',{name:'Render note'}).click();
  const blocks=page.locator('#rendered .taskinnotes-block');
  await expect(blocks).toHaveCount(2);
  await blocks.nth(0).getByRole('button',{name:'Refresh'}).click();
  await blocks.nth(1).getByRole('button',{name:'Refresh'}).click();
  await expect(page.getByText('Original server task',{exact:true})).toHaveCount(2);
  await blocks.nth(0).getByRole('button',{name:'Complete Original server task'}).click();
  await expect(page.getByText('Original server task',{exact:true})).toHaveCount(0);
  await expect(blocks.nth(1).getByText(/need reconciliation/)).toHaveCount(0);
  await expect.poll(async()=>((await editor.inputValue()).match(/tasks: \[\]/g)||[]).length).toBe(2);
});
