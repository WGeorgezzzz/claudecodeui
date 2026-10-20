import assert from 'node:assert/strict';

import React, { StrictMode } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { SideChatPanel } from '@/modules/project-workspace/SideChatPanel';
import { api } from '@/shared/api';

vi.mock('@/shared/api', () => ({api: {forkSession: vi.fn(), sessionDetails: vi.fn()}}));
vi.mock('@/modules/chat', () => ({ChatInterface: (props: {
  selectedSession: {id: string}; onReturnReply: (text: string) => void;
}) => <div data-testid="side-session">{props.selectedSession.id}
  <button onClick={() => props.onReturnReply('side answer')}>Return answer</button>
</div>}));

const props = {
  parent: {id: 'parent', summary: 'Main task', __provider: 'claude' as const},
  project: {projectId: 'project', fullPath: '/project', displayName: 'Project'},
  ws: null, sendMessage: vi.fn(), onClose: vi.fn(), onPromote: vi.fn(),
  onReturnReply: vi.fn(), onShowSettings: vi.fn(),
  showThinking: false, showRawParameters: false, sendByCtrlEnter: false,
};
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  vi.mocked(api.forkSession).mockResolvedValue(new Response(JSON.stringify({data:{sessionId:'side',sessionName:'Side'}})));
  vi.mocked(api.sessionDetails).mockResolvedValue(new Response(JSON.stringify({data:{sessionId:'side'}})));
});

test('strict effects create one independent fork; closing does not send an abort', async () => {
  const view=render(<StrictMode><SideChatPanel {...props}/></StrictMode>);
  await waitFor(()=>assert.equal(view.getByTestId('side-session').textContent,'sideReturn answer'));
  assert.equal(vi.mocked(api.forkSession).mock.calls.length,1);
  assert.equal(vi.mocked(api.forkSession).mock.calls[0][0],'parent');
  fireEvent.click(view.getByRole('button',{name:/Close side chat|关闭侧边对话/}));
  assert.equal(props.onClose.mock.calls.length,1);
  assert.equal(props.sendMessage.mock.calls.length,0);
});

test('reopening uses the saved fork and returning a reply only calls the draft callback', async () => {
  localStorage.setItem('cloudcli-side-chat:parent','saved-side');
  const view=render(<SideChatPanel {...props}/>);
  await waitFor(()=>assert.ok(view.getByTestId('side-session').textContent?.startsWith('saved-side')));
  assert.equal(vi.mocked(api.forkSession).mock.calls.length,0);
  fireEvent.click(view.getByRole('button',{name:'Return answer'}));
  assert.deepEqual(props.onReturnReply.mock.calls,[['side answer']]);
  assert.equal(props.sendMessage.mock.calls.length,0);
  fireEvent.click(view.getByRole('button',{name:/Open as main chat|作为主对话打开/}));
  assert.deepEqual(props.onPromote.mock.calls,[['saved-side']]);
});

test('a late fork response cannot replace another parent conversation', async () => {
  let finish!: (response: Response) => void;
  vi.mocked(api.forkSession).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const first=render(<SideChatPanel {...props}/>);
  first.unmount();
  const second=render(<SideChatPanel {...props} parent={{...props.parent,id:'other-parent'}}/>);
  await waitFor(()=>assert.ok(second.getByTestId('side-session')));
  await act(async()=>finish(new Response(JSON.stringify({data:{sessionId:'old-side'}}))));
  assert.ok(second.getByTestId('side-session').textContent?.startsWith('side'));
  assert.equal(localStorage.getItem('cloudcli-side-chat:parent'),'old-side');
});

test('fork failures remain visible and do not submit a question to the main chat', async () => {
  vi.mocked(api.forkSession).mockResolvedValue(new Response(JSON.stringify({error:{message:'Transcript not ready'}}),{status:409}));
  const view=render(<SideChatPanel {...props}/>);
  await waitFor(()=>assert.match(view.getByRole('alert').textContent || '',/Transcript not ready/));
  assert.equal(view.queryByTestId('side-session'),null);
  assert.equal(props.sendMessage.mock.calls.length,0);
});
