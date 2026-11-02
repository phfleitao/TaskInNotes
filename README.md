# TaskInNotes

**Your tasks, searchable in your notes.**

A private Obsidian plugin that displays Todoist tasks inside Markdown code blocks. A manually refreshed, plain-text `taskSnapshot` makes the results searchable and readable by tools that read your notes.

TaskInNotes is not created by, affiliated with, or supported by Todoist. It is an independent implementation, with no code copied or adapted from other Todoist Obsidian plugins.

## Status and requirements

- Obsidian **1.11.5 or later**, with SecretStorage available.
- Desktop Linux is the primary target. The bundle avoids desktop-only runtime APIs and declares `isDesktopOnly: false`; Android has **not been validated**.
- Manual updates only: no startup queries, periodic refresh, webhooks or vault-wide scan.
- Automated tests exercise real plugin code with simulated Obsidian/Todoist boundaries. See [validation](docs/VALIDATION.md) for exactly what ran and what still needs a real Obsidian installation.

## Build and private installation

Development requires Node 22.12+ and npm. The optional ZIP packaging step requires `zip`.

```sh
npm ci
npm run check
npm run test:e2e
npm run package
```

The production plugin is `manifest.json`, `main.js` and `styles.css`. `npm run package` copies those files and dependency license notices to `dist/taskinnotes/` and creates `dist/taskinnotes-0.1.0.zip`. Test harnesses and development tools are not included.

First install into a **disposable test vault**:

1. Create `.obsidian/plugins/taskinnotes/` in that test vault.
2. Copy the three production files and `THIRD_PARTY_NOTICES.txt` there.
3. Enable community plugins and enable TaskInNotes.
4. Configure credentials and test the flows below.

This project does not install into any vault automatically and does not publish releases. `npm run dev` watches the build in this repository only.

## Credentials

Get a personal API token in Todoist's Integrations → Developer settings. Enter it in Obsidian, never in a note, code block, chat, environment file or source file.

In **Settings → TaskInNotes**:

- **Set token** or **Replace token** accepts a value in a password field; the plugin never displays a saved token. Replacement overwrites the same plugin-managed secret, and the same value can be entered again. Existing plugin-generated IDs are retained on upgrade; an externally managed shared secret is not overwritten.
- **Test connection** makes a read-only request to Todoist and displays the result in a dialog.
- To delete stored values, use **Obsidian Settings → Keychain**. Older versions may have left unused plugin-generated keys; the supported SecretStorage API has no public deletion method. Replacing a stored token does not revoke it at Todoist.

Only the secret's ID and non-secret preferences are saved in the plugin's `data.json`. Tokens are stored exclusively through `app.secretStorage`. Missing or unavailable storage blocks authenticated actions, with no plaintext fallback.

Obsidian documents the secret store as local and scoped to the vault. Do not assume that credentials follow vault file synchronization; configure each device separately. Desktop 1.11.5 documents encryption on disk using operating-system facilities; on Linux this requires kwallet, kwallet5, kwallet6 or gnome-libsecret. TaskInNotes does not implement or independently guarantee encryption or an OS keychain backend.

## Write a block

Use the command **TaskInNotes: Insert TaskInNotes block** for a generated UUID and `today`, or write one manually:

````markdown
```taskinnotes
schemaVersion: 1
filter: "today"
```
````

A manual block without `id` offers **Initialize block**. An existing ID is a string containing letters, numbers, dots, underscores or dashes. Generated IDs are UUIDs. `schemaVersion` defaults to `1` when absent.

The supported configuration keys are `schemaVersion`, `id`, `filter`, optional `title`, and the generated `taskSnapshot`. Set `title: "My tasks"` to customize the heading; it defaults to `Tasks`. Unknown keys, unsupported versions and incorrect types are errors. Use an ordinary YAML block mapping, not a flow mapping, aliases, or multiple YAML documents.

In Live Preview, moving the cursor out of the code block lets Obsidian render its interface. Reading view also renders it. Source mode and Obsidian’s native block edit control expose the Markdown. Rendering and editing do not query Todoist.

### Filters and note inputs

Use Todoist's supported filter expressions, in English:

```yaml
filter: "#Work & p1"
filter: "overdue | today"
filter: "date: {{title}}"
filter: "today | date: {{property:date}} | date: {{title}}"
filter: "#{{title}} & @{{property:label}}"
filter: "{{property:taskinnotes-filter}}"
```

