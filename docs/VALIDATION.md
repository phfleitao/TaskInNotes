# Validation report

Date: 2026-11-02. Environment: Linux container, Node 24.21.0, npm 11.19.0, installed Google Chrome. No production vault was accessed. An isolated Todoist test account was subsequently used for the real API check below; its token was supplied through non-echoing standard input and was not written to project files.

## Executed checks

| Check | Result | What it proves |
| --- | --- | --- |
| `npm test` | 51 tests passed | Focused core, runtime, React and simulated native-boundary behaviors, including the date picker control |
| `npm run typecheck` | Passed | Strict TypeScript against pinned Obsidian 1.11.4 types |
| `npm run build` | Passed | Production CommonJS bundle; Obsidian remains external |
| `npm run test:e2e` | 6 Chrome flows passed | Production plugin UI/event handlers with test-only Obsidian and Todoist adapters |
| `npm run package` | Passed | Installable folder and ZIP, including dependency license notices |
| Real Todoist test account | Passed | Production client authenticated, queried, created a synthetic Inbox task, completed it and queried again |
| Dedicated Obsidian test vault | Partially verified | Plugin listed as enabled; test note has a generated ID and a successful empty snapshot; settings contain only expected non-secret fields |
| Native Refresh with a matching task | Passed at the Markdown boundary | User triggered Refresh in Obsidian; the note contains the real test task's ID, title, due date, project, filter and fetch time |
| Native creation and completion reconciliation | Passed at the Markdown boundary | User created a dated task and completed it without manual Refresh; the snapshot first contained the task and then contained an empty task list |
| Native Obsidian UI and Todoist | Passed for the scenarios listed | Agent used the official CLI against the running 1.15.0 instance and test vault: Refresh, modal task creation, completion, automatic reconciliation, search and View code |

The E2E server runs on `127.0.0.1:4175` and serves only the harness, bundle and stylesheet. It required sandbox escalation to open a loopback socket and run headless Chrome. npm installation also required approved network access after restricted DNS failed, and packaging required escalation to run zip. The Chrome runner emitted a non-fatal environment warning about `NO_COLOR`/`FORCE_COLOR`.

## Requirement-to-test map

| Functionality | Evidence |
| --- | --- |
| Configuration, schema version, unknown keys, independent generated data | `tests/core/document.test.ts` |
| Full filter text, properties, title, valid/invalid calendar dates, one-pass expansion | `tests/core/document.test.ts` |
| Full snapshot replacement, empty result, CR/LF-safe quoted remote content and unchanged note surroundings | `tests/core/document.test.ts`, browser Refresh flow |
| Safe recovery of damaged final generated YAML; ambiguous input preserved | `tests/core/document.test.ts` |
| No network on startup/render; snapshots never hydrate tasks | `tests/core/controller.test.ts`, `tests/obsidian.test.tsx`, restart browser flow |
| Task/project pagination, looping/incomplete responses, error sanitization | `tests/core/todoist.test.ts` |
| Inbox creation/date and recurring-safe completion endpoint | `tests/core/todoist.test.ts` |
| In-memory generation invalidation, property changes, edits away/back, obsolete queued writes | `tests/core/controller.test.ts`, `tests/core/runtime.test.ts` |
| Local-only repair, no write loop, no resurrection after block removal | `tests/core/controller.test.ts`, `tests/core/runtime.test.ts`, browser repair flow |
| Local write failure and explicit retry without querying | `tests/core/controller.test.ts` |
| Paste UUIDs, multiple pasted blocks, partial/nested content and preserved text | `tests/core/document.test.ts`, native-boundary paste test, browser duplicate flow |
| Duplicate occurrence correction, stale target refusal, no binding to remaining original | `tests/core/runtime.test.ts`, `tests/obsidian.test.tsx` |
| Remembered duplicate choice and no alert on unchanged remount | React duplicate form test and browser duplicate flows |
| Safe remote text, Refresh, creation form and duplicate click prevention | `tests/ui/tasks.test.tsx` |
| Mutation success with failed reconciliation, unknown outcomes, shared completion locks and recurrence | `tests/core/controller.test.ts` |
| Settings whitelist excludes secret values | `tests/settings.test.ts` |

