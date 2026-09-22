import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hash, id, assert, str } from '../../plugins/agentgit/runtime/common.mjs';

export class Store {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, fixture INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, member_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, content_hash TEXT NOT NULL, submission_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(member_id,submission_id));
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, member_id TEXT NOT NULL, body TEXT NOT NULL, delivered INTEGER DEFAULT 0, read INTEGER DEFAULT 0);
    `);
    for (const key of ['room_id','invite','viewer','admin']) if (!this.get(key)) this.db.prepare('INSERT INTO meta VALUES (?,?)').run(key,id());
  }
  get(key) { return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value; }
  transaction(fn) { if(this.inTransaction)return fn();this.db.exec('BEGIN IMMEDIATE');this.inTransaction=true;try { const result=fn(); this.db.exec('COMMIT'); return result; } catch(e) { this.db.exec('ROLLBACK'); throw e; } finally {this.inTransaction=false;} }
  event(type,payload) { this.db.prepare('INSERT INTO events(event_id,type,payload,created_at) VALUES(?,?,?,?)').run(id(),type,JSON.stringify(payload),new Date().toISOString()); }
  join(invite,name,fixture=false) {
    assert(invite === this.get('invite'),'邀请无效',403); str(name,'name',80);
    return this.transaction(()=>{
      const member_id=id(), token=id()+id();
      this.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run(member_id,name,hash(token),+fixture);
      const task={ task_id:id(), owner:member_id, fixture:true, goal:'验证 Codex 原生任务读取', acceptance:['工具返回完整任务包','不修改项目代码'], write_scope:[], execution_allowed:false, note:'M0 测试数据，不代表全队定案或正式派发' };
      this.db.prepare('INSERT INTO tasks(id,member_id,body) VALUES(?,?,?)').run(task.task_id,member_id,JSON.stringify(task));
      this.event('member.joined',{member_id,name,fixture}); this.event('task.dispatched',{member_id,task_id:task.task_id,fixture:true});
      return {room_id:this.get('room_id'),member_id,token};
    });
  }
  member(token) { return this.db.prepare('SELECT id,name,fixture FROM members WHERE token_hash=?').get(hash(token||'')); }
  submit(member,input) {
    str(input.body,'body'); str(input.submission_id,'submission_id',100);
    assert(input.content_hash === hash(input.body),'正文 hash 不匹配',409);
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT * FROM proposals WHERE member_id=? AND submission_id=?').get(member.id,input.submission_id);
      if(old) { assert(old.content_hash===input.content_hash,'幂等键已绑定其他正文',409); return this.receipt(old); }
      const revision=1+this.db.prepare('SELECT COUNT(*) AS n FROM proposals WHERE member_id=?').get(member.id).n;
      const row={id:id(),member_id:member.id,revision,body:input.body,content_hash:input.content_hash,submission_id:input.submission_id,created_at:new Date().toISOString()};
      this.db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?,?,?)').run(...Object.values(row));
      this.event(revision===1?'proposal.submitted':'proposal.revised',{member_id:member.id,proposal_id:row.id,revision,content_hash:row.content_hash});
      return this.receipt(row);
    });
  }
  receipt(row) { return {status:'submitted',proposal_id:row.id,revision:row.revision,content_hash:row.content_hash,submission_id:row.submission_id,submitted_at:row.created_at}; }
  lookup(member,submission) { const row=this.db.prepare('SELECT * FROM proposals WHERE member_id=? AND submission_id=?').get(member.id,submission); return row?this.receipt(row):{status:'not_found'}; }
  tasks(member,read=false) {
    return this.transaction(()=>{
      const rows=this.db.prepare('SELECT * FROM tasks WHERE member_id=?').all(member.id);
      for(const row of rows) if(!(read?row.read:row.delivered)) {
        this.db.prepare(read?'UPDATE tasks SET read=1,delivered=1 WHERE id=?':'UPDATE tasks SET delivered=1 WHERE id=?').run(row.id);
        this.event(read?'task.read':'task.delivered',{member_id:member.id,task_id:row.id});
      }
      return rows.map(row=>({...JSON.parse(row.body),delivered:true,read:read||!!row.read}));
    });
  }
  events(after=0) { assert(Number.isSafeInteger(after)&&after>=0,'无效游标'); return this.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT 500').all(after).map(e=>({...e,payload:JSON.parse(e.payload)})); }
  snapshot() { return {room_id:this.get('room_id'),phase:'PROPOSALS_OPEN',members:this.db.prepare('SELECT id,name,fixture FROM members').all(),proposals:this.db.prepare('SELECT * FROM proposals ORDER BY created_at DESC').all(),tasks:this.db.prepare('SELECT id,member_id,delivered,read FROM tasks').all(),events:this.events(0),capabilities:{native_plan_verified:false,coordinator:false,formal_tasks:false,transport:'HTTP cursor polling'}}; }
  close(){this.db.close();}
}
