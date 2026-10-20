import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { loadWorkbenchProfile, ensureWorkbenchIdentity, buildWorkbenchServerEnvironment } from '../workbenchProfile.js';
import { LocalServerController } from '../localServer.js';

test('standalone profile has independent identity and ignores stale service overrides',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-profile-'));
  try {
    const id=await ensureWorkbenchIdentity(root);
    assert.equal(await ensureWorkbenchIdentity(root),id);
    const env=buildWorkbenchServerEnvironment({userDataPath:root,instanceId:id,port:3016,inherited:{
      DATABASE_PATH:'old.db',CLOUDCLI_HOME:'old-home',SERVER_PORT:'3001',PORT:'3001',
      CLAUDE_CONFIG_DIR:'old-claude',CLAUDE_CLI_PATH:'old-cli',
      ELECTRON_SERVER_ENTRY:'old-server',ELECTRON_NODE_PATH:'old-node',
      ELECTRON_LOCAL_SERVER_URL:'http://127.0.0.1:3001',CLOUDCLI_LOCAL_SERVER_URL:'http://127.0.0.1:3001',
      Path:'original-system-path',Database_Path:'wrong-case.db',NODE_OPTIONS:'--require old-runtime',
    }});
    assert.equal(env.SERVER_PORT,'3016');assert.equal(env.CLOUDCLI_INSTANCE_ID,id);
    assert.equal(env.DATABASE_PATH,path.join(root,'server','auth.db'));
    assert.equal(env.CLAUDE_CONFIG_DIR,path.join(root,'providers','claude'));
    assert.equal(env.PATH,'original-system-path');assert.equal(env.Path,undefined);
    assert.equal(env.Database_Path,undefined);assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.NODE_ENV,'production');
    for(const name of ['ELECTRON_SERVER_ENTRY','ELECTRON_NODE_PATH','CLOUDCLI_LOCAL_SERVER_URL','PORT','CLAUDE_CLI_PATH'])assert.equal(env[name],undefined);
    const configured=buildWorkbenchServerEnvironment({userDataPath:root,instanceId:id,port:3016,
      settings:{claudeConfigDir:path.join(root,'chosen-config'),claudeCliPath:path.join(root,'chosen-cli.js')},inherited:{}});
    assert.equal(configured.CLAUDE_CONFIG_DIR,path.join(root,'chosen-config'));
    assert.equal(configured.CLAUDE_CLI_PATH,path.join(root,'chosen-cli.js'));
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('discovery rejects a healthy unrelated server and requires the owned instance',async()=>{
  const profile=loadWorkbenchProfile(process.cwd());
  assert.notEqual(profile.appId,'ai.cloudcli.desktop');
  assert.notEqual(profile.protocol,'cloudcli');
  let instance='other';
  const server=http.createServer((_request,response)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify({status:'ok',distribution:'workbench',instanceId:instance}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const controller=new LocalServerController({appRoot:process.cwd(),settingsPath:path.join(os.tmpdir(),'unused-settings.json'),workbenchProfile:profile});
    controller.instanceId='owned';
    const url=`http://127.0.0.1:${server.address().port}`;
    assert.equal(await controller.isWorkbenchServer(url),false);
    instance='owned';
    assert.equal(await controller.isWorkbenchServer(url),true);
    assert.equal(await controller.isWorkbenchServer('https://example.com'),false);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('a packaged Workbench never falls back to an upstream download',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-missing-'));
  try {
    const controller=new LocalServerController({appRoot:root,settingsPath:path.join(root,'settings.json'),
      isPackaged:true,workbenchProfile:loadWorkbenchProfile(process.cwd())});
    await assert.rejects(controller.resolveServerEntry(),/bundle is missing/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    await fs.rm(root,{recursive:true,force:true});
  }
});