Tests were introduced before their implementation. Regressions were reproduced before fixes, including rapid filter changes, a stale response already queued for writing, duplicate alert remounts and outdated views binding to the original block. See `PROGRESS.md` for the phase record.

An independent read-only code review reproduced three additional issues: an in-flight command unlocked by other-block invalidation, snapshot writes breaking an indented root mapping, and literal-scalar ID replacement consuming a newline. All three were fixed with RED→GREEN regression tests. Related tests also verify locks across controller recreation, retention of unknown-outcome errors after configuration changes, serialization of Refresh behind an active repair, and no automatic repairs of unrendered cached notes. There are no deferred findings from that review.

Browser screenshots of the list and creation modal were captured and visually inspected. They verify the test host layout, not an actual Obsidian theme.

The refreshed interface and native calendar were subsequently inspected in the running Obsidian test vault. A trusted debugger click opened the calendar; Enter selected 2026-11-02, and a synthetic task created through the form appeared with that date. The task was completed through the UI and the debugger detached. The native Obsidian block edit control replaces the former plugin-specific View code button.

## Not executed — native checks still required

The Obsidian executable was not found on PATH. Automated adapters cannot establish native editor/render lifecycle correctness, real SecretStorage guarantees, search behavior or OS integration. Before everyday use, run the following in a disposable vault:

- [ ] Install the packaged plugin in Obsidian 1.11.5+ on Linux Mint.
- [ ] Add/replace/disconnect a test token; remove it through native Keychain. Inspect plugin `data.json` for secret reference and duplicate preference only.
- [ ] Confirm Linux secret-service requirements and restart credential availability.
- [ ] Type a block manually, initialize it, move the cursor out, and verify Reading view and Live Preview. Source mode must expose the YAML.
- [ ] Confirm zero remote calls on render, startup and filter edits; click Refresh to load.
- [ ] Use multiple blocks and split panes. Rename/move a daily note while a collection is pending; verify the right association or safe rejection.
- [ ] Paste complete blocks, Undo and Redo in the real editor. Test residual collisions, cancellation and remembered decisions.
- [ ] Edit surrounding text and the generated subtree during a pending query; verify preserved edits, deferred repair and cursor behavior.
- [ ] Refresh real Todoist filters, including enough tasks/projects for multiple pages and a successful empty result.
- [ ] Create a disposable Inbox task with/without a date, including one outside the block filter. Complete a normal and a recurring test task.
- [ ] Search an exact fetched title with ordinary Obsidian search and navigate to the result. Read the note as raw Markdown.
- [ ] If a real Markdown/MCP reader is available, verify it reads generated task text without a Todoist connector.
- [ ] Check light/dark theme, narrow layout, keyboard focus and native modal behavior.

The initial real API check exercised the production Todoist client directly using Node's HTTPS transport. Subsequently the agent accessed the running Obsidian 1.15.0 instance (installer 1.14.5) through its official Flatpak CLI, explicitly targeting the `TaskInNotesTests` vault. Refresh, task creation and completion worked through the native plugin UI with the configured token; both the rendered list and Markdown snapshot were checked. Obsidian search found the synthetic task in the note, and View code opened a source editor. Both synthetic tasks were completed. Native pagination, recurring tasks, automatic search-result navigation, Android, OS encryption, a real MCP reader and the remaining scenarios above remain pending. The plugin does not promise conflict-free Google Drive synchronization.

## Extended task features

Focused automated tests cover the title, hierarchy including ancestor context and multiple descendant levels, cycle/orphan handling, optional fields, existing personal/shared labels, snapshot metadata and task links. Browser integration covers the expanded form and collapse/expand. In the running test vault, the custom heading, existing label, project, description, date, nested display and expand/collapse were checked. A real Todoist task opened at its direct task URL; a trusted click on the link opened that same task in Chrome. The API priority mapping was verified against the actual P1 filter and the Todoist P1 interface. Synthetic tasks were completed and the synthetic label removed.

## Interface refinements

