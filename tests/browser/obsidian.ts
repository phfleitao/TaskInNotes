// Test-only host boundary. This file is never bundled into the plugin.
export class TFile { constructor(public path: string) {} get basename() { return this.path.replace(/\.md$/, ''); } }
export const Platform = { isDesktopApp: false };
export class MarkdownView { constructor(public file: TFile, public editor: any) {} getMode() { return 'source'; } }
export class MarkdownRenderChild { constructor(public containerEl: HTMLElement) {} onload() {} onunload() {} }
export class Plugin {
  processor?: (source: string, el: HTMLElement, context: any) => unknown;
  constructor(public app: any, public manifest: any) {}
  async loadData() { return JSON.parse(localStorage.getItem('taskinnotes-test-settings') || '{"secretId":"test-only"}'); }
  async saveData(data: unknown) { localStorage.setItem('taskinnotes-test-settings', JSON.stringify(data)); }
  registerMarkdownCodeBlockProcessor(_name: string, handler: any) { this.processor = handler; }
  registerEvent(_ref: unknown) {}
  registerDomEvent(el: EventTarget, event: string, fn: EventListener) { el.addEventListener(event, fn); this.app.cleanups.push(() => el.removeEventListener(event, fn)); }
  addCommand(_command: unknown) {}
  addSettingTab(_tab: unknown) {}
}
export class PluginSettingTab { containerEl = document.createElement('div'); constructor(public app: any, public plugin: any) {} }
export class Modal {
  contentEl = document.createElement('div'); private dialog = document.createElement('dialog'); private heading = document.createElement('h2');
  constructor(public app: any) { this.dialog.append(this.heading, this.contentEl); this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); }); }
  setTitle(title: string) { this.heading.textContent = title; }
  onOpen() {} onClose() {}
  open() { document.body.append(this.dialog); this.dialog.showModal(); this.onOpen(); }
  close() { this.onClose(); this.dialog.close(); this.dialog.remove(); }
}
export class Notice { constructor(message: string) { const el = document.createElement('p'); el.setAttribute('role', 'status'); el.textContent = message; document.body.append(el); setTimeout(() => el.remove(), 3000); } }
class Button {
  constructor(private el: HTMLButtonElement) {} setButtonText(value: string) { this.el.textContent = value; return this; } setCta() { return this; } onClick(fn: () => void) { this.el.onclick = fn; return this; }
}
class Text {
  inputEl: HTMLInputElement;
  constructor(el: HTMLInputElement) { this.inputEl = el; }
  setValue(value: string) { this.inputEl.value = value; return this; } onChange(fn: (value: string) => void) { this.inputEl.oninput = () => fn(this.inputEl.value); return this; }
}
class Dropdown {
  constructor(private el: HTMLSelectElement) {} addOptions(options: Record<string,string>) { for (const [value, text] of Object.entries(options)) this.el.add(new Option(text, value)); return this; } setValue(value: string) { this.el.value = value; return this; } onChange(fn: (value: string) => void) { this.el.onchange = () => fn(this.el.value); return this; }
}
export class Setting {
  private el = document.createElement('div'); private label = document.createElement('label');
  constructor(parent: HTMLElement) { this.el.className = 'setting-item'; this.el.append(this.label); parent.append(this.el); }
  setName(name: string) { this.label.textContent = name; return this; }
  setDesc(desc: string) { const el = document.createElement('p'); el.textContent = desc; this.el.append(el); return this; }
  addComponent(fn: (el: HTMLElement) => unknown) { fn(this.el); return this; }
  addButton(fn: (button: Button) => unknown) { const el = document.createElement('button'); el.type = 'button'; this.el.append(el); fn(new Button(el)); return this; }
  addText(fn: (text: Text) => unknown) { const el = document.createElement('input'); this.label.append(el); fn(new Text(el)); return this; }
  addDropdown(fn: (dropdown: Dropdown) => unknown) { const el = document.createElement('select'); this.el.append(el); fn(new Dropdown(el)); return this; }
}
export class SecretComponent { constructor(_app: unknown, _el: HTMLElement) {} setValue(_value: string) { return this; } onChange(_fn: unknown) { return this; } }
let handler: (request: any) => Promise<any> = async () => { throw new Error('No test transport'); };
export function setRequestHandler(next: typeof handler) { handler = next; }
export const requestUrl = (request: unknown) => handler(request);
