# Fork validation — 2026-10-20

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
