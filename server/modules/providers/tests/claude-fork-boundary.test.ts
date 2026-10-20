import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeForkProvider } from '@/modules/providers/list/claude/claude-fork.provider.js';

test('side snapshots stop at the last completed parent reply despite active or partial trailing records',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'claude-fork-boundary-'));
  try {
    const transcript=path.join(root,'session.jsonl');
    const lines=[
      {type:'assistant',uuid:'completed-parent',message:{stop_reason:'end_turn'}},
      {type:'assistant',uuid:'active-tool',message:{stop_reason:'tool_use'}},
      {type:'assistant',uuid:'child-reply',isSidechain:true,message:{stop_reason:'end_turn'}},
    ].map(row=>JSON.stringify(row)).join('\n')+'\n{"type":"assistant"';
    await writeFile(transcript,lines);
    assert.equal(await new ClaudeForkProvider().getCompletedAnchor(transcript),'completed-parent');
    await writeFile(transcript,JSON.stringify({type:'assistant',uuid:'unfinished',message:{stop_reason:'tool_use'}}));
    assert.equal(await new ClaudeForkProvider().getCompletedAnchor(transcript),null);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    await rm(root,{recursive:true,force:true});
  }
});
