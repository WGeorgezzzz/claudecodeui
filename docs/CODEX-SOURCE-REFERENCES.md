# Codex source references

Reviewed `openai/codex` at commit
`e18a20d6eb6f5ede32a69fb56e3fe276d5e9d914`.
Its root license is Apache-2.0. The implementation in this fork is a TypeScript
adaptation of the following lifecycle ideas; it does not embed the Codex desktop
UI, replace Claude's SDK, or claim protocol compatibility.

| Reviewed source | Design used here |
| --- | --- |
| [Thread protocol](https://github.com/openai/codex/blob/e18a20d6eb6f5ede32a69fb56e3fe276d5e9d914/codex-rs/app-server-protocol/src/protocol/v2/thread.rs) | Explicit fork identity and server-owned conversation relationships; `QueuedSubmission`, `ThreadQueueAddParams`, and `client_user_message_id` inform durable request identity |
| [Turn protocol](https://github.com/openai/codex/blob/e18a20d6eb6f5ede32a69fb56e3fe276d5e9d914/codex-rs/app-server-protocol/src/protocol/v2/turn.rs) | Identity preconditions such as `expected_turn_id`; this fork uses queue revisions and attempt IDs to reject stale operations |
| [Turn state](https://github.com/openai/codex/blob/e18a20d6eb6f5ede32a69fb56e3fe276d5e9d914/codex-rs/core/src/state/turn.rs) | Distinguish active work, pending input and work that belongs to the next turn; late events must not complete a newer owner |
| [Session state](https://github.com/openai/codex/blob/e18a20d6eb6f5ede32a69fb56e3fe276d5e9d914/codex-rs/core/src/state/session.rs) | Separate persistent conversation state from live execution state |

The public [App Server documentation](https://learn.chatgpt.com/docs/app-server)
was also checked for thread/fork and turn lifecycle semantics.

Side forks stop at the most recent completed top-level Claude reply
(`stop_reason: end_turn`), so an unfinished tool exchange is not replayed in the
child. This fork chooses persistent side conversations rather than Codex's optional
in-memory ephemeral forks. It adds SQLite FIFO receipts and explicit recovery
for its Claude-backed runtime. Queueing starts a later turn; it is not an
implementation of Codex `turn/steer`. Model completion, background work and
installer acceptance remain separate outcomes.

The initial development cache contained Claude Agent SDK `0.3.302` while the
inherited lockfile specified `0.3.165`. The standalone distribution now locks
`0.3.302` and Zod `4.6.7`, matching the inspected SDK surface. Its CI build installs
from the lockfile in a clean Windows environment; no shared local dependency
directory is updated as part of this change.
