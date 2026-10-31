import {useResearchReplay,ResearchReplayControls} from "./ResearchReplay";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, FolderGit2, RefreshCw, Users } from "lucide-react";
import { projectNextActions } from "@vibe-git/protocol";
import { phaseLabels, stageProject, type ResearchTarget, type TeamState } from "./research-model";
import "./research-topology.css";
import "./research-github.css";
import {ResearchTopBar,useResearchLocal,type ResearchSection} from "./ResearchTopBar";
import {ResearchWorkbench,type ResearchTaskView} from "./ResearchWorkbench";
import { commandNames, type SendResearchCommand } from "./ResearchCommand";
const sections:ResearchSection[]=["overview","requirements","tasks","changes","settings"];
const sectionFor=(t:ResearchTarget):ResearchSection=>t.type==="protocol"?"requirements":t.type==="member"?"settings":["task","review","handoff"].includes(t.type)?"tasks":"overview";
export function TeamWorkspace() {
 useEffect(()=>{document.documentElement.classList.add('research-github');return()=>document.documentElement.classList.remove('research-github');},[]);
 const [liveState,setState]=useState<TeamState|null>(null),[liveError,setError]=useState(""),[selected,setSelected]=useState("");
 const [replayMode]=useState(()=>import.meta.env.VITE_PUBLIC_REPLAY==="1"||new URLSearchParams(location.search).get("replay")==="1");const replay=useResearchReplay(replayMode);const state=replayMode?replay.state:liveState,error=replayMode?replay.error:liveError;
 const [revision,setRevision]=useState<number|null>(null),[target,setTarget]=useState<ResearchTarget>(()=>new URLSearchParams(location.search).get("section")==="requirements"?{type:"protocol"}:{type:"next"}),[panel,setPanel]=useState(()=>{const q=new URLSearchParams(location.search);return q.has("object")||(!q.has("section")&&!q.has("view"))||["overview","requirements","changes"].includes(q.get("section")??"");});
 const [view,setViewState]=useState<ResearchTaskView>(new URLSearchParams(location.search).get("view")==="gantt"?"list":new URLSearchParams(location.search).get("view")==="topology"?"graph":"table"),[relations,setRelations]=useState<"all"|"handoffs">("all");
 const [section,setSectionState]=useState<ResearchSection>(()=>{const q=new URLSearchParams(location.search),value=q.get("section") as ResearchSection;return sections.includes(value)?value:q.get("object")==="protocol"?"requirements":q.get("object")==="member"?"settings":q.has("view")?"tasks":"overview";});
 const [refreshKey,setRefreshKey]=useState(0);
 const toggle=useRef<HTMLButtonElement>(null);
 const refresh=useCallback(()=>setRefreshKey(k=>k+1),[]);const local=useResearchLocal(refresh,!replayMode);const [topPanel,setTopPanel]=useState("");
 useEffect(()=>{if(topPanel)replay.pause();},[topPanel,replay.pause]);
 const commandLock=useRef(false);const [commandBusy,setCommandBusy]=useState(false),[notice,setNotice]=useState("");
 useEffect(()=>{
  if(replayMode){document.title="Vibe-Git · 真实科研案例回放";return;}
  document.title="Vibe-Git · 多人科研协作";const controller=new AbortController();let pending=false;
  async function refresh(){if(pending)return;pending=true;try{
   const response=await fetch("/api/sciencepal-team/state",{credentials:"same-origin",cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});
   if(!response.ok)throw new Error([401,403].includes(response.status)?"请运行 research:open，打开本人本机工作区。":"团队状态读取失败，请稍后刷新。");
   const data=await response.json();if(controller.signal.aborted)return;setState(data);setError("");
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"连接失败");}finally{pending=false;}}
  void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh();},5000);return()=>{controller.abort();clearInterval(timer);};
 },[refreshKey,replayMode]);
 const setView=(v:ResearchTaskView)=>{replay.pause();setViewState(v);setSectionState("tasks");const u=new URL(location.href);u.searchParams.set("section","tasks");u.searchParams.set("view",v==="list"?"gantt":v==="graph"?"topology":"table");history.pushState(null,"",u);};
 const open=useCallback((t:ResearchTarget)=>{replay.pause();const u=new URL(location.href);u.searchParams.set("section",section);u.searchParams.set("object",t.type);if("id" in t)u.searchParams.set("id",t.id);else u.searchParams.delete("id");const localTab=panel&&["next","protocol","history"].includes(t.type)&&["next","protocol","history"].includes(target.type);if(localTab)history.replaceState(null,"",u);else history.pushState(null,"",u);setTarget(t);setPanel(true);if(window.innerWidth<=760)requestAnimationFrame(()=>document.querySelector(".gh-inspector")?.scrollIntoView({block:"nearest"}));},[replay.pause,section,panel,target.type]);
 useEffect(()=>{if(!replay.step)return;setRevision(null);setTarget(replay.step.focus);setSectionState(sectionFor(replay.step.focus));setPanel(true);const u=new URL(location.href);u.searchParams.set("section",sectionFor(replay.step.focus));u.searchParams.set("object",replay.step.focus.type);if("id" in replay.step.focus)u.searchParams.set("id",replay.step.focus.id);else u.searchParams.delete("id");history.replaceState(null,"",u);},[replay.bundle?.id,replay.step?.id]);
 const close=useCallback(()=>{const u=new URL(location.href);u.searchParams.delete("object");u.searchParams.delete("id");history.replaceState(null,"",u);setPanel(false);toggle.current?.focus();},[]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==="Escape"&&!topPanel)close();};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[close,topPanel]);
 useEffect(()=>{const read=()=>{setTopPanel("");const q=new URLSearchParams(location.search),type=q.get("object"),id=q.get("id");setViewState(q.get("view")==="gantt"?"list":q.get("view")==="topology"?"graph":"table");const s=q.get("section") as ResearchSection;setSectionState(sections.includes(s)?s:type==="protocol"?"requirements":type==="member"?"settings":q.has("view")?"tasks":"overview");if(type&&["next","protocol","history","member","task","review","handoff"].includes(type)){setTarget(id?{type,id} as ResearchTarget:{type} as ResearchTarget);setPanel(true);}else setPanel(false);};const q=new URLSearchParams(location.search);if(q.has("object"))read();window.addEventListener("popstate",read);return()=>window.removeEventListener("popstate",read);},[]);
 const current=state?.projects.find(p=>p.id===selected)??state?.projects[0];
 const p=useMemo(()=>current?stageProject(current,revision??current.revision):undefined,[current,revision]);
 const archived=!!p&&!!current&&p.revision!==current.revision;
 const next=useMemo(()=>p&&state?projectNextActions(p,state.viewer.id):undefined,[p,state]);
 const owners=useMemo(()=>archived?[]:[...new Set(next?.actions.filter(a=>a.kind!=="completed").flatMap(a=>a.ownerNodeId?[a.ownerNodeId]:[])??[])],[next,archived]);
 const send:SendResearchCommand=async(operation,body,snapshot)=>{
  if(commandLock.current)throw new Error("已有操作正在提交，请等待结果。");
  if(replayMode||!state?.csrfToken||!p||archived||error)throw new Error("当前不能操作，请刷新并返回当前版本。");
  commandLock.current=true;setCommandBusy(true);setNotice("");
  try{
   let response:Response;
   try{response=await fetch(`/api/sciencepal-team/projects/${encodeURIComponent(p.id)}/commands/${operation}`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-Vibe-CSRF":state.csrfToken},body:JSON.stringify({...body,expectedState:snapshot}),signal:AbortSignal.timeout(15000)});}catch{throw new Error("提交结果尚未确认，请刷新核对状态；不会自动重试。");}
   const data=await response.json();if(!response.ok)throw new Error(data.error||"操作未完成，请刷新后核对。");
   setNotice(`${commandNames[operation]??operation}操作已提交，进度以当前任务状态为准。`);setRevision(null);
  }finally{commandLock.current=false;setCommandBusy(false);setRefreshKey(k=>k+1);}
 };
 const navigate=(value:ResearchSection)=>{
  replay.pause();setSectionState(value);setTopPanel("");const t:ResearchTarget=value==="requirements"?{type:"protocol"}:{type:"next"};setTarget(t);setPanel(["overview","requirements","changes"].includes(value));
  const u=new URL(location.href);u.searchParams.set("section",value);u.searchParams.delete("id");if(["overview","requirements","changes"].includes(value))u.searchParams.set("object",t.type);else u.searchParams.delete("object");history.pushState(null,"",u);
 };
 const approved=p?.tasks.filter(t=>t.status==="APPROVED").length??0;
 return <div className="rt-shell research-github-shell">
  <ResearchTopBar state={state} {...(p?{p}:{})} section={section} setSection={navigate} open={open} local={local} panel={topPanel} setPanel={setTopPanel} sync={replayMode?"真实记录回放":local.info&&!local.info.configured?"等待加入":error?"正在重连":state?"已同步":"等待接入"} refresh={refresh}/>
  {replayMode&&<ResearchReplayControls replay={replay} onBrief={()=>setTopPanel("project")}/>}
  {state?.interactiveSimulation?<div className="rt-preview">{state.simulationDescription??'模拟体验 · 不调用真实模型'}</div>:state?.preview&&<div className="rt-preview">模拟体验 · 不调用真实模型 <span><a href="?scene=repair">评审退回</a><a href="?scene=completed">返工后完成</a></span></div>}
  {state&&<section className="rt-projectbar gh-project-titlebar"><div className="gh-project-identity"><FolderGit2 size={23}/><div>{state.projects.length>1?<select aria-label="切换研究项目" value={current!.id} onChange={e=>{setSelected(e.target.value);setRevision(null);open({type:"next"});}}>{state.projects.map(v=><option value={v.id} key={v.id}>{v.title}</option>)}</select>:<h1>{p?.title??"科研协作工作区"}</h1>}<p>{p?(archived?"归档快照 · 只读":(phaseLabels[p.phase]??p.phase)+(p.paused?" · 已暂停":"")):"连接本人 Agent，提交研究提案，开始团队协作。"}</p></div><span className="gh-tag">{state.replay?"Replay":"Team"}</span></div><div className="rt-project-actions">{p&&<><span className="gh-completion"><CheckCircle2 size={15}/>{approved} / {p.tasks.length} 项已批准</span><select aria-label="研究协议版本" value={p.revision} onChange={e=>{setRevision(Number(e.target.value));open({type:"next"});}}>{[current!.revision,...current!.history.map(h=>h.revision)].filter((n,i,a)=>a.indexOf(n)===i).sort((a,b)=>b-a).map(r=><option key={r} value={r}>协议 R{r}{r===current!.revision?" · 当前":" · 归档"}</option>)}</select><button onClick={()=>open({type:"protocol"})}>查看协议 <ArrowRight size={13}/></button></>}</div></section>}
  {notice&&p?.phase!=="COMPLETED"&&<div className="rt-command-notice" role="status">{notice}</div>}
  {error&&<div role="alert" className="rt-error-banner">{error}{state?" 当前显示上次快照。":""}</div>}
  {state?<ResearchWorkbench state={state} {...(p?{p}:{})} section={section} view={view} setView={setView} target={target} open={open} close={close} panel={panel} local={local} archived={archived} stale={!!error} busy={commandBusy} send={send} onPanel={setTopPanel} owners={owners} relations={relations} setRelations={setRelations}/>:replayMode?<main className="rt-empty"><h1>{error?"回放暂不可用":"正在读取真实案例…"}</h1><p>{error||"仅加载已保存的真实记录，不启动模型。"}</p>{error&&<button onClick={()=>location.reload()}>重新读取回放</button>}</main>:local.info&&!local.info.configured?<main className="rt-empty"><Users size={32}/><h1>加入团队工作区</h1><p>粘贴队长的邀请链接，使用自己的成员身份与 Agent 开始协作。</p><button className="gh-green-button" onClick={()=>setTopPanel("join")}>加入协作房间</button></main>:<main className="rt-empty"><h1>{error?"暂时无法读取团队":"正在连接协作工作区…"}</h1><button onClick={refresh}><RefreshCw size={14}/>重新连接</button></main>}
 </div>;
}
