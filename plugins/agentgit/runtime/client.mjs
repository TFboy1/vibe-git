import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { assert,str,hash,id,request } from './common.mjs';
export class Client {
  constructor(path){mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS pending(id TEXT PRIMARY KEY,body TEXT,hash TEXT,binding TEXT,status TEXT,receipt TEXT); CREATE TABLE IF NOT EXISTS inbox(id TEXT PRIMARY KEY,body TEXT);`);}
  get(key){const row=this.db.prepare('SELECT value FROM state WHERE key=?').get(key);return row?JSON.parse(row.value):null;}
  set(key,value){this.db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run(key,JSON.stringify(value));}
  async call(path,body){const b=this.get('binding');assert(b,'请先加入房间');return request(b.host,path,b.token,body);}
  async join({host,invite,name,repository}) {
    assert(!this.get('binding'),'此 Relay 已绑定成员。不同成员或项目请使用独立 Relay 数据目录',409);
    const url=new URL(host);assert(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)),'远程 Host 必须使用 HTTPS');
    assert(!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/','Host 只能包含源地址');str(repository,'repository',1000);
    const result=await request(url.origin,'/api/join',null,{invite,name});
    this.set('binding',{...result,host:url.origin,repository});return {room_id:result.room_id,member_id:result.member_id,repository};
  }
  prepare({body,repository}){const binding=this.get('binding');assert(binding,'请先加入房间');assert(repository===binding.repository,'仓库绑定不匹配',409);str(body,'body');const submission_id=id(),content_hash=hash(body);this.db.prepare('INSERT INTO pending VALUES(?,?,?,?,?,NULL)').run(submission_id,body,content_hash,JSON.stringify(binding),'prepared');return {submission_id,content_hash,body,bytes:Buffer.byteLength(body),status:'prepared',notice:'本地冻结预览；尚未发送到团队。确认同一 hash 后提交。'};}
  async submit({submission_id,content_hash,confirmed}){
    assert(confirmed===true,'仅可提交用户明确确认的冻结稿');const p=this.db.prepare('SELECT * FROM pending WHERE id=?').get(submission_id);assert(p,'冻结稿不存在',404);assert(p.hash===content_hash&&hash(p.body)===content_hash,'冻结稿 hash 不匹配',409);assert(p.binding===JSON.stringify(this.get('binding')),'成员或房间绑定发生变化',409);
    if(p.receipt)return JSON.parse(p.receipt);
    this.db.prepare('UPDATE pending SET status=? WHERE id=?').run('pending_confirmation',p.id);
    return this.sendPending(p);
  }
  async sendPending(p){try{const receipt=await this.call('/api/proposals',{submission_id:p.id,body:p.body,content_hash:p.hash});this.db.prepare('UPDATE pending SET status=?,receipt=? WHERE id=?').run('submitted',JSON.stringify(receipt),p.id);return receipt;}catch(e){if(e.status&&e.status<500){this.db.prepare('UPDATE pending SET status=? WHERE id=?').run('rejected',p.id);throw e;}return {submission_id:p.id,status:'pending_confirmation',notice:'尚未确认送达；Relay 将使用相同幂等键重试。'};}}
  async sync(){const b=this.get('binding');if(!b)return {connected:false,notice:'尚未加入房间'};
    const {events}=await this.call('/api/events?after='+(this.get('cursor')||0));
    this.db.exec('BEGIN IMMEDIATE');try{for(const e of events)this.db.prepare('INSERT OR IGNORE INTO inbox VALUES(?,?)').run(e.event_id,JSON.stringify(e));if(events.length)this.set('cursor',events.at(-1).seq);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
    const tasks=await this.call('/api/tasks/deliver',{});this.set('tasks',tasks.tasks);
    for(const p of this.db.prepare("SELECT * FROM pending WHERE status='pending_confirmation'").all())await this.sendPending(p);
    const inbox=this.db.prepare('SELECT body FROM inbox ORDER BY rowid DESC LIMIT 100').all().map(row=>JSON.parse(row.body)).filter(e=>!e.payload.member_id||e.payload.member_id===b.member_id);
    this.set('last_sync',new Date().toISOString());return {connected:true,transport:this.liveConnected?'websocket+cursor':'http-polling',room_id:b.room_id,member_id:b.member_id,repository:b.repository,cursor:this.get('cursor'),last_sync:this.get('last_sync'),tasks:tasks.tasks,events:inbox};
  }
  async readTasks(){return this.call('/api/tasks/read',{});}
  async receipt({submission_id}){return this.call('/api/receipt?id='+encodeURIComponent(submission_id));}
  close(){this.db.close();}
}
