import { vi } from 'vitest';
export class TFile { constructor(public path: string) {} get basename() { return this.path.split('/').at(-1)!.replace(/\.md$/, ''); } }
export class MarkdownView {}
export const Platform = { isDesktopApp: false };
export class MarkdownRenderChild {
  constructor(public containerEl: HTMLElement) {}
  registerDomEvent(el: EventTarget, event: string, fn: EventListener) { el.addEventListener(event, fn); }
  onload() {} onunload() {}
}
export class Plugin {
  processor?: (source: string, el: HTMLElement, context: any) => unknown;
  commands: any[] = [];
  events: any[] = [];
  constructor(public app: any, public manifest: any) {}
  async loadData() { return {}; }
  async saveData(_data: unknown) {}
  registerMarkdownCodeBlockProcessor(_name: string, handler: any) { this.processor = handler; }
  registerEvent(event: any) { this.events.push(event); }
  registerDomEvent(el: EventTarget, event: string, fn: EventListener) { el.addEventListener(event, fn); }
  addCommand(command: any) { this.commands.push(command); }
  addSettingTab(_tab: any) {}
}
export class PluginSettingTab { containerEl = document.createElement('div'); constructor(public app: any, public plugin: any) {} }
export class Modal { contentEl = document.createElement('div'); constructor(public app: any) {} setTitle(_title: string) {} onOpen() {} onClose() {} open() { this.onOpen(); } close() { this.onClose(); } }
export class Notice { constructor(_message: string) {} }
export class SecretComponent {}
export class Setting {}
export const requestUrl = vi.fn();
