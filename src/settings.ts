import { App, Modal, Notice, Platform, PluginSettingTab, Setting } from 'obsidian';
import type TaskInNotes from './main';
import { safeError } from './core/model';
import { defaultLogDirectory } from './core/log-storage';
export interface Settings { secretId: string; duplicateIdPolicy: 'ask' | 'regenerate' | 'error'; showSuccessFeedback: boolean; debugEnabled: boolean; logDirectory: string }
export function loadSettings(data: unknown): Settings {
  const value = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  return {
    secretId: typeof value.secretId === 'string' && /^[a-z0-9-]*$/.test(value.secretId) ? value.secretId : '',
    duplicateIdPolicy: ['ask', 'regenerate', 'error'].includes(value.duplicateIdPolicy as string) ? value.duplicateIdPolicy as Settings['duplicateIdPolicy'] : 'ask',
    showSuccessFeedback: value.showSuccessFeedback === true,
    debugEnabled: value.debugEnabled === true,
    logDirectory: typeof value.logDirectory === 'string' ? value.logDirectory : ''
  };
}
export class TaskInNotesSettingsTab extends PluginSettingTab {
  constructor(app: App, private taskPlugin: TaskInNotes) { super(app, taskPlugin); }
  private async persist(resetMemory = false) {
    try { await this.taskPlugin.saveSettings(); if (resetMemory) this.taskPlugin.settingsChanged(); }
    catch { new Notice('TaskInNotes settings could not be saved.'); }
  }
  display() {
    const el = this.containerEl;
    el.replaceChildren();
    const heading = document.createElement('h2'); heading.className = 'taskinnotes-settings-heading'; heading.textContent = 'Task in Notes'; el.append(heading);
    const version = document.createElement('p'); version.className = 'taskinnotes-settings-version'; version.textContent = `Version ${this.taskPlugin.manifest.version}`; el.append(version);
    const description = document.createElement('p'); description.textContent = 'Bring your Todoist tasks into your notes, keep them close to your ideas, and make their latest results searchable throughout your vault.'; el.append(description);
    const available = !!this.app.secretStorage && typeof this.app.secretStorage.getSecret === 'function' && typeof this.app.secretStorage.setSecret === 'function';
    let testing = false;
    new Setting(el).setName('Todoist API token').setDesc(available ? 'Saved securely in Obsidian SecretStorage. The saved value is never shown here.' : 'SecretStorage is unavailable. Update Obsidian to 1.11.5 or later.')
      .addButton(button => button.setButtonText(this.taskPlugin.settings.secretId ? 'Replace token' : 'Set token').setDisabled(!available).onClick(() => new TokenModal(this.taskPlugin, () => { void this.persist(true); this.display(); }).open()))
      .addButton(button => button.setButtonText('Test connection').setDisabled(!available).onClick(() => {
        if (testing) return;
        testing = true; button.setDisabled(true);
        void this.taskPlugin.testConnection().then(() => new ConnectionResultModal(this.taskPlugin, 'Connection successful', 'Connected to Todoist successfully.').open(), error => new ConnectionResultModal(this.taskPlugin, 'Connection failed', safeError(error)).open()).finally(() => { testing = false; button.setDisabled(false); });
      }));
    new Setting(el).setName('Show all messages').setDesc('Show all feedback messages, including successful actions. When off, only warnings and errors are shown.')
      .addToggle(toggle => toggle.setValue(this.taskPlugin.settings.showSuccessFeedback).onChange(value => {
        this.taskPlugin.settings.showSuccessFeedback = value; void this.persist(); this.taskPlugin.refreshViews();
      }));
    new Setting(el).setName('Enable debug logging').setDesc(Platform.isDesktopApp ? 'When enabled, daily logs are written locally on this device in the folder below. Logs contain API actions, IDs and messages, but never tokens.' : 'Local debug logging is available on desktop only. No debug logs are written on mobile.')
      .addToggle(toggle => toggle.setValue(Platform.isDesktopApp && this.taskPlugin.settings.debugEnabled).setDisabled(!Platform.isDesktopApp).onChange(value => { this.taskPlugin.settings.debugEnabled = value; void this.persist(); if (value) void this.taskPlugin.ensureDebugDirectory(); }));
    new Setting(el).setName('Log directory').setDesc(Platform.isDesktopApp ? `Debug logs are saved in a TaskInNotes subfolder of this directory. Leave empty for ${defaultLogDirectory(true)}. Enter an absolute parent directory.` : 'Local log directories are available on desktop only.')
      .addText(text => { text.setPlaceholder('Default location').setValue(this.taskPlugin.settings.logDirectory).setDisabled(!Platform.isDesktopApp).onChange(value => { this.taskPlugin.settings.logDirectory = value.trim(); void this.persist(); }); text.inputEl.addEventListener('blur', () => { void this.taskPlugin.ensureDebugDirectory(); }); })
      .addButton(button => button.setButtonText('Clear logs').setDisabled(!Platform.isDesktopApp).onClick(() => {
        button.setDisabled(true);
        void this.taskPlugin.clearDebugLogs().then(count => new ConnectionResultModal(this.taskPlugin, 'Debug logs', `Removed ${count} log file${count === 1 ? '' : 's'} from the current TaskInNotes log folder.`).open(), () => new ConnectionResultModal(this.taskPlugin, 'Debug logs', 'Could not clear the logs. Check the log directory and permissions.').open()).finally(() => { button.setDisabled(false); });
      }));
    new Setting(el).setName('Duplicate block IDs').setDesc('Applies to residual duplicates. Complete pasted blocks always receive new IDs.')
      .addDropdown(dropdown => dropdown.addOptions({ ask: 'Ask each time', regenerate: 'Generate a new ID', error: 'Keep block in error' }).setValue(this.taskPlugin.settings.duplicateIdPolicy).onChange(value => {
        this.taskPlugin.settings.duplicateIdPolicy = value as Settings['duplicateIdPolicy']; void this.persist();
      }))
      .addButton(button => button.setButtonText('Reset to ask').onClick(() => { this.taskPlugin.settings.duplicateIdPolicy = 'ask'; void this.persist(); this.display(); }));
  }
}

