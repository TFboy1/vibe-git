import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createHost} from '../apps/host/server.mjs';
import {createRelay} from '../plugins/agentgit/runtime/relay.mjs';
import {hash,id} from '../plugins/agentgit/runtime/common.mjs';
const dir=()=>mkdtempSync(join(tmpdir(),'agentgit-ws-'));
async function until(check){const until=Date.now()+9000;while(Date.now()<until){if(check())return;await new Promise(r=>setTimeout(r,50));}throw Error('transport timeout');}
test('authenticated WebSocket wakes durable sync; disconnect and reconnect recover missed events',async()=>{
 const host=createHost({dataDir:dir()});host.server.listen(0,'127.0.0.1');await once(host.server,'listening');
 const relay=createRelay(dir());
 try{
  await relay.client.join({host:'http://127.0.0.1:'+host.server.address().port,invite:host.store.get('invite'),name:'transport fixture',repository:'r'});
  await until(()=>relay.client.liveConnected);await until(()=>relay.client.get('cursor')>=2);
  host.live.disconnectClients();await until(()=>!relay.client.liveConnected);
  const member=host.store.member(relay.client.get('binding').token),body='WebSocket 提案';host.store.submit(member,{body,content_hash:hash(body),submission_id:id()});
  const end=host.store.db.prepare('SELECT MAX(seq) seq FROM events').get().seq;
  await until(()=>relay.client.get('cursor')>=end);await until(()=>relay.client.liveConnected);
  assert.equal(relay.client.db.prepare('SELECT COUNT(*) n FROM inbox').get().n,end);
  assert.equal((await relay.client.sync()).transport,'websocket+cursor');
 }finally{relay.stop();host.live.close();await new Promise(r=>setTimeout(r,100));relay.client.close();await new Promise(r=>host.server.close(r));host.store.close();}
});
test('unauthenticated WebSocket cannot receive room events',async()=>{
 const host=createHost({dataDir:dir()});host.server.listen(0,'127.0.0.1');await once(host.server,'listening');const socket=new WebSocket('ws://127.0.0.1:'+host.server.address().port+'/api/live');let messages=0;
 try{socket.onmessage=()=>messages++;await new Promise(r=>socket.onopen=r);socket.send(JSON.stringify({type:'authenticate',token:'wrong'}));const code=await new Promise(r=>socket.onclose=e=>r(e.code));assert.equal(code,1008);assert.equal(messages,0);}finally{host.live.close();await new Promise(r=>host.server.close(r));host.store.close();}
});
