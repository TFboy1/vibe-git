import {startLocalAgent,agentRunState,localAgentActive,reconcileLocalAgent} from "./local-agent.js";
import { isLocalResearchPlatform, researchPlatformName } from "@vibe-git/protocol";
import Fastify from 'fastify';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,unlink,stat} from 'node:fs/promises';
import {resolve,join,extname,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,type ChildProcess} from 'node:child_process';
import {SciencePALClient,type SciencePALRemote} from './client.js';
import {badRequest,forbidden,revisionConflict} from '../domain/errors.js';
import {memberJournalPath} from './member-journal.js';
import {managedCodexTask} from './local-codex.js';
import {browserCommands} from './browser-commands.js';
interface Credential {nodeId:string;nodeToken:string;hostUrl:string;roomId:string}
interface Options {allowLocalExecution?:boolean;profileDir:string;captainFile?:string;hostUrl?:string;remote?:(key:string)=>SciencePALRemote;worker?:(env:NodeJS.ProcessEnv)=>ChildProcess;staticDir?:string}
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const validHost=(raw:string)=>{const u=new URL(raw);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw badRequest('请输入 HTTPS 房间地址或本机回环地址');return u.origin;};
const load=async<T>(p:string):Promise<T|null>=>{try{return JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}};
/** Same local-entry pattern as Vibe-Git open: loopback, one-use ticket, HttpOnly session, own credentials. */
export async function buildResearchPanel(options:Options){
 const profile=resolve(options.profileDir),credentialPath=options.captainFile?resolve(options.captainFile):join(profile,'member.json'),keyPath=join(profile,'sciencepal-auth.json');
 await mkdir(profile,{recursive:true,mode:0o700});const app=Fastify({logger:false,bodyLimit:8*1024*1024});
 let credential=await load<Credential>(credentialPath);if(options.captainFile&&!credential)throw new Error('未找到队长身份，请先启动科研 Host，再用 --captain 打开');if(credential){credential={...credential,hostUrl:validHost(options.hostUrl||credential.hostUrl||'http://127.0.0.1:8788')};}
 const instance=randomUUID(),sessions=new Map<string,{csrf:string;expires:number}>(),tickets=new Map<string,number>();let origin='',cookieName='';
 let worker:ChildProcess|null=null,workerProject='',workerInstance='',workerState='stopped',lastExit:number|null=null,starting=false,panelHeartbeatBusy=false;
 const remote=options.remote??((key:string)=>new SciencePALClient(key));
 const api=async(path:string,body?:unknown,method?:string)=>{
  if(!credential)throw forbidden('请先加入房间');
  const r=await fetch(credential.hostUrl+path,{method:method??(body===undefined?'GET':'POST'),headers:{Authorization:`Bearer ${credential.nodeToken}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(15000)});
  return r;
 };
 const value=async(path:string,body?:unknown,method?:string)=>{const r=await api(path,body,method);const d=await r.json() as any;if(!r.ok){const e=new Error(d.error||'Host 操作失败') as Error&{statusCode:number};e.statusCode=r.status;throw e;}return d;};
 const beat=async(channel='panel',status='ready')=>{if(credential)await value('/api/sciencepal-team/heartbeat',{channel,status,instanceId:channel==='panel'?instance:workerInstance,projectId:channel==='panel'?'':workerProject});};
 const info=async()=>({local:true,configured:!!credential,joining:!!(await load(join(profile,'join-pending.json'))),host:credential?.hostUrl??'',hasKey:!!(await load<{apiKey:string}>(keyPath))?.apiKey,runner:{state:workerState,projectId:workerProject,exitCode:lastExit},workspace:'本人科研工作区'});
 app.setErrorHandler((e,_r,reply)=>{reply.code((e as any).statusCode||400).send({error:e instanceof Error?e.message:'本机操作失败'});});
 app.addHook('onRequest',async(r,reply)=>{
  reply.header('Cache-Control','no-store');
  if(r.url.startsWith('/open/'))return;
  const session=r.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)??'';
  const auth=sessions.get(session);if(!auth||auth.expires<Date.now())throw forbidden('请在本人电脑重新运行 npm run research:open');
  if(!['GET','HEAD'].includes(r.method)&&(r.headers.origin!==origin||r.headers['sec-fetch-site']==='cross-site'||typeof r.headers['x-vibe-csrf']!=='string'||!equal(r.headers['x-vibe-csrf'],auth.csrf)))throw forbidden('本机操作凭据或来源无效，请刷新页面');
  (r as any).researchCsrf=auth.csrf;
 });
 app.get<{Params:{ticket:string}}>('/open/:ticket',async(r,reply)=>{
  const exp=tickets.get(r.params.ticket);tickets.delete(r.params.ticket);if(!exp||exp<Date.now())throw forbidden('入口已失效，请重新打开本机面板');
  const session=randomBytes(32).toString('hex');sessions.set(session,{csrf:randomBytes(32).toString('hex'),expires:Date.now()+8*60*60_000});
  return reply.header('Set-Cookie',`${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/`).redirect('/sciencepal/team');
 });
 app.get('/api/local/research',async r=>({...await info(),csrfToken:(r as any).researchCsrf}));
 app.post<{Body:{invite?:string}}>('/api/local/research/join',async r=>{
  if(credential||options.captainFile)throw revisionConflict('已有本人身份，不会覆盖');
  let u:URL;try{u=new URL(String(r.body?.invite??'').trim());}catch{throw badRequest('邀请链接格式不正确，请粘贴队长提供的完整 https://…/join/… 链接');}const host=validHost(u.origin),m=u.pathname.match(/^\/join\/([^/]+)\/?$/);
  if(!m||u.search||u.hash||u.username||u.password)throw badRequest('请粘贴队长提供的完整加入链接');
  let inviteToken:string;try{inviteToken=decodeURIComponent(m[1]!);}catch{throw badRequest('邀请链接编码不完整，请重新复制队长提供的完整链接；尚未发送加入请求，可直接重试');}
  const pending=join(profile,'join-pending.json');await writeFile(pending,JSON.stringify({host,at:new Date().toISOString()}),{flag:'wx',mode:0o600}).catch(()=>{throw revisionConflict('上次加入结果尚未确认，请队长核对成员身份，不能重复注册');});
  let response:Response;try{response=await fetch(host+'/api/v1/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invite:inviteToken}),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw badRequest('加入结果尚未确认，请联系队长核对；未自动重试');}
  if(!response.ok){await unlink(pending);throw badRequest('加入失败，请核对邀请是否有效');}
  const d=await response.json() as any;const next={nodeId:d.node.id,nodeToken:d.nodeToken,roomId:d.roomId,hostUrl:host};
  await writeFile(credentialPath,JSON.stringify(next),{flag:'wx',mode:0o600});credential=next;await unlink(pending);await beat().catch(()=>undefined);return info();
 });
 app.post<{Body:{apiKey?:string}}>('/api/local/research/agents',async r=>{
  if(!credential)throw forbidden('请先加入房间');
  if(worker||starting)throw revisionConflict('连接器运行中，先停止后再更新账号配置');
  const key=r.body?.apiKey?.trim()||(await load<{apiKey:string}>(keyPath))?.apiKey;
  if(!key)throw badRequest('请输入本人 SciencePAL API Key；仅保存到本机');
  let agents;try{agents=await remote(key).agents();}catch{throw badRequest('无法访问本人 SciencePAL Agent 目录，请检查 Key 与网络');}
  if(r.body?.apiKey)await writeFile(keyPath,JSON.stringify({apiKey:key}),{mode:0o600});
  return {agents};
 });
 app.post<{Body:{platform?:string;agentId?:string}}>('/api/local/research/bind',async r=>{
  if(worker||starting)throw revisionConflict('连接器运行中，请先停止');
  let agent;if(isLocalResearchPlatform(r.body.platform))agent={id:r.body.platform+'-local',name:researchPlatformName(r.body.platform)+' 本地',platform:r.body.platform};
  else{if(r.body.platform!=='sciencepal')throw badRequest('不支持的执行平台');const key=(await load<{apiKey:string}>(keyPath))?.apiKey;if(!key)throw badRequest('先验证本人 SciencePAL 账号');agent=(await remote(key).agents()).find(a=>a.id===r.body.agentId);if(!agent)throw badRequest('本人账号不可使用该 Agent');}
  await value('/api/sciencepal-team/binding',{agent},'PUT');return info();
 });
 app.post<{Body:{projectId?:string}}>('/api/local/research/start',async r=>{
  const id=String(r.body.projectId??'');if(!/^[a-zA-Z0-9_-]{1,120}$/.test(id))throw badRequest('请选择本人参与的项目');
  if(starting)throw revisionConflict('正在启动，请等待');if(worker){if(id===workerProject)return info();throw revisionConflict('已有其他项目连接器运行，请先停止');}
  starting=true;try{
   const p=await value('/api/sciencepal-team/projects/'+id),m=p.team?.members.find((m:any)=>m.nodeId===credential!.nodeId);
   if(!m||isLocalResearchPlatform(m.agent.platform))throw badRequest('此项目由本人 Codex 执行，请在 Codex 中处理任务包；网页不会伪装启动模型');
   const key=(await load<{apiKey:string}>(keyPath))?.apiKey;if(!key)throw badRequest('请先在算力网入口验证账号');
   if(!(await remote(key).agents()).some(a=>a.id===(m.agent.runtimeAgentId??m.agent.id)))throw badRequest('当前账号不能使用项目冻结的 Agent');
   workerProject=id;workerInstance=randomUUID();await beat('connector');
   const journalPath=await memberJournalPath(profile,credential!.hostUrl,credential!.nodeId,id);
   const env={...process.env,SCIENCEPAL_API_KEY:'',SCIENCEPAL_AUTH_FILE:keyPath,VIBE_GIT_HOST:credential!.hostUrl,VIBE_GIT_MEMBER_FILE:credentialPath,VIBE_GIT_CONNECTOR_STATE:journalPath,VIBE_GIT_CONNECTOR_INSTANCE:workerInstance,VIBE_GIT_PROJECT_ID:id};
   worker=options.worker?options.worker(env):spawn(process.execPath,['--use-env-proxy',fileURLToPath(new URL('./member-main.js',import.meta.url)),'work',id],{env,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
   workerState='running';lastExit=null;const current=worker;
   const ended=(code:number|null)=>{if(worker!==current)return;worker=null;lastExit=code;workerState=workerState==='stopping'||code===0?'stopped':'error';void beat('connector','stopped').catch(()=>undefined);};
   current.once('exit',ended);current.once('error',()=>ended(1));return info();
  }catch(e){if(!worker)await beat('connector','stopped').catch(()=>undefined);throw e;}finally{starting=false;}
 });
 const stopWorker=()=>{if(worker){workerState='stopping';if(worker.connected)worker.send({type:'vibe-git:stop'},()=>{});else worker.kill('SIGTERM');}};
 app.post('/api/local/research/stop',async()=>{stopWorker();return info();});
 const codexTask=async(command:'inspect'|'take'|'submit',input:{projectId?:string;runId?:string})=>{
  if(!credential)throw forbidden('请先加入房间');
  const context={host:credential.hostUrl,nodeId:credential.nodeId,projectId:String(input?.projectId??''),runId:String(input?.runId??''),profileDir:profile};
  const inspected=await managedCodexTask('inspect',value,context),execution=await agentRunState(inspected.directory);
  if(command==='submit'&&execution&&['STARTING','RUNNING'].includes(execution.state))throw revisionConflict('Agent 尚在执行或启动结果未知，请先核对原进程；不能交回仍可能变化的文件');
  return {...await managedCodexTask(command,value,context),execution:execution?{...execution,canReconcile:['STARTING','RUNNING'].includes(execution.state)&&!localAgentActive(inspected.directory)}:null};
 };
 app.get<{Querystring:{projectId?:string;runId?:string}}>('/api/local/research/codex-task',r=>codexTask('inspect',r.query));
 app.post<{Body:{projectId?:string;runId?:string}}>('/api/local/research/agent-run',r=>{if(options.allowLocalExecution===false)throw forbidden('此演练禁止启动真实模型；请使用真实项目的本人待办');if(!credential)throw forbidden('请先加入房间');return startLocalAgent(value,{host:credential.hostUrl,nodeId:credential.nodeId,projectId:String(r.body.projectId??''),runId:String(r.body.runId??''),profileDir:profile});});
 app.post<{Body:{projectId?:string;runId?:string;confirmedStopped?:boolean}}>('/api/local/research/agent-reconcile',async r=>{
  const task=await codexTask('inspect',r.body);
  return reconcileLocalAgent(task.directory,r.body.confirmedStopped===true);
 });
 app.post<{Body:{projectId?:string;runId?:string}}>('/api/local/research/codex-take' ,r=>codexTask('take',r.body));
 app.post<{Body:{projectId?:string;runId?:string}}>('/api/local/research/codex-submit',r=>codexTask('submit',r.body));
 const proxyAllowed=(path:string,method:string)=>method==='GET'&&(path.startsWith('/api/sciencepal-team/')||['/api/v1/invite'].includes(path))||method==='POST'&&(/^\/api\/sciencepal-team\/projects\/[^/]+\/commands\/[a-z-]+$/.test(path)||path==='/api/sciencepal-team/projects'||path==='/api/v1/plans')||method==='PUT'&&/^\/api\/v1\/plans\/[^/]+$/.test(path);
 app.all('/api/*',async(r,reply)=>{
  const path=r.url.split('?')[0]!;if(path.includes('/commands/')&&(!browserCommands.has(path.split('/').at(-1)!)||typeof (r.body as any)?.expectedState!=='string'))throw forbidden('操作不受支持或缺少当前快照');if(!proxyAllowed(path,r.method))throw forbidden('本机入口未开放此操作');
  const upstream=await api(r.url,['GET','HEAD'].includes(r.method)?undefined:r.body,r.method);
  if(path==='/api/sciencepal-team/state'&&upstream.ok){const d=await upstream.json() as any;return {...d,browserCommands:true,csrfToken:(r as any).researchCsrf,localResearch:true};}
  for(const h of ['content-type','content-disposition','x-artifact-sha256']){const v=upstream.headers.get(h);if(v)reply.header(h,v);}
  reply.code(upstream.status);return Buffer.from(await upstream.arrayBuffer());
 });
 const web=resolve(options.staticDir??fileURLToPath(new URL('../../../web/dist',import.meta.url)));
 app.get('/*',async(r,reply)=>{const path=resolve(web,'.'+decodeURIComponent(r.url.split('?')[0]!));if(path!==web&&!path.startsWith(web+sep))throw forbidden('路径无效');let file=path;try{if(!(await stat(file)).isFile())file=join(web,'index.html');}catch{file=join(web,'index.html');}reply.type(({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'} as Record<string,string>)[extname(file)]??'application/octet-stream');return readFile(file);});
 const heartbeatTimer=setInterval(()=>{if(!panelHeartbeatBusy){panelHeartbeatBusy=true;void beat().catch(()=>undefined).finally(()=>{panelHeartbeatBusy=false;});}},5000);
 app.addHook('onClose',async()=>{clearInterval(heartbeatTimer);stopWorker();await beat('panel','stopped').catch(()=>undefined);});
 return {app,async listen(){origin=await app.listen({host:'127.0.0.1',port:0});cookieName='vg_research_'+new URL(origin).port;await beat().catch(()=>undefined);return origin;},ticket(){const t=randomBytes(32).toString('hex');tickets.set(t,Date.now()+120_000);return origin+'/open/'+t;},origin:()=>origin};
}