Each example is a separate alternative, not repeated `filter` keys in one block. Expressions containing `: ` need YAML quotes. YAML's `|` multiline syntax is also distinct from Todoist's OR operator; quoting avoids ambiguity.

| Placeholder | Meaning |
| --- | --- |
| `{{title}}` | File name without `.md`, not its first heading |
| `{{property:name}}` | A non-empty, single-line string from top-level YAML frontmatter |
| `{{noteDate}}` | File name strictly validated as a `YYYY-MM-DD` calendar date |

When a placeholder directly follows `date:`, `due:`, `deadline:` or their `before`/`after` forms, its value must also be a valid `YYYY-MM-DD` date. For other operands, title and properties are text fragments in Todoist's language. Missing values and invalid dates never silently fall back to today.

Placeholders expand once; values containing placeholders do not expand recursively. Property names are exact and top-level: `property:project.name` addresses a literal property named `project.name`, not a nested path.

A relative filter such as `today` is evaluated by Todoist at Refresh time using the account's date/time behavior. A date derived from a daily note remains the date in that note. **Changing a filter, a used property or a relevant note title requires Refresh.** Old-filter results are cleared from interactive state; their last snapshot remains until a successful new collection.

TaskInNotes forwards queries to `/tasks/filter`; it does not implement a separate filter engine. The endpoint accepts at most 1024 query characters and does not support multiple result lists separated by commas. A rejected filter produces a sanitized error.

## Refresh, create and complete

**Refresh** fetches every task page and project page needed for a complete result. When there are matching tasks, it also fetches active tasks to include the matching tasks’ ancestors and descendants, allowing nested subtasks to be shown even when their individual dates do not match the filter. Unrelated siblings are excluded. The same normalized response updates the interactive list and replaces the entire `taskSnapshot`. Removed tasks disappear; a successful empty result writes `tasks: []`. Each successful collection records its actual completion time in UTC as `fetchedAt` and its `resolvedFilter`, even when the task values did not change.

A network/API failure preserves the previous snapshot. A local write failure keeps the fetched list usable and offers **Retry snapshot save**, without another remote query or mutation.

**Add task** opens a modal with a required title and optional description, date, priority, project and labels. Use the date field to open the native calendar. Projects and personal/shared labels are loaded from Todoist when the modal opens; select only existing values. The default project is Inbox. A filter does not supply the new task’s project, labels or other fields. Creation is confirmed before success is shown, then the query is reconciled. A task outside the filter is not inserted into its results artificially.

Use the disclosure arrow to expand or collapse subtasks at any level. Select a task title to open it in Todoist in the browser. Hover over Refresh to see the last collection time, including the time recorded in an existing snapshot after reopening the note. The circle beside a task completes it. Recurring tasks may advance to another date and remain visible, according to Todoist's next response. After a confirmed creation or completion, every valid block in the same open note refreshes its own filter automatically, including blocks not previously loaded. A failed query preserves that block's prior snapshot and displays an error; use Refresh to retry. Blocks in other notes are not automatically queried.

Success messages are hidden by default. Enable **Show all messages** in plugin settings to display them; warnings and errors remain visible regardless of this setting.

## Debug logging

**Enable debug logging** is off by default. When enabled, each Todoist API call adds a JSON line with its UTC time, action, relevant task or project IDs, diagnostic message, method, generic endpoint, HTTP status or network/timeout outcome, and duration. Tokens, full request or response bodies and filter queries are not recorded. Server messages may contain account or task details; treat debug logs as private. Files are named `taskinnotes-YYYY-MM-DD.log` and rotate daily in UTC. Logging failures produce a notice and do not interrupt API calls; logging does not retry commands.

On desktop, logs are stored locally in the operating system's temporary directory by default: in a user-specific private subdirectory on Linux and macOS, and under the user's temporary directory on Windows. The actual location is shown in settings. On Unix, folders and log files are restricted to the current user, and linked folders or log files are rejected. The folder is created when logging is enabled (and when the plugin starts with logging enabled); the daily file is created on the first API call. A sandbox such as Flatpak may provide a separate temporary directory. **Log directory** accepts an absolute parent directory and creates a `TaskInNotes` folder within it. **Clear logs** deletes only matching daily files in the currently configured folder, preserving other files and folders. Logs are not automatically deleted. A custom directory can be synchronized or backed up by other software. Local-only debug logging is unavailable on mobile because the public API does not provide a portable local temporary directory.

