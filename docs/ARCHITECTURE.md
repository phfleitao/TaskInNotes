# Architecture

## Two outputs, one response

`TodoistClient` implements the small `TaskProvider` interface (`query`, `create`, `complete`). It normalizes a complete paginated collection into `Task[]`, including ancestor context and descendants of matching tasks. Project and personal/shared label choices are loaded only when the creation modal opens. `TaskController` turns that response into trusted in-memory state and a serializable `Snapshot`. Neither the controller nor the UI consumes task data from the Markdown snapshot.

Optional diagnostics record allowlisted endpoint patterns, action, relevant task/project IDs, sanitized server messages, status, method, elapsed time and UTC timestamp. Tokens are redacted, and full bodies and filter queries are not logged. Writes and explicit deletion are serialized and isolated from remote operations. Desktop logging uses a user-specific folder under the OS temporary directory by default; local-only logging is disabled on mobile. Logging is disabled by default, and server messages and IDs can contain private data.

The parser returns configuration and source ranges, never snapshot tasks. YAML parsing can inspect structure to locate the generated field, but does not deserialize it into interactive state. After reload, controllers are empty until an explicit command starts a query.

## Responsibilities

- `core/config`: strict configuration, single-pass template resolution and date validation.
- `core/document`: fenced-block scanning, safe identity lookup, minimal ID changes and complete snapshot replacement.
- `core/todoist`: fixed official endpoints, authentication, cursor pagination, response validation and sanitized errors.
- `core/controller`: trusted state, pending commands, shared task locks, reconciliation and generation guards.
- `core/runtime`: one note's current configuration, controller identity and serialized writes through an injected note port.
- `main` / `settings`: public Obsidian APIs, editor/file adapters, lifecycle, native secret settings, modal shells, paste and collision decisions.
- `ui/TaskBlock`: theme-aware React task list and forms, with no network or persistence in render effects.

The provider interface leaves room for future implementations without adding a provider registry or other-provider configuration to this MVP.

## Identity and concurrency

A note runtime belongs to the actual `TFile`, not a stale path. Its lifetime key plus the block ID defines an integration. Multiple views share that controller; equal filters and IDs in other files never share its trusted state. Rename/move changes the same file object, and relevant title templates are resolved again.

After a confirmed mutation, valid controllers in the same open note schedule their own filtered refresh. They invalidate in-flight results, defer while a command is locked, and avoid retrying failed queries or mutations. Other notes remain invalidated without automatic requests. Per-note serialized snapshot writes and generation checks still apply to every collection.

Editor changes immediately observe configuration changes, before debounced rendering/repair. Every controller has a generation that changes on configuration invalidation, including changes away and back. Responses check that generation and the current note/filter before updating memory. The same guard is checked again inside the eventual write transaction, covering responses already queued for persistence.

Writes are serialized per note and read current contents at commit time. Open source/Live Preview editors use a small `Editor.transaction`; otherwise the adapter uses `Vault.process`. Multiple open editor buffers that disagree block writing instead of choosing one silently. A selection inside a block defers generated writes. File deletion and plugin unload invalidate controllers and queued work.

Collision decisions use fresh section metadata and source validation. A rendered duplicate whose ID was replaced cannot attach itself to the remaining original's controller. Notification suppression is in memory and does not serve as write identity; remembered policy is the only duplicate preference persisted.

## Failure boundaries

Task/project pagination must fully succeed before a collection is accepted. API failure leaves old output intact. Persistence failure does not roll back a valid collection. Confirmed commands and reconciliation have separate outcomes. Unknown POST outcomes block further commands in that controller until manual Refresh; commands are never automatically retried.

Automatic repair is local-only, requires compatible non-stale memory, compares output, and runs outside React. The scheduler does not retry failed saves indefinitely; explicit Retry is available. Configuration/snapshot separation is conservative when YAML is ambiguous.

## Official decisions and sources

Checked on 2026-11-02:

- [Obsidian API](https://github.com/obsidianmd/obsidian-api): compile against the pinned 1.11.4 package rather than using newer public methods accidentally. Runtime minimum is 1.11.5.
- [Desktop 1.11.5](https://obsidian.md/changelog/2026-01-20-desktop-v1.11.5/): encrypted-on-disk Secret Storage and listed Linux service prerequisites. This is Obsidian's guarantee, not a plugin-created cryptography layer.
- [Secret storage guide](https://docs.obsidian.md/plugins/guides/secret-storage): `SecretComponent`, secret-ID references and local vault scope. Deletion stays in native Keychain management because the baseline public API has no delete method.
- [Vault API guide](https://docs.obsidian.md/Plugins/Vault): atomic `Vault.process` instead of stale read/modify writes.
- [Todoist API v1](https://developer.todoist.com/api/v1/): personal bearer authentication, filter cursor pagination, Inbox default creation, explicit `due_date`, and `close` semantics for recurring tasks.
- [Todoist October 2026 changelog](https://www.todoist.com/help/todoist/product-updates/2026-changelog-HD3jJAtLd): expanded subtask previews in list filters. Ancestor context and expanded descendants may not independently match the filter and are included in snapshots.
- [Filter language](https://www.todoist.com/help/todoist/features/introduction-to-filters-V98wIH): relative/fixed-date filters. The plugin uses English query language and makes API limitations visible.

Production runtime dependencies are React, React DOM and YAML. Obsidian is external to the bundle; tests, browser automation and the test server are development-only.

## Priority mapping

The creation UI maps Todoist P1–P4 to API values 4–1. The Todoist v1 create-field documentation disagreed with its underlying priority description; a real test account confirmed that API value 4 appears as P1 in Todoist.
