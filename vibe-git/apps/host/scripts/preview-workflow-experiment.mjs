/** Interactive experiment rehearsal in the original UI. No real accounts or models. */
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {EventEmitter} from 'node:events';
import {buildApp} from '../dist/app.js';
import {buildResearchPanel} from '../dist/sciencepal/local-panel.js';
import {SciencePALMemberConnector} from '../dist/sciencepal/member-connector.js';
import {managedCodexTask} from '../dist/sciencepal/local-codex.js';
import {ResearchRemote,simulationSession} from './research-simulation-fixture.mjs';
import {cases,scenario,reference} from './workflow-experiment-fixtures.mjs';
const study=cases.find(c=>c.id===(process.argv[2]||'calibration'));if(!study)throw Error('Choose calibration or kinetics');
const root=await mkdtemp(join(tmpdir(),'vibe-interactive-experiment-')),out=resolve('data/interactive-experiment');await mkdir(out,{recursive:true});await writeFile(join(out,study.id+'.csv'),study.csv);
const sim=scenario(study),workers=[],workerJournals=new Map(),off=new ResearchRemote('host');off.configured=false;
const app=await buildApp({dbPath:':memory:',dataDir:root,staticDir:false,backupDatabase:false,sciencepal:{remote:off,worker:false}});
app.addHook('onSend',async(r,reply,payload)=>{if(r.url==='/api/sciencepal-team/state'&&reply.statusCode===200&&typeof payload==='string'){const d=JSON.parse(payload);d.interactiveSimulation=true;return JSON.stringify(d);}return payload;});
const host=await app.listen({host:'127.0.0.1',port:0}),captain=JSON.parse(await readFile(join(root,'captain.json'))),invite=JSON.parse(await readFile(join(root,'invite.json'))),pipeline=app.sciencepalPipeline;
app.v20Service.repo.putNode({...app.v20Service.repo.getNode(captain.nodeId),label:'队长 · Codex（模拟）'});
const request=token=>async(path,body,method)=>{const r=await fetch(host+path,{method:method??(body===undefined?'GET':'POST'),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;};
const a=request(captain.nodeToken),leaderProfile=join(root,'leader');
const options={allowLocalExecution:false,remote:()=>new ResearchRemote('directory'),worker:env=>{const child=new EventEmitter();child.stopped=false;child.kill=()=>{child.stopped=true;child.emit('exit',0);return true;};child.ready=(async()=>{const c=JSON.parse(await readFile(env.VIBE_GIT_MEMBER_FILE));child.req=request(c.nodeToken);child.env=env;const session=simulationSession(workerJournals,env.VIBE_GIT_CONNECTOR_STATE,env.VIBE_GIT_PROJECT_ID,'simulated-science',sim.calculate);child.connector=new SciencePALMemberConnector(session.remote,child.req,session.journal,async()=>{});})();workers.push(child);return child;}};
const leader=await buildResearchPanel({...options,profileDir:leaderProfile,captainFile:join(root,'captain.json'),hostUrl:host});await leader.listen();
const member=await buildResearchPanel({...options,profileDir:join(root,'member')});await member.listen();
let busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{
 await pipeline.tick();
 for(const w of workers){await w.ready;if(!w.stopped){await w.req('/api/sciencepal-team/heartbeat',{channel:'connector',instanceId:w.env.VIBE_GIT_CONNECTOR_INSTANCE,projectId:w.env.VIBE_GIT_PROJECT_ID,status:'working'});await w.connector.step();}}
 for(const p of pipeline.list())for(const r of p.runs.filter(r=>r.ownerNodeId===captain.nodeId&&r.revision===p.revision&&['STARTING','RUNNING'].includes(r.status))){
  const info=await managedCodexTask('inspect',a,{host,nodeId:captain.nodeId,projectId:p.id,runId:r.id,profileDir:leaderProfile});
  if(info.prepared&&!info.outputExists){const packet=JSON.parse(await readFile(join(info.directory,'task.json'))).packet,files=await Promise.all(packet.files.map(async f=>({filename:f.filename,bytes:await readFile(join(info.directory,'inputs',f.filename))})));await writeFile(info.outputPath,sim.calculate(r.kind,files));}
 }
 await pipeline.tick();
 }catch(e){console.error('Simulation step:',e.message);}finally{busy=false;}},700);
const info={scope:'Interactive generated-data simulation only; never use a real API key.',study,captain:leader.ticket(),member:member.ticket(),invite:host+'/join/'+invite.inviteToken,csv:join(out,study.id+'.csv'),reference:reference(study,Buffer.from(study.csv))};
await writeFile(join(out,'session.json'),JSON.stringify(info,null,2));
await writeFile(join(out,'captain-proposal.md'),study.captain+'\n');
await writeFile(join(out,'scientist-proposal.md'),study.scientist+'\n');
await writeFile(join(out,'START-HERE.md'),`# ${study.title}\n\n仅模拟，不用真实账号。\n\n1. 打开[队长页面](${info.captain})与[成员页面](${info.member})。这两个启动链接仅使用一次；已打开的页面直接保留。\n2. 成员加入链接：${info.invite}。模拟 Key 只填 SIMULATED-ONLY。\n3. 队长绑定 Codex，成员绑定 SciencePAL。各自复制同目录 captain-proposal.md / scientist-proposal.md 的正文并保存提案。\n4. 队长建项，上传同目录 ${study.id}.csv。来源可填公开仓库链接，署名明确为自建模拟数据。\n5. 对齐后在协议抽屉配置 fit 任务：method 固定为 ${study.method}；${study.metric} 的独立参考 ${info.reference}，绝对容差 0.00000001。\n6. 首次漏项、首次执行错误及越权评审均为预设；按错误提示重试对应阶段，合法缺单位时安排返工。\n7. Codex 点准备任务包后等模拟结果出现，再检查并交回；不启动真实模型。SciencePAL 点启动本人连接器。\n\n完整步骤：[操作说明](https://github.com/WeihanChen000/vibe-git-research/blob/codex/research-team-share/docs/research/WORKFLOW-EXPERIMENTS-20261031.md)。\n`);
console.log('Human walkthrough: '+join(out,'START-HERE.md'));

console.log('SIMULATION ONLY. SciencePAL key: SIMULATED-ONLY. Local outputs appear after preparing a task; click check/submit, not launch a real model.');console.log(JSON.stringify(info,null,2));
async function stop(){clearInterval(timer);for(const w of workers)w.kill();await leader.app.close();await member.app.close();await app.close();process.exit(0);}process.once('SIGINT',stop);process.once('SIGTERM',stop);
