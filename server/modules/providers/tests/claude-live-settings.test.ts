import assert from 'node:assert/strict';
import test from 'node:test';

import { applyLiveClaudeSettings } from '@/modules/providers/list/claude/claude-live-settings.service.js';

test('live controls change model, effort and permissions without creating a new process', async () => {
  const calls: unknown[] = [];
  const controls = {
    setModel: async (value?: string) => {calls.push(['model',value]);},
    applyFlagSettings: async (value: Record<string, unknown>) => {calls.push(['settings',value]);},
    setPermissionMode: async (value: string) => {calls.push(['mode',value]);},
  };
  const current = {model:'old-model',effort:'medium',permissionMode:'default'};
  const next = {model:'new-model',effort:'high',permissionMode:'plan'};
  await applyLiveClaudeSettings(controls,current,next,'high',mode=>calls.push(['ack',mode]));
  assert.deepEqual(current,next);
  assert.deepEqual(calls,[['model','new-model'],['settings',{effortLevel:'high',ultracode:false}],['mode','plan'],['ack','plan']]);
  await applyLiveClaudeSettings(controls,current,next,'high',()=>assert.fail('unchanged mode'));
  assert.equal(calls.length,4);
});

test('unsupported controls reject before any setting is changed', async () => {
  let modelChanges = 0;
  const current = {model:'a',permissionMode:'default'};
  await assert.rejects(applyLiveClaudeSettings({setModel:async()=>{modelChanges++;}},current,
    {model:'b',permissionMode:'plan'},undefined,()=>{}),/cannot change/);
  assert.equal(modelChanges,0);
  assert.equal(current.model,'a');
});

test('a rejected permission change does not change the approval callback state', async () => {
  const current = {permissionMode:'default'};
  await assert.rejects(applyLiveClaudeSettings({setPermissionMode:async()=>{throw Error('denied');}},current,
    {permissionMode:'bypassPermissions'},undefined,()=>assert.fail('unacknowledged mode')),/denied/);
  assert.equal(current.permissionMode,'default');
});
