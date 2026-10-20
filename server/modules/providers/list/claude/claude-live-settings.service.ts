type LiveSettings = { model?: string; effort?: string; permissionMode?: string };
type LiveControls = {
  setModel?: (model?: string) => Promise<void>;
  setPermissionMode?: (mode: string) => Promise<void>;
  applyFlagSettings?: (settings: Record<string, unknown>) => Promise<void>;
};

/** Used by the Claude runtime to update the live process before submitting another prompt, without replacing background work. */
export async function applyLiveClaudeSettings(
  controls: LiveControls,
  current: LiveSettings,
  next: LiveSettings,
  resolvedEffort: string | undefined,
  onPermissionChanged: (mode: string) => void,
): Promise<void> {
  const modelChanged = next.model !== undefined && next.model !== current.model;
  const effortChanged = next.effort !== undefined && (next.effort !== current.effort || modelChanged);
  const modeChanged = next.permissionMode !== undefined && next.permissionMode !== current.permissionMode;
  // Check all capabilities first so an older CLI cannot partially apply a request.
  if ((modelChanged && !controls.setModel) || (effortChanged && !controls.applyFlagSettings)
    || (modeChanged && !controls.setPermissionMode)) {
    throw new Error('This Claude runtime cannot change these settings while background work is active. Existing tasks are still running.');
  }
  if (modelChanged) {
    await controls.setModel!(next.model || undefined);
    current.model = next.model;
  }
  if (effortChanged) {
    await controls.applyFlagSettings!({
      effortLevel: resolvedEffort === 'ultracode' ? 'xhigh' : resolvedEffort ?? null,
      ultracode: resolvedEffort === 'ultracode',
      ...(resolvedEffort === 'ultracode' ? {enableWorkflows: true} : {}),
    });
    current.effort = next.effort;
  }
  if (modeChanged) {
    await controls.setPermissionMode!(next.permissionMode!);
    current.permissionMode = next.permissionMode;
    // Keep the provider's approval callback in step with the acknowledged mode.
    onPermissionChanged(next.permissionMode!);
  }
}
