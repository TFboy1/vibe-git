import {randomUUID} from "node:crypto";
import {readFile,writeFile,lstat,rename} from "node:fs/promises";
import {join} from "node:path";
import {AgentExecutor} from "@vibe-git/relay/agent-executor";
import {AgentRegistry} from "@vibe-git/relay/agent-registry";
import {isLocalResearchPlatform,type ExecutionCommand,type SPProject} from "@vibe-git/protocol";
import {badRequest,revisionConflict} from "../domain/errors.js";
import {managedCodexTask} from "./local-codex.js";
import type {MemberRequest} from "./member-connector.js";
type Context=Parameters<typeof managedCodexTask>[2];
export interface AgentRunState {state:"STARTING"|"RUNNING"|"COMPLETED"|"FAILED"|"INTERRUPTED"|"NEEDS_INPUT";platform:string;at:string;detail:string;runtimeId?:string;transport?:string;recovery?:{at:string;previousState:string;confirmedStopped:true}}
const activeRuns=new Set<string>();
export const localAgentActive=(directory:string)=>activeRuns.has(directory);
async function saveAgentState(directory:string,state:AgentRunState){
 const marker=join(directory,"adapter-run.json"),s=await lstat(marker);if(!s.isFile()||s.isSymbolicLink())throw badRequest("执行记录已变化");
 const temp=join(directory,`.adapter-run-${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(state),{flag:"wx",mode:0o600});await rename(temp,marker);
}
export async function agentRunState(directory:string):Promise<AgentRunState|null>{
 const path=join(directory,"adapter-run.json");
 try{const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.size>8192)throw badRequest("执行记录不是普通文件");try{return JSON.parse(await readFile(path,"utf8"));}catch(e){if(e instanceof SyntaxError)return {state:"STARTING",platform:"unknown",at:"",detail:"执行记录正在写入或不完整，请核对原任务；不会重复启动"};throw e;}}
 catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}
}
/** Explicit owner reconciliation preserves the dispatch marker and never launches again. */
export async function reconcileLocalAgent(directory:string,confirmedStopped:boolean){
 if(!confirmedStopped)throw badRequest("请先核对原 Agent 进程已停止，再确认恢复交回");
 if(localAgentActive(directory))throw revisionConflict("原 Agent 仍在本入口执行，不能恢复交回");
 const previous=await agentRunState(directory);if(!previous)throw badRequest("没有需要恢复的执行记录");
 if(!["STARTING","RUNNING"].includes(previous.state))return previous;
 const state:AgentRunState={...previous,state:"INTERRUPTED",detail:"本人已确认原 Agent 停止；请从原任务包继续，成果仍须校验与评审",recovery:{at:new Date().toISOString(),previousState:previous.state,confirmedStopped:true}};
 await saveAgentState(directory,state);return state;
}
/** Durable single-dispatch marker prevents duplicate model runs after a lost response/restart. */
export async function startLocalAgent(request:MemberRequest,context:Context,registry=new AgentRegistry(),env:NodeJS.ProcessEnv=process.env){
 const p=await request<SPProject>(`/api/sciencepal-team/projects/${context.projectId}`),run=p.runs.find(r=>r.id===context.runId);
 if(p.paused||["BLOCKED","CHANGES_REQUESTED","COMPLETED"].includes(p.phase)||!run||!["READY","RUNNING"].includes(run.status)||!isLocalResearchPlatform(run.agent.platform))throw revisionConflict("当前任务不可启动，请检查最新待办");
 const info=await managedCodexTask("inspect",request,context);
 if(!info.prepared)throw badRequest("请先准备本人任务包");
 const previous=await agentRunState(info.directory);if(previous)throw revisionConflict("此任务已有执行记录；请核对原任务或复制任务说明继续，不会重复启动");
 const runtimeEnv:NodeJS.ProcessEnv={...env,VIBE_AGENT:run.agent.platform};
 for(const key of Object.keys(runtimeEnv))if(key.startsWith("SCIENCEPAL_")||key.startsWith("VIBE_GIT_")||key==="NODE_TOKEN")delete runtimeEnv[key];
 const executor=new AgentExecutor(registry,runtimeEnv);
 if(executor.probe.state==="unsupported")throw badRequest(executor.probe.detail+"；可复制下方任务说明到本人 Agent 执行");
 if(run.agent.platform==="cursor")throw badRequest("Cursor 无交互模式默认不能写文件；请复制任务说明到本人 Cursor，由本人确认执行权限");
 const reportFailed=async()=>{const task=JSON.parse(await readFile(join(info.directory,"task.json"),"utf8"));await request(`/api/sciencepal-team/projects/${context.projectId}/runs/${context.runId}/failed-local`,{claimId:task.claimId});};
 const marker=join(info.directory,"adapter-run.json");
 let state:AgentRunState={state:"STARTING",platform:run.agent.platform,at:new Date().toISOString(),detail:"启动中；中断后先核对原任务，不重复派发"};
 await writeFile(marker,JSON.stringify(state),{flag:"wx",mode:0o600}).catch(()=>{throw revisionConflict("已有本次执行记录，请核对原任务");});
 const save=()=>saveAgentState(info.directory,state);
 activeRuns.add(info.directory);
 let dispatched=false;
 try {
  const handle=await executor.start({prompt:await readFile(info.instructions,"utf8"),transportRequested:"auto"} as ExecutionCommand,info.directory);
  if(handle.transport==="cloud")throw Error("本地平台不能启动云端运行");
  dispatched=true;
  state={...state,state:"RUNNING",runtimeId:handle.runtimeId,transport:handle.transport,detail:"本人 Agent 正在执行；成果完成后仍须点击检查并交回"};
  try{await save();}finally{
   void handle.done.then(async completion=>{state={...state,state:completion.status,detail:completion.status==="COMPLETED"?"执行结束，请检查并交回成果；尚未通过科研校验或评审":"执行未完成，请从原任务包继续并核对成果"};await save();if(["FAILED","INTERRUPTED"].includes(completion.status))await reportFailed();}).catch(()=>{/* Retain uncertain marker; never re-dispatch silently. */}).finally(()=>activeRuns.delete(info.directory));
  }
  return state;
 }catch(e){if(dispatched)throw e;activeRuns.delete(info.directory);const safe=e&&typeof e==="object"&&"safeToRetry" in e&&e.safeToRetry===true;state={...state,state:safe?"FAILED":"STARTING",detail:safe?"启动明确失败，请从原任务包继续；不会自动重复启动":"启动结果未知；请核对原进程，确认停止后恢复交回"};await save();if(safe)await reportFailed();throw e;}
}