53 focused automated tests and six browser flows passed, along with production typechecking and packaging. Tests cover the title link, saved sync time after reopening without loading snapshot tasks, and the default and enabled success-message preference. The real Obsidian test vault was refreshed and inspected: the sync tooltip, title links, absence of the old icons, and compact nesting without side borders were confirmed. A native list-item margin was removed after inspecting the rendered layout. The settings toggle itself and hover appearance have not been manually exercised in Obsidian on mobile.

## Task form and priorities

54 automated tests, six browser flows and the production build passed. Focused tests cover restoration of the last-sync footer, priority mapping, the Inbox API flag including a localized name, and multiple selected labels. In the real test vault the refreshed task circles and all four priority flags used distinct theme colors, the footer was visible, and the form showed a single selected Inbox and the native date input. The native form was closed without creating a task. Multiple labels and multiple projects were validated using synthetic browser fixtures; mobile remains untested.

## Modal layout and credentials

57 automated tests and seven browser flows passed, with typechecking and production packaging. A browser regression checks that the date, priority and project controls share a row and that both menus can be clicked beyond a clipped dialog. Focused settings tests check an initially empty password input, reuse of the same token without modifying a pre-existing shared secret, and success and sanitized failure alerts. In the real Obsidian test vault, the form's three controls aligned with matching font sizes and both menus opened fully; a read-only connection test using the configured test account succeeded. The settings alerts were verified in the simulated host, not by interacting with the native settings window. No token was replaced during native validation. Mobile remains untested.

## Debug logging and compact menus

63 automated tests and eight browser flows passed, along with typechecking and production packaging. Tests cover disabled and enabled logging, daily UTC rotation, custom locations, sanitized request metadata, failed writes, timeouts, desktop file append and a simulated mobile vault adapter. Browser checks cover both short unscrolled menus and a longer scrollable label menu, while a focused test confirms labels remain in YAML and are hidden in the task list. In the real Obsidian test vault, both the four-option priority menu and two-option label menu were measured without overflow. An authenticated read-only connection check wrote a sanitized daily file in a disposable custom directory; the debug settings were restored afterwards. Native mobile logging and UI were not tested.

## Local debug logs and cleanup

At the time of this validation, the desktop default was `/tmp/TaskInNotes` on Linux. This was subsequently changed to a user-specific folder under the OS temporary directory; see the current README. Flatpak may isolate temporary directories from the host. The specified directory is a parent for the `TaskInNotes` folder. Local-only logging is disabled on mobile. Tests cover task IDs, actions, server messages with token redaction, selective cleanup and serialization against pending writes. In the real test vault, the title, version and settings rows were measured at the same horizontal coordinate, and an isolated log was created and removed while an unrelated file remained. The compact priority menu was visually checked in Obsidian.

## Reconciliation feedback and Flatpak logs

68 automated tests and eight browser flows passed, along with typechecking and production packaging. A focused UI test holds reconciliation open and verifies that no transient warning or progress message appears with success messages disabled; a subsequent simulated failure still shows an error and reconciliation warning. In the real Obsidian Flatpak test vault, enabling debug created the OS-provided temporary directory visible from the host, and a Refresh created the daily file there. A synthetic Todoist task was created and completed through the block; the request returned 204, the subsequent queries returned 200, and a DOM observer recorded no transient warning or error in that block.

## Automatic reconciliation of blocks in an open note

73 automated tests and nine browser flows passed, along with typechecking and production packaging. Tests cover automatic refresh of a previously unloaded sibling, query failures preserving the previous snapshot, stale in-flight responses, simultaneous commands, and isolation from other or closed notes. In the real Obsidian test vault, a synthetic Todoist task was completed in the first of two blocks; both blocks loaded their results and updated their snapshots without warnings, and the temporary task disappeared from the note. Mobile remains untested.

## Review follow-up: private logs, credential replacement and lifecycle

Focused tests exercise private temporary paths, permissions, symbolic and hard links, unknown mutation outcomes across blocks, preservation of YAML properties following snapshots, stable secret replacement and session release. In the running Linux Flatpak test vault, the current build created its private temporary directory with mode 0700; a read-only Todoist connection succeeded and created the daily log with mode 0600. macOS and Windows filesystem behavior, and native SecretStorage replacement, still require real-platform validation. Legacy unused secrets left by previous versions require manual removal through Obsidian Keychain; the public SecretStorage API exposes no delete method.
