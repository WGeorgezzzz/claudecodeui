import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import { api } from '@/shared/api';
import { MonitorPanel } from '@/modules/chat/composer/MonitorPanel';

const response=(data:unknown)=>({ok:true,json:async()=>({data})}) as Response;
afterEach(()=>{cleanup();vi.restoreAllMocks();});
test('new session explains requirement without creating a task',()=>{
  render(<MonitorPanel sessionId={null} draft="" options={{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'定期监测'}));
  assert.ok(screen.getByText(/请先在 Claude/));
  assert.equal(screen.queryByRole('button',{name:'添加监测'}),null);
});
test('creates the requested interval with model and permissions and preserves the draft',async()=>{
  vi.spyOn(api.monitors,'list').mockResolvedValue(response([]));
  const create=vi.spyOn(api.monitors,'create').mockResolvedValue(response({id:'one'}));
  render(<MonitorPanel sessionId="session" draft="只读检查" options={{model:'default',permissionMode:'default'}}/>);
  fireEvent.click(screen.getByRole('button',{name:'定期监测'}));
  fireEvent.change(screen.getByLabelText('监测名称'),{target:{value:'状态'}});
  fireEvent.change(screen.getByLabelText('监测间隔（分钟）'),{target:{value:'5'}});
  fireEvent.click(screen.getByRole('button',{name:'添加监测'}));
  await waitFor(()=>assert.equal(create.mock.calls.length,1));
  assert.deepEqual(create.mock.calls[0][0],{sessionId:'session',name:'状态',content:'只读检查',intervalMinutes:5,options:{model:'default',permissionMode:'default'}});
});
test('pause action is bound to the displayed task and server errors stay visible',async()=>{
  vi.spyOn(api.monitors,'list').mockResolvedValue(response([{id:'task',name:'检查',content:'status',status:'active',interval_minutes:5,next_run_at:new Date().toISOString(),run_count:0,running_id:null,last_error:null}]));
  const action=vi.spyOn(api.monitors,'action').mockResolvedValue({ok:false,json:async()=>({error:{message:'服务不可用'}})} as Response);
  render(<MonitorPanel sessionId="session" draft="" options={{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'定期监测'}));
  fireEvent.click(await screen.findByRole('button',{name:'暂停'}));
  await waitFor(()=>assert.equal(action.mock.calls.length,1));
  assert.deepEqual(action.mock.calls[0],['task','pause']);
  await waitFor(()=>assert.ok(screen.getByRole('alert').textContent?.includes('服务不可用')));
});
