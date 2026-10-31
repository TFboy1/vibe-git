/** Complete onboarding demo: real local panels and Host, synthetic Agent workers only. */
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import {buildApp} from '../dist/app.js';
import {buildResearchPanel} from '../dist/sciencepal/local-panel.js';
import {SciencePALMemberConnector} from '../dist/sciencepal/member-connector.js';
import {localMemberTask} from '../dist/sciencepal/local-member.js';
import {ResearchRemote,simulatedEnvelope,simulationSession} from './research-simulation-fixture.mjs';
const root=await mkdtemp(join(tmpdir(),'vibe-onboard-demo-')),out=resolve('data/onboarding-demo');await mkdir(out,{recursive:true});
const noRemote=new ResearchRemote('HOST');noRemote.configured=false;
const app=await buildApp({dbPath:':memory:',dataDir:root,staticDir:false,backupDatabase:false,sciencepal:{remote:noRemote,worker:false}});
app.addHook('onSend',async(r,reply,payload)=>{if(r.url==='/api/sciencepal-team/state'&&reply.statusCode===200&&typeof payload==='string'){const d=JSON.parse(payload);d.interactiveSimulation=true;return JSON.stringify(d);}return payload;});
const origin=await app.listen({host:'127.0.0.1',port:0}),captain=JSON.parse(await readFile(join(root,'captain.json'))),invite=JSON.parse(await readFile(join(root,'invite.json'))),service=app.v20Service,pipeline=app.sciencepalPipeline;
service.repo.putNode({...service.repo.getNode(captain.nodeId),label:'研究员 A'});
const request=token=>async(path,body,method)=>{const r=await fetch(origin+path,{method:method||(body===undefined?'GET':'POST'),headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;};
const a=request(captain.nodeToken),children=new Set();
const workerJournals=new Map();
function fakeWorker(env){const child=new EventEmitter();let stopping=false,busy=false,connector,req;children.add(child);
 const ready=(async()=>{const c=JSON.parse(await readFile(env.VIBE_GIT_MEMBER_FILE));req=request(c.nodeToken);service.repo.putNode({...service.repo.getNode(c.nodeId),label:'研究员 B'});const saved=simulationSession(workerJournals,env.VIBE_GIT_CONNECTOR_STATE,env.VIBE_GIT_PROJECT_ID,'DEMO-B');connector=new SciencePALMemberConnector(saved.remote,req,saved.journal,async()=>{});})();
 const timer=setInterval(async()=>{if(stopping||busy)return;busy=true;try{await ready;await req('/api/sciencepal-team/heartbeat',{channel:'connector',instanceId:env.VIBE_GIT_CONNECTOR_INSTANCE,projectId:env.VIBE_GIT_PROJECT_ID,status:connector.journal.phase==='IDLE'?'ready':'working'});await connector.step();}catch(e){console.error('Synthetic worker:',e.message);}finally{busy=false;}},700);
 child.kill=()=>{stopping=true;clearInterval(timer);children.delete(child);child.emit('exit',0);return true;};return child;}
const base={allowLocalExecution:false,remote:key=>{const directory=new ResearchRemote('directory');directory.agents=async()=>{if(key==='EMPTY-KEY')return [];if(key!=='DEMO-KEY')throw Error('Synthetic invalid key');return [{id:'simulated-research-expert',name:'SIMULATED expert'}];};return directory;},worker:fakeWorker};
if(process.env.VIBE_DEMO_SEED==='1'){
 const joined=await (await fetch(origin+'/api/v1/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invite:invite.inviteToken})})).json();
 service.repo.putNode({...service.repo.getNode(joined.node.id),label:'研究员 B'});
 const b=request(joined.nodeToken);await mkdir(join(root,'member-profile'),{recursive:true});
 await writeFile(join(root,'member-profile','member.json'),JSON.stringify({nodeId:joined.node.id,nodeToken:joined.nodeToken,hostUrl:origin,roomId:joined.roomId}));
 await writeFile(join(root,'member-profile','sciencepal-auth.json'),JSON.stringify({apiKey:'DEMO-KEY'}));
 await a('/api/sciencepal-team/binding',{agent:{id:'codex-local',name:'Codex 本地',platform:'codex'}},'PUT');
 await b('/api/sciencepal-team/binding',{agent:{id:'simulated-research-expert',name:'SciencePAL 科研专家（模拟）',platform:'sciencepal'}},'PUT');
 const pa=await a('/api/v1/plans',{filename:'data.md',content:'# 科研协作演练\n冻结数据、计算方法和随机种子；所有结果明确标注模拟。'}),pb=await b('/api/v1/plans',{filename:'review.md',content:'# 独立复核\n检查上游文件、方法和参数，评审不通过时返工。'});
 const p=await a('/api/sciencepal-team/projects',{title:'通用科研协作 · 多平台与防漂移演练',coordinatorNodeId:captain.nodeId,documentIds:[pa.id,pb.id]});
 await a(`/api/sciencepal-team/projects/${p.id}/commands/align`,{revision:1});
 const run=pipeline.get(p.id).runs[0],dir=join(root,'seed-align'),ctx={host:origin,nodeId:captain.nodeId,projectId:p.id};
 const t=await localMemberTask('take',a,ctx,dir),packet=JSON.parse(await readFile(join(dir,'task.json'))).packet;
 await writeFile(t.output,simulatedEnvelope('ALIGN',packet.files.map(f=>({filename:f.filename,bytes:Buffer.from(f.base64,'base64')}))));await localMemberTask('submit',a,ctx,dir,t.output);
}
const leader=await buildResearchPanel({...base,profileDir:join(root,'captain-profile'),captainFile:join(root,'captain.json'),hostUrl:origin});await leader.listen();
const member=await buildResearchPanel({...base,profileDir:join(root,'member-profile')});await member.listen();
let busy=false;const tick=setInterval(async()=>{if(busy)return;busy=true;try{await pipeline.tick();for(const p of pipeline.list()){
 if(process.env.VIBE_DEMO_SEED==='1')continue;
 const r=p.runs.find(r=>r.ownerNodeId===captain.nodeId&&r.revision===p.revision&&r.status==='READY');if(!r||p.paused||['BLOCKED','CHANGES_REQUESTED','CHANGE_READY'].includes(p.phase))continue;
 const dir=join(root,'codex-'+r.id),ctx={host:origin,nodeId:captain.nodeId,projectId:p.id};const t=await localMemberTask('take',a,ctx,dir);const packet=JSON.parse(await readFile(join(dir,'task.json'))).packet;
 const files=await Promise.all(packet.files.map(async f=>({filename:f.filename,bytes:await readFile(join(dir,'inputs',f.filename))})));await writeFile(t.output,simulatedEnvelope(r.kind,files));await localMemberTask('submit',a,ctx,dir,t.output);
 }await pipeline.tick();}catch(e){console.error('Synthetic Codex:',e.message);}finally{busy=false;}},700);
const launch=createServer((req,res)=>{if(req.method!=='GET'){res.writeHead(405);res.end();return;}const path=new URL(req.url,'http://localhost').pathname;if(['/captain','/member'].includes(path)){res.writeHead(302,{Location:path==='/captain'?leader.ticket():member.ticket(),'Cache-Control':'no-store'});res.end();return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html lang="zh"><meta name="viewport" content="width=device-width"><style>body{background:#0c0e13;color:#f5f7fa;font:15px/1.8 'Segoe UI',sans-serif;max-width:760px;margin:8vh auto;padding:24px}a{display:inline-block;color:#90bbff;margin-right:16px;padding:12px 18px;border:1px solid #414958;border-radius:7px}code{display:block;background:#151922;padding:12px;overflow-wrap:anywhere}small{color:#929aa8}</style><h1>原版入口逻辑 · 科研协作演练</h1><p>两个独立本机面板，真实成员权限与心跳；Agent 输出为合成结果，不使用真实账号或 Key。</p><p><a href="/captain" target="_blank">队长本机面板</a><a href="/member" target="_blank">队友首次接入</a></p><p>队友加入链接：</p><code>${origin}/join/${invite.inviteToken}</code><p>模拟 SciencePAL Key 填 <b>DEMO-KEY</b>。队长选择 Codex，队友选择 SciencePAL，各自保存提案；队长建立项目后，队友在算力网中启动连接器。</p><small>仅此演练使用自动的合成 Codex worker。真实 Codex 需要本人处理本地任务包。关闭后不影响真实团队数据。</small></html>`);});await new Promise(r=>launch.listen(0,'127.0.0.1',r));
const launcher=`http://127.0.0.1:${launch.address().port}`;await writeFile(join(out,'preview.json'),JSON.stringify({launcher,captain:leader.origin(),member:member.origin(),invite:origin+'/join/'+invite.inviteToken,pid:process.pid,scope:'synthetic onboarding; no real credentials'},null,2));console.log(launcher);
process.on('SIGINT',async()=>{clearInterval(tick);for(const c of children)c.kill();launch.close();await leader.app.close();await member.app.close();await app.close();process.exit(0);});
