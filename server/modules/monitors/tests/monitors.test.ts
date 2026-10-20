import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { closeConnection, initializeDatabase, monitorsDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { monitorsService } from '@/modules/monitors/monitors.service.js';
import { dispatchMonitors } from '@/modules/monitors/monitors.dispatcher.js';
import { executeMonitorTool } from '@/modules/monitors/monitors.tools.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import { createCompleteMessage } from '@/shared/utils.js';

async function fixture(check:(userId:number)=>Promise<void>|void) {
  const previous=process.env.DATABASE_PATH;
  const dir=await mkdtemp(path.join(tmpdir(),'cloudcli-monitors-'));
  closeConnection();process.env.DATABASE_PATH=path.join(dir,'test.db');await initializeDatabase();
  try {const user=userDb.createUser('monitor-test','hash');sessionsDb.createAppSession('monitor-session','claude',dir,'Monitor test');await check(Number(user.id));}
  finally {chatRunRegistry.clearAll();closeConnection();if(previous===undefined)delete process.env.DATABASE_PATH;else process.env.DATABASE_PATH=previous;await rm(dir,{recursive:true,force:true});}
}
const create=(userId:number)=>monitorsService.create(userId,{sessionId:'monitor-session',name:'test',content:'Read status only',intervalMinutes:1,options:{permissionMode:'default'}});

test('chat tool creates an idempotent persistent task and lists its real status',()=>fixture(user=>{
  const context={userId:user,sessionId:'monitor-session'};
  const args={action:'create',name:'进度检查',content:'只读查看任务进度，有变化才汇报。',intervalMinutes:30};
  executeMonitorTool(context,args);executeMonitorTool(context,args);
  const rows=monitorsDb.list(user,'monitor-session');assert.equal(rows.length,1);assert.equal(rows[0].interval_minutes,30);
  assert.equal(JSON.parse(rows[0].options).permissionMode,'default');
  assert.ok(JSON.stringify(executeMonitorTool(context,{action:'list'})).includes(rows[0].id));
}));
test('chat tool updates frequency and manages pause/resume/stop with retained history',()=>fixture(user=>{
  const context={userId:user,sessionId:'monitor-session'};const row=create(user);
  executeMonitorTool(context,{action:'update',id:row.id,name:'新名称',intervalMinutes:60});
  assert.equal(monitorsDb.get(user,row.id)?.interval_minutes,60);
  executeMonitorTool(context,{action:'pause',id:row.id});assert.equal(monitorsDb.get(user,row.id)?.status,'paused');
  executeMonitorTool(context,{action:'resume',id:row.id});assert.equal(monitorsDb.get(user,row.id)?.status,'active');
  executeMonitorTool(context,{action:'stop',id:row.id});assert.equal(monitorsDb.get(user,row.id)?.status,'stopped');
  assert.ok(JSON.stringify(executeMonitorTool(context,{action:'history',id:row.id})).includes('runs'));
}));
test('monitor creation preserves explicit permissions without silently elevating them',()=>fixture(user=>{
  const context={userId:user,sessionId:'monitor-session',permissionMode:'bypassPermissions'};
  executeMonitorTool(context,{action:'create',name:'Authorized job',content:'Check status',intervalMinutes:30});
  assert.equal(JSON.parse(monitorsDb.list(user)[0].options).permissionMode,'bypassPermissions');
  const row=monitorsService.create(user,{sessionId:'monitor-session',name:'Invalid mode',content:'Check',intervalMinutes:1,options:{permissionMode:'invalid',cwd:'/override',sessionId:'override'}});
  assert.deepEqual(JSON.parse(row.options),{permissionMode:'default'});
}));
test('chat tools cannot cross user/session scope or accept scope overrides',()=>fixture(user=>{
  sessionsDb.createAppSession('other-claude','claude',tmpdir(),'Other');const row=create(user);
  assert.throws(()=>executeMonitorTool({userId:user,sessionId:'other-claude'},{action:'stop',id:row.id}),/当前会话/);
  assert.throws(()=>executeMonitorTool({userId:user+1,sessionId:'monitor-session'},{action:'stop',id:row.id}));
  assert.throws(()=>executeMonitorTool({userId:user,sessionId:'monitor-session'},{action:'list',sessionId:'other-claude'}));
  assert.equal(monitorsDb.get(user,row.id)?.status,'active');
}));
test('scheduled tool context can stop itself but cannot create or broaden jobs',()=>fixture(user=>{
  const row=create(user);const other=create(user);const context={userId:user,sessionId:'monitor-session',monitorId:row.id};
  for(const action of ['create','update','resume','run_now'])assert.throws(()=>executeMonitorTool(context,{action,id:row.id,name:'copy',content:'check',intervalMinutes:1}));
  assert.throws(()=>executeMonitorTool(context,{action:'stop',id:other.id}));
  executeMonitorTool(context,{action:'stop'});assert.equal(monitorsDb.get(user,row.id)?.status,'stopped');assert.equal(monitorsDb.get(user,other.id)?.status,'active');
}));
function runtime(run?:ProviderRuntimeGateway['run'],busy=false):ProviderRuntimeGateway {
  return {hasRuntime:()=>true,hasBackgroundWork:()=>busy,
    run:run??(async(_provider,_command,options,writer)=>{writer.send(createCompleteMessage({provider:'claude',sessionId:String(options.sessionId),exitCode:0}));}),
    abort:async()=>{throw Error('Must not abort current work');},stopBackgroundTask:async()=>false,
    resolveToolApproval:()=>{},getPendingApprovalsForSession:()=>[]};
}
test('recurs after completion with one receipt per execution and catches up once',()=>fixture(async user=>{
  const row=create(user);const rt=runtime();
  assert.equal(await dispatchMonitors(rt,new Date(Date.now()+86400000)),1);
  assert.equal(monitorsDb.get(user,row.id)?.run_count,1);
  assert.equal(await dispatchMonitors(rt),0);
  assert.equal(await dispatchMonitors(rt,new Date(Date.now()+120000)),1);
  assert.deepEqual(monitorsDb.history(user,row.id).map(r=>r.status),['succeeded','succeeded']);
}));
test('busy/background session is deferred without aborting or recording a false run',()=>fixture(async user=>{
  const row=create(user);
  assert.equal(await dispatchMonitors(runtime(undefined,true),new Date(Date.now()+120000)),0);
  assert.equal(monitorsDb.history(user,row.id).length,0);
  assert.match(monitorsDb.get(user,row.id)!.last_error!,/等待/);
}));
test('overlapping polls cannot launch duplicate runs; pause during execution stays paused',()=>fixture(async user=>{
  const row=create(user);let finish!:()=>void;let calls=0;
  const rt=runtime(async(_p,_c,options,writer)=>{calls++;await new Promise<void>(r=>{finish=r;});writer.send(createCompleteMessage({provider:'claude',sessionId:String(options.sessionId),exitCode:0}));});
  const first=dispatchMonitors(rt,new Date(Date.now()+120000));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await dispatchMonitors(rt,new Date(Date.now()+120000)),0);
  monitorsService.action(user,row.id,'pause');finish();await first;
  assert.equal(calls,1);assert.equal(monitorsDb.get(user,row.id)?.status,'paused');
  monitorsService.action(user,row.id,'resume');assert.equal(monitorsDb.get(user,row.id)?.status,'active');
  monitorsService.action(user,row.id,'stop');assert.equal(await dispatchMonitors(runtime(),new Date(Date.now()+120000)),0);
}));
test('event-only failure pauses task and preserves an error receipt',()=>fixture(async user=>{
  const row=create(user);
  await dispatchMonitors(runtime(async(_p,_c,_o,writer)=>{writer.send({kind:'error',content:'provider offline'});writer.send(createCompleteMessage({provider:'claude',exitCode:1}));}),new Date(Date.now()+120000));
  assert.equal(monitorsDb.get(user,row.id)?.status,'paused');
  assert.equal(monitorsDb.history(user,row.id)[0].status,'failed');
  assert.match(monitorsDb.history(user,row.id)[0].error!,/offline/);
}));
test('restart persists idle schedules and pauses unconfirmed runs',()=>fixture(async user=>{
  const row=create(user);const idle=create(user);
  assert.ok(monitorsDb.claim(row.id,new Date(Date.now()+120000)));
  closeConnection();await initializeDatabase();monitorsDb.recover();
  assert.equal(sessionsDb.getSessionById('monitor-session')?.provider_session_id,null);
  assert.equal(monitorsDb.get(user,row.id)?.status,'paused');assert.equal(monitorsDb.history(user,row.id)[0].status,'interrupted');
  assert.equal(monitorsDb.get(user,idle.id)?.status,'active');
}));
test('invalid intervals, archived/non-Claude sessions and foreign ownership are rejected',()=>fixture(user=>{
  for(const intervalMinutes of [0,-1,1.5,10081,'30'])assert.throws(()=>monitorsService.create(user,{sessionId:'monitor-session',name:'test',content:'status',intervalMinutes}));
  const row=create(user);assert.throws(()=>monitorsService.action(user+1,row.id,'stop'));assert.throws(()=>monitorsService.history(user+1,row.id));
  sessionsDb.createAppSession('other','codex',tmpdir(),'Other');assert.throws(()=>monitorsService.create(user,{sessionId:'other',name:'test',content:'status',intervalMinutes:1}));
}));
