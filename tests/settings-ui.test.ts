import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { TaskInNotesSettingsTab, loadSettings } from '../src/settings';
import type { App } from 'obsidian';
import type TaskInNotes from '../src/main';
import { Platform } from 'obsidian';

const nativeButton = vi.hoisted(() => ({ assimilations: 0 }));
vi.mock('obsidian', () => {
  class Modal {
    contentEl = document.createElement('div');
    constructor(public app: unknown) {}
    setTitle(value: string) { this.contentEl.setAttribute('aria-label', value); }
    onOpen() {} onClose() {}
    open() { document.body.append(this.contentEl); this.onOpen(); }
    close() { this.onClose(); this.contentEl.remove(); }
  }
  class Setting {
    el: HTMLDivElement;
    constructor(parent: HTMLElement) { this.el = document.createElement('div'); parent.append(this.el); }
    setName(value: string) { const p=document.createElement('span'); p.textContent=value; this.el.append(p); return this; }
    setDesc(value: string) { const p=document.createElement('p'); p.textContent=value; this.el.append(p); return this; }
    addButton(cb: (b: unknown) => void) { const el=document.createElement('button'); this.el.append(el); const b={setButtonText(v:string){el.textContent=v;return b;},setCta(){return b;},setDisabled(v:boolean){el.disabled=v;return b;},onClick(fn:()=>void){el.onclick=fn;return b;},then(resolve:(value:unknown)=>void){nativeButton.assimilations++; resolve(nativeButton.assimilations > 5 ? undefined : b);return b;}}; cb(b); return this; }
    addText(cb: (t: unknown) => void) { const inputEl=document.createElement('input'); this.el.append(inputEl); const t={inputEl,setPlaceholder(v:string){inputEl.placeholder=v;return t;},setValue(v:string){inputEl.value=v;return t;},setDisabled(v:boolean){inputEl.disabled=v;return t;},onChange(fn:(v:string)=>void){inputEl.oninput=()=>fn(inputEl.value);return t;}}; cb(t); return this; }
    addToggle(cb: (t: unknown) => void) { const input=document.createElement('input');input.type='checkbox';this.el.append(input);const t={setValue(v:boolean){input.checked=v;return t;},setDisabled(v:boolean){input.disabled=v;return t;},onChange(fn:(v:boolean)=>void){input.onchange=()=>fn(input.checked);return t;}};cb(t);return this; }
    addDropdown(cb: (d: unknown) => void) { const d={addOptions(){return d;},setValue(){return d;},onChange(){return d;}}; cb(d);return this; }
  }
  return { Modal, Setting, Platform: {isDesktopApp:true}, PluginSettingTab: class { containerEl=document.createElement('div'); constructor(public app:unknown,_plugin:unknown) {} }, Notice: class { constructor(message: string) { const notice = document.createElement('div'); notice.setAttribute('role','status'); notice.textContent = message; document.body.append(notice); } } };
});
afterEach(() => { document.body.replaceChildren(); });
function setup() {
  const secrets = new Map([['shared-secret','same-token']]);
  const app = {secretStorage:{getSecret:vi.fn((id:string)=>secrets.get(id)??null),setSecret:vi.fn((id:string,value:string)=>secrets.set(id,value))}};
  const plugin = {app,manifest:{version:'0.1.0'},settings:loadSettings({secretId:'shared-secret'}),saveSettings:vi.fn(async()=>{}),settingsChanged:vi.fn(),refreshViews:vi.fn(),trackDialog:vi.fn(),untrackDialog:vi.fn(),testConnection:vi.fn(async()=>{}),clearDebugLogs:vi.fn(async()=>2),ensureDebugDirectory:vi.fn(async()=>{})};
  const tab = new TaskInNotesSettingsTab(app as unknown as App, plugin as unknown as TaskInNotes);
  document.body.append(tab.containerEl); tab.display();
  return {app,plugin,secrets,tab};
}
it('keeps the secret hidden and can replace it with the same value without touching a shared secret', async () => {
  const {app,plugin,secrets,tab}=setup(); const user=userEvent.setup();
  expect(tab.containerEl.textContent).not.toContain('same-token');
  expect(app.secretStorage.getSecret).not.toHaveBeenCalled();
  expect(tab.containerEl.querySelector('input[type=password]')).toBeNull();
  expect(tab.containerEl.textContent?.indexOf('Todoist API token')).toBeLessThan(tab.containerEl.textContent!.indexOf('Show all messages'));
  await user.click(screen.getByRole('button',{name:'Replace token'}));
  const input=screen.getByLabelText('New API token') as HTMLInputElement;
  expect(input.type).toBe('password'); expect(input.value).toBe('');
  await user.type(input,'same-token'); await user.click(screen.getByRole('button',{name:'Save token'}));
  await waitFor(()=>expect(plugin.saveSettings).toHaveBeenCalled());
  expect(secrets.get('shared-secret')).toBe('same-token');
  expect(plugin.settings.secretId).toBe('taskinnotes-todoist-token');
  expect(secrets.get(plugin.settings.secretId)).toBe('same-token');
  expect(input.value).toBe('');
  await user.click(screen.getByRole('button',{name:'Replace token'}));
  await user.type(screen.getByLabelText('New API token'), 'new-token');
  await user.click(screen.getByRole('button',{name:'Save token'}));
  expect(plugin.settings.secretId).toBe('taskinnotes-todoist-token');
  expect(secrets.get('taskinnotes-todoist-token')).toBe('new-token');
});
it('reports both successful and failed connection checks in alerts', async () => {
  const {plugin}=setup();const user=userEvent.setup();
  await user.click(screen.getByRole('button',{name:'Test connection'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Connected to Todoist successfully.');
  await user.click(screen.getByRole('button',{name:'OK'}));
  plugin.testConnection.mockRejectedValueOnce(new Error('sensitive data'));
  await user.click(screen.getByRole('button',{name:'Test connection'}));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).not.toContain('sensitive data');
  expect(alert.textContent).toBeTruthy();
});
it('reuses the existing plugin-owned key when upgrading an older installation', async () => {
  const {plugin,secrets,tab}=setup(); const user=userEvent.setup();
  const legacy = 'taskinnotes-12345678-1234-4123-8123-123456789abc';
  plugin.settings.secretId = legacy; secrets.set(legacy, 'old-token'); tab.display();
  await user.click(screen.getByRole('button',{name:'Replace token'}));
  await user.type(screen.getByLabelText('New API token'), 'new-token');
  await user.click(screen.getByRole('button',{name:'Save token'}));
  expect(plugin.settings.secretId).toBe(legacy); expect(secrets.get(legacy)).toBe('new-token');
});
it('shows the version and lets the user enable diagnostics and choose a directory', async () => {
  const {plugin,tab}=setup(); const user=userEvent.setup();
  expect(tab.containerEl.querySelector('h2')?.textContent).toBe('Task in Notes');
  expect(tab.containerEl.textContent).toContain('Version 0.1.0');
  expect(tab.containerEl.textContent).not.toContain('All remote updates are manual');
  const toggles=tab.containerEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
  expect(toggles[1]?.checked).toBe(false);
  await user.click(toggles[1]!);
  expect(plugin.settings.debugEnabled).toBe(true);
  expect(plugin.ensureDebugDirectory).toHaveBeenCalledOnce();
  await user.type(screen.getByPlaceholderText('Default location'), 'my-logs');
  expect(plugin.settings.logDirectory).toBe('my-logs');
  expect(plugin.saveSettings).toHaveBeenCalled();
});

it('reports cleared logs without resolving a promise with the native thenable button', async () => {
  const {plugin}=setup(); const user=userEvent.setup();
  nativeButton.assimilations = 0;
  await user.click(screen.getByRole('button',{name:'Clear logs'}));
  expect(plugin.clearDebugLogs).toHaveBeenCalledOnce();
  expect((await screen.findByRole('alert')).textContent).toContain('2');
  expect((screen.getByRole('button',{name:'Clear logs'}) as HTMLButtonElement).disabled).toBe(false);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(nativeButton.assimilations).toBe(0);
});
it('reports a clear failure without leaving the button disabled', async () => {
  const {plugin}=setup(); const user=userEvent.setup();
  plugin.clearDebugLogs.mockRejectedValueOnce(new Error('private path'));
  await user.click(screen.getByRole('button',{name:'Clear logs'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Could not clear the logs');
  await waitFor(() => expect((screen.getByRole('button',{name:'Clear logs'}) as HTMLButtonElement).disabled).toBe(false));
});

it('does not offer vault-backed logging where a local temporary directory is unavailable', () => {
  Platform.isDesktopApp = false;
  try {
    const {tab} = setup();
    const toggles = tab.containerEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    expect(toggles[1]?.disabled).toBe(true);
    expect((screen.getByRole('button',{name:'Clear logs'}) as HTMLButtonElement).disabled).toBe(true);
    expect(tab.containerEl.textContent).toContain('No debug logs are written on mobile.');
  } finally { Platform.isDesktopApp = true; }
});