Repeated clicks are blocked while operations are pending; completion locks are shared across blocks. If a command succeeds but the following query fails, the UI says the command succeeded and requests reconciliation. A timeout or uncertain command outcome is never retried automatically: check Todoist and Refresh before another command.

## Snapshot contract

````markdown
```taskinnotes
schemaVersion: 1
id: "example-stable-id"
filter: "today"

taskSnapshot:
  fetchedAt: "2026-11-02T12:00:00Z"
  resolvedFilter: "today"
  tasks:
    - id: "todoist-task-id"
      title: "Review weekly actions"
      due: "2026-11-02"
      project: "Inbox"
```
````

`due` is the server's explicit date/datetime string or `null`. Optional `description`, `labels`, `priority`, and `parentId` are also stored when present; priority uses Todoist’s API scale (4 is P1, 1 is P4). No automatic timezone conversion is applied to date-only values. Task IDs remain strings for deduplication across overlapping snapshots.

The snapshot is **output only**. Editing or deleting snapshot tasks never creates, modifies, completes or reopens a Todoist task. It never populates the interactive list, including after a restart. Restarting requires an explicit Refresh for that list; the old snapshot stays available to text search and file readers.

If a compatible response still exists in memory, changing or deleting only the snapshot schedules local repair. The plugin compares the generated output and writes only when needed, outside React render effects. Repairs defer while the block is being edited. Failures offer a local retry rather than an infinite retry loop. Removing the entire block removes the integration and never recreates it.

The generated field is last in the block and needs no extra markers. The parser can recover a damaged final indented generated subtree when its boundary and configuration are unambiguous. Broken syntax that could change those boundaries is preserved and shown as an error. Use Obsidian’s block edit control or Source mode to correct it.

## Copy and paste

Pasting complete blocks into the Markdown editor gives each one a new UUID, including plain text copied from Source mode. The paste is one editor transaction. Partial, ambiguous, nested-fence, file attachment and multi-selection pastes use normal editor behavior; residual collisions are handled when rendered.

If IDs collide in a note, the first occurrence keeps its ID. Duplicate occurrences show **Generate new ID** / **Keep block in error**, with **Remember my choice**. The preference applies to future residual collisions and can be reset in settings. Closing the dialog leaves the error. An unchanged duplicate is not repeatedly prompted merely because its view remounts.

While IDs are ambiguous, remote operations and snapshot writes for that ID are blocked. A new ID is written only after the specific occurrence is revalidated against the current text. The plugin never uses an old line number alone to select a write target. Equal IDs in different notes are independent.

## Search, AI readers and privacy

- Snapshots contain ordinary text inside a fenced code block. Use Obsidian's ordinary text search; do not expect `task:` or `task-todo:` to interpret the YAML.
- Search may navigate to/reveal the source instead of the visual list. Validate that behavior in your Obsidian version.
- An AI/MCP reader that reads raw Markdown can read snapshots without a Todoist connector. Whether a particular reader indexes code must be tested with that reader.
- Snapshots cover the matching tasks and their included ancestor/descendant context at collection time, not your entire account or task history. Completed tasks can disappear from open-task queries.
- Task titles, dates, projects and IDs are plain text and follow vault sync/backups. Multi-device changes can conflict; Google Drive is not a conflict-free synchronization protocol for this plugin.
- No telemetry, developer server, remote scripts, iframes or persistent task cache.
- Runtime network allowlist: HTTPS `api.todoist.com`, paths under `/api/v1/tasks/filter`, `/api/v1/projects`, `/api/v1/labels`, `/api/v1/labels/shared`, `/api/v1/tasks`, and `/api/v1/tasks/{id}/close`. Development-only test servers are not part of the installed plugin.

## Tests and development

`npm test` runs focused unit, integration and React interaction tests. `npm run test:e2e` uses installed Google Chrome with a loopback-only, synthetic Obsidian/Todoist test host. It runs the **production plugin**, including its renderer and event handlers; it is not real Obsidian. The test host is under `tests/browser/` and is never packaged.

During development, add a failing behavioral test before implementing/fixing the corresponding behavior, run it to green, and run related regressions at each phase. See [progress](docs/PROGRESS.md), [architecture](docs/ARCHITECTURE.md), [validation and native checklist](docs/VALIDATION.md).

## Future work

Task editing/deletion/reopening, subtask creation, backlinks, opt-in periodic updates and other providers. These are deliberately outside this MVP.
