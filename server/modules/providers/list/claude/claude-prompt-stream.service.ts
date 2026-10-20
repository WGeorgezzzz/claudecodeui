import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/** Used by the Claude provider to submit additional turns without closing the live CLI's stdin. */
export function createHeldPromptStream(messages: SDKUserMessage[]) {
  const queue = [...messages];
  let open = true;
  let wake: (() => void) | undefined;
  const stream = (async function* () {
    while (open || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        await new Promise<void>((resolve) => { wake = resolve; });
        wake = undefined;
      }
    }
  })();
  return {
    stream,
    isOpen: () => open,
    push(next: SDKUserMessage[]) {
      if (!open) throw new Error('The Claude input stream has closed; retry after the session settles.');
      queue.push(...next);
      wake?.();
    },
    release() {
      open = false;
      wake?.();
    },
  };
}
