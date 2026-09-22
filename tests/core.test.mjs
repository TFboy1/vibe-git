import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {Store} from '../apps/host/store.mjs';
import {createHost} from '../apps/host/server.mjs';
import {Client} from '../plugins/agentgit/runtime/client.mjs';
import {createRelay} from '../plugins/agentgit/runtime/relay.mjs';
import {hash,id,request} from '../plugins/agentgit/runtime/common.mjs';
const dir=()=>mkdtempSync(join(tmpdir(),'agentgit-test-'));
test('exact UTF-8 bytes, idempotency, revision history and author isolation survive SQLite reopen',()=>{
 const path=join(dir(),'host.db');let s=new Store(path);const a=s.join(s.get('invite'),'A'),b=s.join(s.get('invite'),'B');const input={body:'中文🙂\r\n'+('长计划\n'.repeat(2000)),submission_id:id()};input.content_hash=hash(input.body);
 const first=s.submit(s.member(a.token),input);assert.deepEqual(s.submit(s.member(a.token),input),first);assert.equal(s.snapshot().proposals.length,1);
 assert.throws(()=>s.submit(s.member(a.token),{...input,body:'changed',content_hash:hash('changed')}),/幂等键/);
 assert.equal(s.lookup(s.member(b.token),input.submission_id).status,'not_found');assert.equal(s.submit(s.member(a.token),{...input,submission_id:id()}).revision,2);
 s.close();s=new Store(path);assert.equal(s.snapshot().proposals[0].body,input.body);assert.deepEqual(s.lookup(s.member(a.token),input.submission_id),first);s.close();
});
test('Host authentication, immutable preview, local recovery, delivery/read distinction and cursor replay',async()=>{
 const host=createHost({dataDir:dir()});host.server.listen(0,'127.0.0.1');await once(host.server,'listening');const base='http://127.0.0.1:'+host.server.address().port;
 const path=join(dir(),'relay.db');let c=new Client(path);
 try {
  await assert.rejects(request(base,'/api/room'),/凭据/);await assert.rejects(request(base,'/api/join',null,{invite:'bad',name:'A'}),/邀请/);
  await c.join({host:base,invite:host.store.get('invite'),name:'A',repository:'repo-a'});assert.throws(()=>c.prepare({body:'hello',repository:'repo-b'}),/绑定/);
  const preview=c.prepare({body:'完整提案\n不更改\r\n🙂',repository:'repo-a'});assert.equal(host.store.snapshot().proposals.length,0);
  await assert.rejects(c.submit({...preview,confirmed:false}),/确认/);await assert.rejects(c.submit({...preview,content_hash:'bad',confirmed:true}),/hash/);
  c.close();c=new Client(path);const receipt=await c.submit({...preview,confirmed:true});assert.equal(receipt.status,'submitted');assert.deepEqual(await c.submit({...preview,confirmed:true}),receipt);
  await c.sync();assert.equal(host.store.snapshot().tasks[0].delivered,1);assert.equal(host.store.snapshot().tasks[0].read,0);
  await c.readTasks();assert.equal(host.store.snapshot().tasks[0].read,1);assert.equal((await c.readTasks()).tasks[0].execution_allowed,false);
  await c.sync();const count=c.db.prepare('SELECT COUNT(*) n FROM inbox').get().n;c.set('cursor',0);await c.sync();assert.equal(c.db.prepare('SELECT COUNT(*) n FROM inbox').get().n,count);
  host.store.event('review.completed',{member_id:c.get('binding').member_id,fixture:true,result:'测试审核事件，不是正式批准'});
  await c.sync();assert.ok((await c.sync()).events.some(e=>e.type==='review.completed'),'后台同步后审核事件仍可从持久化收件箱读取');
  const response=await fetch(base+'/api/join',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);
 }finally{c.close();host.server.close();host.store.close();}
});
test('timeout after commit is recovered with same submission and no duplicate publish',async()=>{
 const host=createHost({dataDir:dir()});host.server.listen(0,'127.0.0.1');await once(host.server,'listening');const c=new Client(join(dir(),'relay.db'));
 try{await c.join({host:'http://127.0.0.1:'+host.server.address().port,invite:host.store.get('invite'),name:'A',repository:'r'});const p=c.prepare({body:'proposal',repository:'r'});const realCall=c.call.bind(c);let fail=true;c.call=async(path,body)=>{const result=await realCall(path,body);if(path==='/api/proposals'&&fail){fail=false;throw new Error('lost response');}return result;};assert.equal((await c.submit({...p,confirmed:true})).status,'pending_confirmation');assert.equal(host.store.snapshot().proposals.length,1);await c.sync();assert.equal((await c.receipt(p)).status,'submitted');assert.equal(host.store.snapshot().proposals.length,1);
 }finally{c.close();host.server.close();host.store.close();}
});
test('real stdio MCP → authenticated Relay → HTTP Host end-to-end fixture',async()=>{
 const host=createHost({dataDir:dir()});host.server.listen(0,'127.0.0.1');await once(host.server,'listening');const dataDir=dir(),relay=createRelay(dataDir);relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');
 const child=spawn(process.execPath,['plugins/agentgit/runtime/bridge.mjs'],{env:{...process.env,AGENTGIT_RELAY_DATA:dataDir,AGENTGIT_RELAY_PORT:String(relay.server.address().port)},stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:child.stdout});let sequence=0;const waiting=new Map();lines.on('line',line=>{const msg=JSON.parse(line);waiting.get(msg.id)?.(msg);waiting.delete(msg.id);});
 function rpc(method,params={}){const next=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('MCP timed out')),10000);waiting.set(next,msg=>{clearTimeout(timer);resolve(msg.result);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');});}
 async function tool(name,args){const result=await rpc('tools/call',{name:'agentgit_'+name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);}
 try{
  assert.equal((await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1'}})).serverInfo.name,'agentgit');
  const list=await rpc('tools/list');assert.equal(list.tools.length,6);assert.equal(list.tools.find(t=>t.name==='agentgit_prepare_submission').annotations.readOnlyHint,false);
  await tool('join_room',{host:'http://127.0.0.1:'+host.server.address().port,invite:host.store.get('invite'),name:'MCP fixture',repository:'r'});
  const p=await tool('prepare_submission',{body:'明确标记的 MCP 测试提案',repository:'r'});const receipt=await tool('submit_proposal',{submission_id:p.submission_id,content_hash:p.content_hash,confirmed:true});assert.equal(receipt.status,'submitted');assert.equal((await tool('read_tasks',{})).tasks[0].fixture,true);
 }finally{child.stdin.end();await once(child,'exit');lines.close();relay.stop();relay.server.close();relay.client.close();host.server.close();host.store.close();}
});
