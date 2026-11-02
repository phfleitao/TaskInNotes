# Implementation ledger

Plan: TaskInNotes MVP, approved in the chat on 2026-11-02.

## Constraints and rulings

- Ruling: work directly in this empty, user-selected workspace. Git reports no repository and the harness reserves `.git` as read-only; there is no existing branch or worktree to isolate. Git metadata is not needed to build or validate the deliverable.
- No production vault access, real tokens, publication, or remote mutations during automated tests.
- Tests use the production code and substitute only external boundaries.

## Phases

1. Configuration, templates, block location and safe snapshot replacement: pending.
2. Todoist transport, pagination and trusted memory: pending.
3. Obsidian integration, paste and duplicate handling: pending.
4. Creation, completion and UI: pending.
5. Browser flows, review, package and validation report: pending.

## Phase 1–2 checks

- RED: initial parser/document/API tests failed (11 expected missing behaviors).
- GREEN: 11 tests passed after implementation; corrected UUID allocation order while preserving reverse-order edits.
- RED: 8 trusted-state/command tests failed against the unimplemented controller.
- GREEN: all 21 tests passed; TypeScript strict check passed.
- Verified replacement/empty result, safe remote strings, pagination, sanitized failures, stale response rejection, local-only repair, duplicate command prevention, recurring reconciliation and unknown outcomes.
- Dependency installation initially failed under restricted DNS. Approved npm installation completed using a task-local cache in `/tmp`.

## Phase 3–4 checks

- RED→GREEN: note runtime tests for frontmatter changes, duplicate ID repair and edits deferred during source editing.
- RED→GREEN: React tests for manual Refresh, safe text rendering, form validation, duplicate submission prevention and remembered duplicate decisions.
- RED→GREEN: native-boundary tests for processor/event registration and one-transaction paste transformation.
- Added regressions before fixing rapid filter changes away/back and an obsolete snapshot already waiting in the write queue. Writes now recheck the query generation inside the final transaction.
- Strict typecheck/build and full suite are run after each phase; native Obsidian execution remains pending.

## Final review and fixes

- Independent read-only review used a fresh context and reproduced three actionable issues. Each was reproduced locally before correction: cross-block invalidation unlocking an in-flight POST; snapshot serialization losing root indentation; literal-scalar ID replacement consuming the next key's separating newline.
- Corrected all three. Command locks now survive result/configuration invalidation and controller recreation, with successful unchanged-config commands reconciling under a fresh query generation. Unknown outcomes remain visible after filter edits.
- Added and fixed a separate reproduced race where Refresh silently dropped its save behind a pending repair. Snapshot saves now queue and revalidate their exact response at commit time.
- Added and fixed a reproduced scheduler issue: unrendered cached notes could repair on unrelated focus/file events. Automatic repair now requires a rendered block.
- Final checks: 42/42 Vitest tests passed; strict typecheck passed; production build and private ZIP packaging passed; 5/5 Chrome browser flows passed.
- Screenshots of list and creation modal captured and visually inspected in the simulated host. No native UI claim.
- No deferred review findings. No merge, push, release, production-vault installation or real remote mutation was performed.
- Workspace kept in place as requested. No worktree or branch integration applies because Git metadata is unavailable in this empty harness workspace.

## Real Todoist test account

- The user supplied a dedicated test vault and Todoist test account. Installed the existing private plugin files into that test vault and added a test note; native application access was not available to enable the plugin or configure SecretStorage.
- Ran the production Todoist client directly against the real API: authenticated query passed, a synthetic Inbox task was created and completed, and a follow-up query passed. This does not validate Obsidian's native networking, storage or UI.
- The supplied credential was passed via non-echoing standard input, not recorded in project files. The local test vault is ignored by Git.
- The user enabled/configured the plugin and refreshed in the test vault. Inspection confirmed the enabled plugin, a generated block ID and a successful empty snapshot. The plugin settings contain only the expected non-secret fields.
- Created one dated synthetic Inbox task for the user to test Refresh and completion in the native UI. Native UI access remains unavailable to the agent.
- The user triggered another native Refresh. Inspection of the test note confirmed the fetched task ID, title, date and Inbox project in the snapshot.
- The user created and then completed a dated task through the plugin without manually refreshing. The snapshot contained the task after creation and an empty list after completion, confirming automatic reconciliation at the Markdown boundary.
- Located the official CLI in the Obsidian Flatpak and connected to the already running test vault. The agent tested Refresh, creation and completion through the rendered native UI; verified automatic snapshot reconciliation; searched a task title using Obsidian search; and confirmed View code opened a source editor. The synthetic tasks were completed. Native pagination, recurring-task behavior and the remaining checklist remain pending.

## Interface refinement

- Removed the plugin-specific View code button and its handler; source editing is available through Obsidian's own block controls and Source mode.
- Refined the task list, action buttons, filter/project presentation and creation modal using Obsidian theme colors and Todoist-inspired layout.
- Added an explicit native calendar control with a keyboard/focus fallback. RED→GREEN tests cover the new control and the removal of View code.
- Tested the calendar in the running Obsidian test vault: a trusted click opened it, keyboard selection set the date, a synthetic task was created with that date and then completed. The temporary debugger was detached.

## Configurable title and expanded tasks

- Added optional `title` in the block configuration with `Tasks` as the default; validated the heading in the running test vault.
- The creation form loads existing projects and personal/shared labels when opened and supports optional description, date and priority. The test account verified project, synthetic label and description. A real P1 test exposed a contradictory v1 create-field description; corrected the UI-to-API mapping and confirmed P1 via both the Todoist filter and its task interface.
- Added Todoist task links and recursive expand/collapse. The running vault displayed existing nested tasks; a trusted click on the synthetic task's link opened that exact task in Chrome.
- Refresh includes matched tasks, their ancestors for context, and all descendants. The snapshot stores descriptions, label names, API priority and parent IDs when present. Unrelated siblings are excluded unless independently matched.
- Synthetic tasks were completed and the synthetic label was removed. Existing test-account tasks were not modified.
- Validation: 51 focused tests, strict typecheck/build and 6 browser E2E flows passed; native UI/API scenarios above passed. Multi-page hierarchy and mobile remain unverified against a real account.
