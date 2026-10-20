# Fork validation — 2026-10-20

## Workbench lifecycle and independent installer

The server-managed side conversations, durable FIFO queue and independent
Windows distribution were validated at source `2c01657098828fee16d4bee3d6b06c8725114797`.
The later 0.1.1 patch fixes inherited-history display boundaries and refuses to
reuse an older Workbench backend that still owns the installation profile.

| Check | Observed result |
| --- | --- |
| Clean Windows CI frontend suite | 118 files, 802 tests passed |
| Clean Windows CI lifecycle suite | 15 passed |
| Clean Windows CI profile suite | 3 passed |
| Local full backend suite | 761 cases: 745 passed, 10 failed, 6 skipped |
| Unmodified upstream failure comparison | Same 10 failures; no new failures in the comparison |
| Installed 0.1.0 package on Windows CI | Authenticated API, frontend assets, own profile and sentinel isolation passed |
| Bundled Claude executable | Executed successfully; version 2.1.302 |
| 0.1.1 local side-chat regression suite | 6 passed |
| 0.1.1 local profile regression suite | 4 passed |
| 0.1.1 TypeScript and production builds | Passed |
| 0.1.1 browser inherited-context check | New side history folds, expands fully and folds again |

The initial build is recorded in
[Windows CI run 39411945055](https://github.com/WGeorgezzzz/claudecodeui/actions/runs/39411945055).
Version 0.1.1 receives a separate clean Windows build and installed acceptance
before its workflow publishes the release; its attached `installer-smoke.json`
records the packaged version. The 0.1.0 release and assets remain preserved.

Real Claude runs in an isolated test workspace verified two queued messages
executing in FIFO order with the client socket closed, duplicate POST delivery
producing one execution, independent side replies, multiple side conversations,
rename/archive/restore/promotion, and a pending message completing after explicit
resolution of an interrupted attempt. The crash-recovery boundary used an
offline unconfirmed-attempt fixture followed by an actual test-service restart;
it did not kill a live model request. The interrupted execution receipt remains
retained after cancellation, and no automatic replay occurred.

Browser acceptance discovered that the SDK rewrites the copied final reply's
timestamp. Version 0.1.1 records the fold boundary after the copy completes.
Existing side records without that reliable boundary display their full history.
The final fold check used another port and a database snapshot after automatic
approval rejected a test-service restart. The original client on port 3001 was
not restarted or deployed to. Packaging acceptance does not establish model
account setup, hosted cloud connectivity, or support for other operating systems.

## Side-chat and visual update

The subsequent frontend update adds a separate side conversation and a neutral
desktop visual treatment. Frontend validation: **117 files, 796 tests passed**;
TypeScript and production build passed. The large-bundle warning remains.
No backend implementation changed in this update; the earlier backend failures
below remain disclosed.

Live browser acceptance against an isolated service verified:

- Side conversation receives the parent's saved context and has a different session ID.
- Main and side submissions complete with their own reply markers; neither new
  message appears in the other's persisted transcript.
- Closing immediately after sending leaves the side run alive. Reopening shows
  the completed answer in the same side session.
- Returning an answer fills the main draft without sending it.
- `/side <question>` clears the main command draft and prepares the question in
  the side composer without submitting it to the main task.
- Strict-mode effects create one fork; failed creation stays visible; late
  responses cannot replace another parent's panel.

The browser association is stored locally. The server-side conversation is
persistent and shares project files; this is not a separate worktree or an
automatically deleted ephemeral session.

## Initial fork validation

Baseline: upstream `0ce5630f` (`v1.37.5`). Platform: Windows, Node.js 24.18.0.
Validation used the existing local dependency cache. A clean dependency install,
Linux/macOS acceptance and signed desktop packaging were not performed.

## Results

| Check | Observed result |
| --- | --- |
| Frontend full suite | 116 files, 791 tests passed |
| Frontend TypeScript check | Passed |
| Backend TypeScript build and alias resolution | Passed |
| Production frontend build | Passed; existing large-chunk warning remains |
| Full backend suite before the final teardown regression addition | 743 cases: 727 passed, 10 failed, 6 skipped |
| Final targeted backend suite, including the added teardown regression | 56 cases: 54 passed, 0 failed, 2 skipped |
| Unmodified upstream comparison for failing backend modules | 56 cases: 46 passed, the same 10 failed |
| Lint | Exit 0; 0 errors, 164 warnings remain |
| Staged patch whitespace check | Passed |
| Real Claude request and immediate next request | Both returned the requested assistant text; two successful completion events, no error event |
| Monitor API | Create, pause, update, stop and history read passed |
| Real scheduled model execution with browser closed | Succeeded; receipt retained; test schedule then stopped |
| Browser UI | Chat and files stay visible together; keyboard divider changes 50% to 55%; HTML opens in preview |
| Installed Windows shell, using the resize fix ported here | Maximize and restore visually passed; expected and actual content bounds matched |

The final targeted suite covers monitor lifecycle and permission preservation,
Claude authentication in a custom configuration directory, runtime ownership and
background continuation, ordinary process teardown, and terminal startup/input.
The two skipped checks require POSIX shell behavior. Counts from separate runs
are not added together.

## Failures retained

The ten full-suite failures reproduce on the unchanged upstream checkout in the
same environment:

- Agent API continuation: two cases compare POSIX fixture paths against Windows-resolved paths.
- Agent API unregistered-provider continuation: one related fixture-path case.
- Project database creation: one path-normalization expectation.
- File-tree access: two Windows path/symlink cases.
- Untracked-file branch diff: one slash-direction expectation.
- Project conflict reporting: one path-format expectation.
- Read-only roots: two symbolic-link creations return Windows `EPERM`.

These cases remain in the suite. This release does **not** claim an entirely
passing backend suite.

Earlier test attempts also exposed and retained:

- A configuration-directory relative-path regression, fixed by accepting only
  absolute overrides and restoring the default otherwise.
- Authentication fixtures that changed `HOME` but did not isolate Windows
  `os.homedir()`. Fixtures now use the explicit configuration directory.
- A terminal fixture whose reconnect timer kept the test process alive. The
  fixture now emits process exit during cleanup.
- A real immediate-continuation rejection while the prior SDK process was
  closing. The runtime now waits for that owner to settle before resuming;
  a scripted regression and a second real two-turn run passed.

The first two all-backend attempts did not terminate because of the terminal
fixture timer. The completed 743-case run above follows that correction. A later
full-suite rerun was interrupted without a final receipt and is not counted as
passing. The final runtime change is covered by the completed targeted suite and
the real two-turn run.

## Reproduction

```sh
npm ci
npm run test:client
npm test
npm run typecheck
npm run build
npm run lint
```

Use a fresh `DATABASE_PATH` and a dedicated test workspace for live testing.
Keep API credentials, session transcripts, databases and local logs outside Git.
The published changes contain source, tests and documentation only; local
credentials, provider wrappers, conversation histories and raw live logs are
excluded.