class TokenModal extends Modal {
  private input?: HTMLInputElement;
  constructor(private plugin: TaskInNotes, private saved: () => void) { super(plugin.app); }
  onOpen() {
    this.plugin.trackDialog(this); this.setTitle('Replace Todoist token');
    // Keep a previously generated plugin-owned key so upgrading does not orphan it.
    const id = /^taskinnotes-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(this.plugin.settings.secretId)
      ? this.plugin.settings.secretId : 'taskinnotes-todoist-token';
    new Setting(this.contentEl).setName('New API token').setDesc('Saved exclusively through Obsidian SecretStorage.')
      .addText(text => { this.input = text.inputEl; text.inputEl.type = 'password'; text.inputEl.autocomplete = 'off'; text.inputEl.setAttribute('aria-label', 'New API token'); });
    new Setting(this.contentEl).addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(button => button.setButtonText('Save token').setCta().onClick(() => {
        if (!this.input?.value.trim()) { new Notice('Enter a new token.'); return; }
        try {
          this.app.secretStorage.setSecret(id, this.input.value.trim()); this.input.value = '';
          this.plugin.settings.secretId = id; this.saved(); this.close();
        } catch { new Notice('SecretStorage could not save the token. Check the secret ID and Obsidian Keychain settings.'); }
      }));
    this.input?.focus();
  }
  onClose() { if (this.input) this.input.value = ''; this.contentEl.replaceChildren(); this.plugin.untrackDialog(this); }
}

class ConnectionResultModal extends Modal {
  constructor(private plugin: TaskInNotes, private heading: string, private message: string) { super(plugin.app); }
  onOpen() {
    this.plugin.trackDialog(this); this.setTitle(this.heading);
    const text = document.createElement('p'); text.setAttribute('role', 'alert'); text.textContent = this.message; this.contentEl.append(text);
    new Setting(this.contentEl).addButton(button => button.setButtonText('OK').setCta().onClick(() => this.close()));
  }
  onClose() { this.contentEl.replaceChildren(); this.plugin.untrackDialog(this); }
}
