import assert from 'node:assert/strict';

import React, { StrictMode } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { SideChatPanel } from '@/modules/project-workspace/SideChatPanel';
import { api } from '@/shared/api';
import type { SideConversation } from '@/shared/types';

const {records}=vi.hoisted(()=>({records:new Map<string,SideConversation[]>()}));
vi.mock('@/shared/api',()=>({
  api:{sideChats:{list:vi.fn(),create:vi.fn(),adopt:vi.fn(),update:vi.fn()}},
  readApiErrorMessage:(body:{error?:{message?:string}})=>body.error?.message,
}));
vi.mock('@/modules/chat',()=>({ChatInterface:(props:{
  selectedSession:{id:string};onReturnReply:(text:string)=>void;
})=><div data-testid="side-session">{props.selectedSession.id}
  <button onClick={()=>props.onReturnReply('side answer')}>Return answer</button>
</div>}));
const response=(data:unknown)=>new Response(JSON.stringify({data}));
const row=(parent='parent',child='child-parent-1'):SideConversation=>({
  id:`managed-${child}`,parent_session_id:parent,child_session_id:child,title:child,status:'active',
  context_cutoff:'2026-01-01T00:00:00Z',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',error:null,
});
const props={
  parent:{id:'parent',summary:'Main task',__provider:'claude' as const},
  project:{projectId:'project',fullPath:'/project',displayName:'Project'},
  ws:null,sendMessage:vi.fn(),onClose:vi.fn(),onPromote:vi.fn(),onReturnReply:vi.fn(),onShowSettings:vi.fn(),
  showThinking:false,showRawParameters:false,sendByCtrlEnter:false,
};
beforeEach(()=>{
  localStorage.clear();records.clear();vi.clearAllMocks();
  vi.mocked(api.sideChats.list).mockReset().mockImplementation(async id=>response(records.get(id)||[]));
  vi.mocked(api.sideChats.create).mockReset().mockImplementation(async input=>{
    const existing=records.get(input.parentSessionId)||[];
    const created={...row(input.parentSessionId,`child-${input.parentSessionId}-${existing.length+1}`),title:input.title};
    records.set(input.parentSessionId,[...existing,created]);return response(created);
  });
  vi.mocked(api.sideChats.adopt).mockReset().mockImplementation(async(parent,child)=>{
    const imported=row(parent,child);records.set(parent,[imported]);return response(imported);
  });
  vi.mocked(api.sideChats.update).mockReset().mockImplementation(async(id,body)=>{
    const found=[...records.values()].flat().find(value=>value.id===id)!;
    if(body.title)found.title=body.title;
    if(body.action)found.status=body.action==='archive'?'archived':body.action==='restore'?'active':'promoted';
    return response(found);
  });
});

test('strict effects create one independent child; closing does not send an abort',async()=>{
  const view=render(<StrictMode><SideChatPanel {...props}/></StrictMode>);
  await waitFor(()=>assert.ok(view.getByTestId('side-session').textContent?.startsWith('child-parent-1')));
  assert.equal(vi.mocked(api.sideChats.create).mock.calls.length,1);
  fireEvent.click(view.getByRole('button',{name:/Close side chat|关闭侧边对话/}));
  assert.equal(props.onClose.mock.calls.length,1);assert.equal(props.sendMessage.mock.calls.length,0);
});

test('verified legacy mapping is imported once and replies only reach the main draft callback',async()=>{
  localStorage.setItem('cloudcli-side-chat:parent','saved-side');
  const view=render(<SideChatPanel {...props}/>);
  await waitFor(()=>assert.ok(view.getByTestId('side-session').textContent?.startsWith('saved-side')));
  assert.equal(vi.mocked(api.sideChats.create).mock.calls.length,0);
  assert.equal(localStorage.getItem('cloudcli-side-chat:parent'),null);
  fireEvent.click(view.getByRole('button',{name:'Return answer'}));
  assert.deepEqual(props.onReturnReply.mock.calls,[['side answer']]);
  fireEvent.click(view.getByRole('button',{name:/Open as main chat|作为主对话打开/}));
  await waitFor(()=>assert.deepEqual(props.onPromote.mock.calls,[['saved-side']]));
  assert.equal(records.get('parent')?.[0].status,'promoted');
  assert.equal(props.sendMessage.mock.calls.length,0);
});

test('a late creation response cannot replace another parent conversation',async()=>{
  let finish!:()=>void;
  vi.mocked(api.sideChats.create).mockImplementationOnce(input=>new Promise(resolve=>{
    finish=()=>{const value=row(input.parentSessionId,'old-side');records.set(input.parentSessionId,[value]);resolve(response(value));};
  }));
  const first=render(<SideChatPanel {...props}/>);
  await waitFor(()=>assert.ok(finish));
  first.unmount();
  const second=render(<SideChatPanel {...props} parent={{...props.parent,id:'other-parent'}}/>);
  await waitFor(()=>assert.ok(second.getByTestId('side-session')));
  await act(async()=>finish());
  assert.ok(second.getByTestId('side-session').textContent?.startsWith('child-other-parent-1'));
  assert.equal(records.get('parent')?.[0].child_session_id,'old-side');
});

test('creation errors remain visible and never submit a question to the parent',async()=>{
  vi.mocked(api.sideChats.create).mockResolvedValue(new Response(JSON.stringify({error:{message:'Transcript not ready'}}),{status:409}));
  const view=render(<SideChatPanel {...props}/>);
  await waitFor(()=>assert.match(view.getByRole('alert').textContent||'',/Transcript not ready/));
  assert.equal(view.queryByTestId('side-session'),null);assert.equal(props.sendMessage.mock.calls.length,0);
});

test('multiple server-owned conversations can be selected, archived and restored',async()=>{
  records.set('parent',[row('parent','first'),row('parent','second')]);
  const view=render(<SideChatPanel {...props}/>);
  await waitFor(()=>assert.ok(view.getByTestId('side-session').textContent?.startsWith('second')));
  assert.equal(vi.mocked(api.sideChats.create).mock.calls.length,0,'a new browser reads the server relationship');
  fireEvent.change(view.getByRole('combobox'),{target:{value:'managed-first'}});
  assert.ok(view.getByTestId('side-session').textContent?.startsWith('first'));
  fireEvent.click(view.getByRole('button',{name:/Archive side conversation|归档侧边会话/}));
  await waitFor(()=>assert.equal(records.get('parent')?.[0].status,'archived'));
  fireEvent.click(view.getByText(/Archived and past|已归档与历史/));
  fireEvent.click(view.getByRole('button',{name:/Restore side conversation|恢复侧边会话/}));
  await waitFor(()=>assert.equal(records.get('parent')?.[0].status,'active'));
  assert.equal(props.sendMessage.mock.calls.length,0);
});
