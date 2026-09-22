import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { Store } from './store.mjs';
import { attachEvents } from './events.mjs';
import { assert,jsonBody,reply } from '../../plugins/agentgit/runtime/common.mjs';

export function createHost({dataDir=resolve('.agentgit/host')}={}) {
  const store=new Store(join(dataDir,'host.db'));
  const web=fileURLToPath(new URL('../web/',import.meta.url));
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost'); const path=url.pathname;
      if(req.headers.origin) assert(req.headers.origin===`http://${req.headers.host}` || req.headers.origin===`https://${req.headers.host}`,'跨域请求已拒绝',403);
      if(req.method==='GET'&&['/','/app.js','/style.css'].includes(path)) {
        res.writeHead(200,{'Content-Type':path==='/'?'text/html; charset=utf-8':path.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'});
        return res.end(readFileSync(join(web,path==='/'?'index.html':path.slice(1))));
      }
      if(path==='/api/health'&&req.method==='GET')return reply(res,200,{ok:true,version:'0.1.0'});
      const token=(req.headers.authorization||'').replace(/^Bearer /,'');
      if(path==='/api/join'&&req.method==='POST'){const body=await jsonBody(req);return reply(res,200,store.join(body.invite,body.name));}
      const member=store.member(token), admin=token===store.get('admin'), viewer=token===store.get('viewer');
      assert(member||admin||viewer,'需要房间凭据',401);
      if(path==='/api/room'&&req.method==='GET')return reply(res,200,store.snapshot());
      if(path==='/api/events'&&req.method==='GET')return reply(res,200,{events:store.events(Number(url.searchParams.get('after')||0))});
      if(path==='/api/demo'&&req.method==='POST') {
        assert(admin,'仅本机管理员可加载样例',403);
        if(store.get('seeded'))return reply(res,200,{ok:true,already_seeded:true});
        const {hash,id}=await import('../../plugins/agentgit/runtime/common.mjs');
        const examples=[['林 / 产品','## 我理解的目标\n让三位成员在各自 Codex 中完成协作。\n\n## 我的建议\n第一版不做账号登录，优先跑通提交与回执。\n\n## 我的疑问\n意见冲突时由谁最终决定？'],['陈 / 服务端','## 我理解的目标\n队长本机保存房间权威状态。\n\n## 我的建议\n使用邀请加入；SQLite 保存版本和回执，断线后按游标补收。\n\n## 独有想法\n重复提交应返回同一回执。'],['周 / 体验','## 我理解的目标\n明确展示提案来源和未决问题。\n\n## 我的建议\n希望支持账号登录，便于跨设备恢复。\n\n## 我的疑问\n首版是否值得引入账号体系？']];
        store.transaction(()=>{for(const [name,body] of examples){const m=store.join(store.get('invite'),name,true);store.submit(store.member(m.token),{body,content_hash:hash(body),submission_id:id()});}store.db.prepare('INSERT INTO meta VALUES(?,?)').run('seeded','done');});
        return reply(res,200,{ok:true});
      }
      assert(member,'该操作需要成员身份',403);
      if(path==='/api/proposals'&&req.method==='POST')return reply(res,200,store.submit(member,await jsonBody(req)));
      if(path==='/api/receipt'&&req.method==='GET')return reply(res,200,store.lookup(member,url.searchParams.get('id')));
      if(path==='/api/tasks/deliver'&&req.method==='POST')return reply(res,200,{tasks:store.tasks(member)});
      if(path==='/api/tasks/read'&&req.method==='POST')return reply(res,200,{tasks:store.tasks(member,true)});
      reply(res,404,{error:'接口不存在'});
    }catch(e){reply(res,e.status||500,{error:e.status?e.message:'Host 内部错误'});}
  });
  const live=attachEvents(server,store);
  server.on('close',()=>live.close());
  return {server,store,live};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const dataDir=resolve(process.env.AGENTGIT_HOST_DATA||'.agentgit/host');const {server,store}=createHost({dataDir});
  const port=Number(process.env.PORT||4399);
  server.listen(port,'127.0.0.1',()=>{
    const base=`http://127.0.0.1:${port}`;mkdirSync(dataDir,{recursive:true});
    writeFileSync(join(dataDir,'access.json'),JSON.stringify({base,room_id:store.get('room_id'),invite:store.get('invite'),viewer:store.get('viewer'),admin:store.get('admin')},null,2),{mode:0o600});
    console.log(`AgentGit Host: ${base}\n本机接入信息: ${join(dataDir,'access.json')}\n成员通过 AgentGit 插件加入，不需要网页。`);
  });
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
}
