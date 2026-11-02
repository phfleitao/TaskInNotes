export interface ApiDiagnostic { method: 'GET' | 'POST'; endpoint: string; status: number | 'timeout' | 'network_error'; durationMs: number; action: string; message: string; taskId?: string; projectId?: string }
export type LogWriter = (directory: string, filename: string, line: string) => Promise<void>;

/** Serializes writes without delaying or changing the result of remote requests. */
export class DebugLogger {
  private queue: Promise<void> = Promise.resolve();
  private warned = false;
  constructor(private settings: () => {debugEnabled: boolean; logDirectory: string}, private write: LogWriter, private onError: () => void, private now = () => new Date()) {}
  record(event: ApiDiagnostic) {
    const settings = this.settings();
    if (!settings.debugEnabled) return;
    const time = this.now().toISOString();
    const filename = `taskinnotes-${time.slice(0, 10)}.log`;
    const line = JSON.stringify({ time, ...event }) + '\n';
    const directory = settings.logDirectory;
    this.queue = this.queue.then(async () => {
      try { await this.write(directory, filename, line); this.warned = false; }
      catch { if (!this.warned) { this.warned = true; this.onError(); } }
    });
  }
  async flush() { await this.queue; }
  clear(remove: () => Promise<number>): Promise<number> {
    const operation = this.queue.then(remove);
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }
}
