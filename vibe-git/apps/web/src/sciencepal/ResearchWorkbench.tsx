import {ArrowRight,BookOpen,CheckCircle2,Circle,CircleDot,FileText,GitBranch,GitPullRequest,LayoutList,Network,Users} from 'lucide-react';
import {Fragment,useState} from 'react';
import {Markdown} from '../Markdown';
import type {SPProject} from '@vibe-git/protocol';
import {ResearchInspector} from './ResearchInspector';
import {ResearchTopology} from './ResearchTopology';
import {ResearchGantt} from './ResearchGantt';
import {ResearchRoom} from './ResearchRoom';
import {memberForAgent,platformName,taskDisplay,type ResearchTarget,type TeamState} from './research-model';
import type {LocalResearch,ResearchSection} from './ResearchTopBar';
import type {SendResearchCommand} from './ResearchCommand';

export type ResearchTaskView='table'|'graph'|'list';
interface Props {
 state:TeamState;p?:SPProject;section:ResearchSection;view:ResearchTaskView;
 setView:(v:ResearchTaskView)=>void;target:ResearchTarget;open:(t:ResearchTarget)=>void;
 close:()=>void;panel:boolean;local:LocalResearch;archived:boolean;stale:boolean;
 busy:boolean;send:SendResearchCommand;onPanel:(name:string)=>void;owners:string[];
 relations:'all'|'handoffs';setRelations:(v:'all'|'handoffs')=>void;
}
function TaskList({p,open}:{p:SPProject;open:Props['open']}) {
 return <section className="gh-paper gh-task-list" aria-label="科研任务列表">
  <header className="gh-paper-header"><span><ListTodoIcon/><strong>研究任务</strong><span className="research-nav-count">{p.tasks.length}</span></span><small>R{p.revision} · 按依赖交接</small></header>
  {!p.tasks.length?<div className="gh-empty"><Circle size={24}/><h3>还没有发布任务</h3><p>冻结提案、完成协议对齐，再由队长发布研究任务。</p></div>:<div className="gh-task-rows">{p.tasks.map(t=>{
   const d=taskDisplay(p,t),Icon=t.status==='APPROVED'?CheckCircle2:d.tone==='active'?CircleDot:Circle;
   return <button key={t.key} className="gh-task-row" onClick={()=>open({type:'task',id:t.key})}>
    <Icon size={18} className={`gh-status-${d.tone}`}/><span className="gh-task-description"><strong>{t.title}</strong><small><code>{t.key}</code> · {t.outputFilename} · {t.dependencies.length?`依赖 ${t.dependencies.join('、')}`:'无上游依赖'}</small></span>
    <span className="gh-task-owner">{memberForAgent(p,t.assigneeAgentId)?.label??'未分配'}<small>评审：{memberForAgent(p,t.reviewerAgentId)?.label??'待分配'}</small></span><span className={`gh-tag gh-status-${d.tone}`}>{d.label}</span>
   </button>;
  })}</div>}
 </section>;
}
function ListTodoIcon(){return <LayoutList size={17}/>;}
function MemberList({state,onPanel,p,open}:{state:TeamState;onPanel:Props['onPanel'];p?:SPProject;open:Props['open']}){
 const [expanded,setExpanded]=useState<string|null>(null);
 return <section className="gh-paper" aria-label="协作成员列表"><header className="gh-paper-header"><span><Users size={17}/><strong>协作成员</strong><span className="research-nav-count">{state.members.length}</span></span><button onClick={()=>onPanel('compute')}>我的 Agent <ArrowRight size={13}/></button></header>
  <div className="gh-table-scroll"><table className="gh-members-table"><thead><tr><th>成员</th><th>执行平台</th><th>研究提案</th><th>连接状态</th></tr></thead><tbody>{state.members.map(m=><Fragment key={m.id}><tr>
   <td><button className="gh-link" onClick={()=>p?.team?.members.some(member=>member.nodeId===m.id)?open({type:'member',id:m.id}):setExpanded(id=>id===m.id?null:m.id)}>{m.label}</button><small>{m.role==='captain'?'队长':'成员'}{m.id===state.viewer.id?' · 我':''}</small></td>
   <td>{m.binding?platformName(m.binding.agent):'尚未绑定'}</td><td>{m.plan?<span className="gh-status-approved">已保存 · r{m.plan.revision}</span>:'等待提交'}</td><td><span className="gh-presence"><i className={m.presence?.panel.state==='online'?'online':''}/>{m.presence?.panel.state==='online'?'本机入口在线':'本机入口未连接'}</span></td>
  </tr>{expanded===m.id&&<tr><td colSpan={4}><div className="gh-member-proposal"><h3>{m.label}的研究提案</h3>{m.plan?<Markdown>{m.plan.content}</Markdown>:<p>该成员尚未提交研究提案。</p>}{m.id===state.viewer.id&&<button onClick={()=>onPanel('plan')}>编辑我的提案</button>}</div></td></tr>}</Fragment>)}</tbody></table></div>
 </section>;
}
function About({state,p,onPanel,open}:{state:TeamState;p?:SPProject;onPanel:Props['onPanel'];open:Props['open']}){
 const approved=p?.tasks.filter(t=>t.status==='APPROVED').length??0;
 return <aside className="gh-about" aria-label="研究项目信息">
  <section><h2>关于此研究</h2><p>在同一份研究协议下，协作执行、独立复核，并交接获批的科研成果。</p><span className="gh-tag">{state.replay?'历史记录 · 只读':state.interactiveSimulation?'模拟演练':'科研协作'}</span>
   <dl><div><dt><Users size={15}/>参与成员</dt><dd>{p?.team?.members.length??state.members.length}</dd></div><div><dt><FileText size={15}/>研究协议</dt><dd>{p?`R${p.revision}`:'未建立'}</dd></div><div><dt><CheckCircle2 size={15}/>获批任务</dt><dd>{approved} / {p?.tasks.length??0}</dd></div><div><dt><GitBranch size={15}/>作业记录</dt><dd>{p?.runs.length??0}</dd></div></dl>
  </section>
  <section><h2>参与者</h2><div className="gh-participants">{state.members.filter(m=>!p||p.team?.members.some(t=>t.nodeId===m.id)).map(m=><button key={m.id} title={m.label} disabled={!p} onClick={()=>p&&open({type:'member',id:m.id})}><span>{m.label.slice(0,1).toUpperCase()}</span><b>{m.label}</b><small>{m.binding?platformName(m.binding.agent):'待接入'}</small></button>)}</div></section>
  <section><h2>资料与接入</h2><button className="gh-link" onClick={()=>p?open({type:'protocol'}):onPanel('plan')}><BookOpen size={16}/>{p?'查看冻结协议与来源':'编写我的研究提案'}</button><button className="gh-link" onClick={()=>onPanel('help')}><FileText size={16}/>接入与使用说明</button><button className="gh-link" onClick={()=>onPanel('compute')}><Network size={16}/>管理本人 Agent</button>{state.viewer.role==='captain'&&<button className="gh-link" onClick={()=>onPanel('invite')}><Users size={16}/>邀请协作成员</button>}</section>
  <section className="gh-handoff-note"><h2>交接规则</h2><p>成果通过冻结检查和独立评审后，才能进入下游。数值检查依赖已配置的参考与容差。</p></section>
 </aside>;
}
export function ResearchWorkbench(props:Props){
 const {state,p,section,view,setView,target,open,close,panel,local,archived,stale,busy,send,onPanel,owners,relations,setRelations}=props;
 const inspector=p&&<ResearchInspector local={local} state={state} p={p} target={target} open={open} close={close} onConnect={()=>onPanel('compute')} archived={archived} stale={stale} busy={busy} send={send}/>;
 const details=panel&&p?<div className="gh-inspector">{inspector}</div>:p?<button className="gh-open-actions" onClick={()=>open({type:'next'})}>查看当前待办与操作 <ArrowRight size={14}/></button>:null;
 const step=!p?0:p.phase==='COMPLETED'?3:p.tasks.length?2:p.phase==='READY'?1:0;
 return <div className="gh-research-page">
  <div className="gh-phase-rail" aria-label="科研协作流程">{['提案与协议','确认并发布','执行与评审','成果交接'].map((label,i)=><div key={label} className={i===step?'current':i<step?'completed':''} aria-current={i===step?'step':undefined}><span>{i<step?'✓':i+1}</span>{label}{i<3&&<i/>}</div>)}</div>
  <div className="gh-repository-columns"><main className="gh-main-content">
   {section==='overview'&&<>
    <div className="gh-section-heading"><div><h2>工作台</h2><p>当前行动与团队进度</p></div>{!state.replay&&<button onClick={()=>onPanel(state.viewer.role==='captain'?'project':'plan')}>{state.viewer.role==='captain'?'科研项目':'我的提案'}</button>}</div>
    {p?details:<section className="gh-paper gh-get-started"><header className="gh-paper-header"><strong>开始一项协作研究</strong></header><div><h2>先准备好你的研究工作区</h2><p>每位成员使用本人的 Agent，保存提案后，由队长冻结共同输入并发布研究协议。</p><div className="gh-onboarding-actions"><button className="gh-green-button" onClick={()=>onPanel('compute')}>接入我的 Agent</button><button onClick={()=>onPanel('plan')}>保存我的提案</button>{state.viewer.role==='captain'&&<button onClick={()=>onPanel('project')}>建立科研项目</button>}</div></div></section>}
    {p&&<TaskList p={p} open={open}/>}<MemberList state={state} onPanel={onPanel} {...(p?{p}:{})} open={open}/>
   </>}
   {section==='requirements'&&<>
    <div className="gh-section-heading"><div><h2>研究需求</h2><p>个人提案、冻结输入、方法约束与验收标准</p></div><button onClick={()=>onPanel('plan')}>我的提案</button></div>
    {p?details:<section className="gh-paper gh-get-started"><div><h2>从每位成员的提案开始</h2><p>写清研究问题、输入、分工、方法、交付与验收，保存到自己的成员身份。</p><button className="gh-green-button" onClick={()=>onPanel('plan')}>编写我的提案</button></div></section>}
    <MemberList state={state} onPanel={onPanel} {...(p?{p}:{})} open={open}/>
   </>}
   {section==='tasks'&&<>
    <div className="gh-section-heading"><div><h2>任务与分工</h2><p>执行、评审、返工及获批文件的交接</p></div>{p&&<button onClick={()=>open({type:'next'})}>当前待办 <ArrowRight size={14}/></button>}</div>
    <div className="gh-task-views" aria-label="任务视图"><button aria-pressed={view==='table'} onClick={()=>setView('table')}><LayoutList size={15}/>任务清单</button><button aria-pressed={view==='graph'} onClick={()=>setView('graph')}><Network size={15}/>人员拓扑</button><button aria-pressed={view==='list'} onClick={()=>setView('list')}><GitBranch size={15}/>项目甘特</button></div>
    {p?(view==='table'?<TaskList p={p} open={open}/>:<div className="gh-paper gh-canvas-panel">{view==='graph'&&<div className="gh-canvas-controls"><button aria-pressed={relations==='all'} onClick={()=>setRelations('all')}>全部关系</button><button aria-pressed={relations==='handoffs'} onClick={()=>setRelations('handoffs')}>只看文件交接</button></div>}<div className="gh-canvas">{view==='graph'?<ResearchTopology key={`${p.id}:${p.revision}`} state={state} project={p} target={target} open={open} owners={owners} relations={relations} archived={archived}/>:<ResearchGantt p={p} viewerId={state.viewer.id} open={open}/>}</div></div>):view==='table'?<section className="gh-paper gh-empty"><ListTodoIcon/><h3>尚未建立项目</h3><p>成员就绪后，由队长建立项目、对齐并发布任务。</p></section>:<div className="gh-canvas-panel"><ResearchRoom state={state} onPanel={onPanel} view={view}/></div>}
    {p&&details}
   </>}
   {section==='changes'&&<>
    <div className="gh-section-heading"><div><h2>研究变更</h2><p>评审影响范围，保留原文与历史版本，再由队长确认应用。</p></div>{p&&<button onClick={()=>open({type:'next'})}>变更与项目操作 <ArrowRight size={14}/></button>}</div>
    <section className="gh-paper"><header className="gh-paper-header"><span><GitPullRequest size={17}/><strong>变更记录</strong><span className="research-nav-count">{p?.changes.length??0}</span></span></header>{p?.changes.length?<div>{[...p.changes].reverse().map(c=><article className="gh-change-row" key={c.id}><GitPullRequest size={18}/><div><strong>{c.request}</strong><small>基于 R{c.baseRevision}{c.result?.affectedTaskKeys.length?` · 影响 ${c.result.affectedTaskKeys.join('、')}`:''}</small></div><span className="gh-tag">{({REVIEWING:'评审中',ACCEPTED:'等待确认',REJECTED:'已拒绝',APPLIED:'已应用',DISMISSED:'已关闭'} as Record<string,string>)[c.status]??c.status}</span></article>)}</div>:<div className="gh-empty"><GitPullRequest size={24}/><h3>暂无研究变更</h3><p>在稳定阶段提出变更，由影响评审确认哪些成果需要更新。</p></div>}</section>{details}
   </>}
   {section==='settings'&&<>
    <div className="gh-section-heading"><div><h2>算力与团队设置</h2><p>各自管理平台绑定、个人连接器和本机身份</p></div><button className="gh-green-button" onClick={()=>onPanel('compute')}>管理我的 Agent</button></div>
    <MemberList state={state} onPanel={onPanel} {...(p?{p}:{})} open={open}/>
    <section className="gh-paper gh-settings-list"><div><span><strong>本人工作区</strong><small>查看本机连接状态与原版软件协作入口。</small></span><button onClick={()=>onPanel('workspace')}>查看工作区</button></div><div><span><strong>接入与恢复指南</strong><small>加入房间、运行任务、原线程答复与错误处理。</small></span><button onClick={()=>onPanel('help')}>查看说明</button></div>{state.viewer.role==='captain'&&<div><span><strong>邀请成员</strong><small>分享协作邀请，成员使用各自账号和本机入口。</small></span><button onClick={()=>onPanel('invite')}>邀请成员</button></div>}</section>
    {p&&panel&&details}
   </>}
  </main><About state={state} {...(p?{p}:{})} onPanel={onPanel} open={open}/></div>
  <footer className="gh-research-footer"><span className="gh-footer-brand">vg</span>Vibe-Git Research<span>协议 · 评审 · 可核查的成果交接</span></footer>
 </div>;
}
