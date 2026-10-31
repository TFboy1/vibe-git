import { useMemo } from "react";
import { ReactFlow, ReactFlowProvider, Background, Controls, Handle, Position, BaseEdge, EdgeLabelRenderer, getBezierPath, MarkerType, type Node, type NodeProps, type Edge, type EdgeProps } from "@xyflow/react";
import { FileJson, FlaskConical, ArrowUpRight, CheckCircle2, GitPullRequestArrow, Terminal } from "lucide-react";
import type { SPProject } from "@vibe-git/protocol";
import { Avatar, MemberCard, type MemberData } from "../canvas/TopologyCanvas";
import { connectionSummary, currentMemberRuns, memberForAgent, platformName, researchHandoffs, runLabels, taskDisplay, type ResearchTarget, type ResearchTone, type TeamState } from "./research-model";
import "@xyflow/react/dist/style.css";

type CardData = { title:string; subtitle:string; platform?:string; detail:string; footer:string; id:string; captain?:boolean; own?:boolean; attention?:boolean; tone:ResearchTone; selected:boolean; open:()=>void; member?:boolean; status:string; card?:MemberData };
const colors: Record<ResearchTone,string> = { neutral:"var(--muted)",active:"var(--blue)",approved:"var(--green)",attention:"var(--amber)",blocked:"var(--red)" };
function ResearchCard({data:d}:NodeProps<Node<CardData>>) {
  return <div className={`rt-node ${d.member ? "rt-member" : "rt-task"} tone-${d.tone} ${d.selected ? "is-selected" : ""}`}>
    <Handle type="target" position={Position.Top} id="in-top" />
    <Handle type="target" position={Position.Left} id="in-left" /><Handle type="target" position={Position.Right} id="in-right" />
    <Handle type="source" position={Position.Left} id="out-left" /><Handle type="source" position={Position.Right} id="out-right" /><Handle type="source" position={Position.Bottom} id="out-bottom" />
    {d.card?<MemberCard data={d.card}/>:<button className="rt-node-button nodrag" onClick={d.open} aria-label={`${d.member ? "查看成员" : "查看任务"} ${d.title}`}>
      <div className="rt-node-heading">{d.member ? <Avatar id={d.id} captain={!!d.captain}/> : <span className="rt-task-symbol"><FileJson size={19}/></span>}
        <div><strong>{d.title}</strong><small>{d.subtitle}</small></div><ArrowUpRight size={14} className="rt-node-arrow"/></div>
      {d.member && <div className={`rt-platform ${d.platform === "Codex" ? "codex" : "sciencepal"}`}>{d.platform === "Codex" ? <Terminal size={13}/> : <FlaskConical size={13}/>} {d.platform}<span>{d.platform === "Codex" ? "本地执行" : "科研 Agent"}</span></div>}
      <p className="rt-node-detail">{d.detail}</p>
      <div className="rt-node-footer"><span className={`rt-status tone-${d.tone}`}><i/>{d.status}</span><small>{d.footer}</small></div>
      {d.attention && <span className="rt-owner-flag">现在轮到{d.own ? "我" : "此成员"}</span>}
    </button>}
  </div>;
}
type LinkData = { label:string; detail:string; tone:ResearchTone; kind:"assignment"|"handoff"|"review"; open:()=>void; selected:boolean; labelOffset?:number };
function ResearchLink(props:EdgeProps<Edge<LinkData>>) {
  const d=props.data!;
  const [path,x,y]=getBezierPath({...props,curvature:d.kind === "review" ? .32 : .18});
  return <><BaseEdge id={props.id} path={path} {...(props.markerEnd?{markerEnd:props.markerEnd}:{})} interactionWidth={25} style={{stroke:colors[d.tone],strokeWidth:d.selected?2.8:1.6,strokeDasharray:d.tone === "neutral" ? "5 5" : undefined,opacity:d.kind === "assignment"?.42:.9}}/>
    {d.kind !== "assignment" && <EdgeLabelRenderer><button className={`rt-edge-label nodrag nopan tone-${d.tone} ${d.selected?"selected":""}`} style={{transform:`translate(-50%,-50%) translate(${x}px,${y+(d.labelOffset??0)}px)`}} onClick={d.open} aria-label={`${d.kind === "handoff" ? "查看文件交接" : "查看评审"} ${d.label} ${d.detail}`}>
      {d.kind === "handoff" ? <FileJson size={12}/> : <GitPullRequestArrow size={12}/>}<span>{d.label}<small>{d.detail}</small></span>
    </button></EdgeLabelRenderer>}</>;
}
const nodeTypes={research:ResearchCard},edgeTypes={research:ResearchLink};
export function ResearchTopology({state,project,target,open,owners,relations,archived}:{state:TeamState;project:SPProject;target:ResearchTarget;open:(t:ResearchTarget)=>void;owners:string[];relations:"all"|"handoffs";archived:boolean}) {
  const {nodes,edges}=useMemo(()=>{
    const members=project.team?.members??[],nodes:Node<CardData>[]=[],edges:Edge<LinkData>[]=[];
    const taskPosition=new Map<string,{x:number;y:number}>();
    members.forEach((m,index)=>{
      const tasks=project.tasks.filter(t=>t.assigneeAgentId===m.agent.id),runs=currentMemberRuns(project,m.nodeId),waiting=owners.includes(m.nodeId)&&!archived;
      const connection=connectionSummary(state,project,m.nodeId);
      const needsInput=runs.some(r=>r.status==="NEEDS_INPUT"||r.status==="UNKNOWN");
      const tone:ResearchTone=needsInput?"attention":waiting?"attention":runs.length?"active":tasks.length&&tasks.every(t=>t.status==="APPROVED")?"approved":"neutral";
      nodes.push({id:`member:${m.nodeId}`,type:"research",position:{x:index*430,y:40},width:282,selectable:false,data:{card:{id:m.nodeId,name:m.label,role:m.nodeId===project.team?.captainNodeId?"captain":"member",branch:platformName(m.agent),online:connection.online,...(state.replay?{presenceLabel:"历史成员"}:{}),tone:needsInput||waiting?"blocked":runs.length?"running":tasks.length&&tasks.every(t=>t.status==="APPROVED")?"done":"waiting",text:connection.blocker,pulse:false,done:tasks.filter(t=>t.status==="APPROVED").length,total:tasks.length,pr:0,plan:project.proposals.some(v=>v.ownerNodeId===m.nodeId)?"已提交":"未提交",own:m.nodeId===state.viewer.id,collaborations:1,open:()=>open({type:"member",id:m.nodeId})},id:m.nodeId,title:m.label,subtitle:`${m.nodeId===project.team?.captainNodeId?"队长":"研究成员"}${m.nodeId===state.viewer.id?" · 我":""}`,platform:platformName(m.agent),member:true,captain:m.nodeId===project.team?.captainNodeId,own:m.nodeId===state.viewer.id,attention:waiting,tone,
        detail:tasks[0]?.title??(m.agent.id===project.coordinatorId?"研究协议对齐与变更评审":"等待协议发布后分配研究任务"),status:archived?"归档记录":needsInput?"等待本人处理":waiting?"有待办":runs.length?(runLabels[runs[0]!.status]??"处理中"):tasks.length&&tasks.every(t=>t.status==="APPROVED")?"本轮已交付":"等待分工 / 上游",footer:`${tasks.filter(t=>t.status==="APPROVED").length}/${tasks.length} 项获批`,selected:target.type==="member"&&target.id===m.nodeId,open:()=>open({type:"member",id:m.nodeId})}});
      tasks.forEach((t,row)=>taskPosition.set(t.key,{x:index*430,y:355+row*205}));
    });
    const add=(id:string,source:string,targetId:string,sourceHandle:string,targetHandle:string,data:LinkData)=>edges.push({id,source,target:targetId,sourceHandle,targetHandle,type:"research",data,markerEnd:{type:MarkerType.ArrowClosed,color:colors[data.tone],width:16,height:16},selectable:false});
    for(const task of project.tasks){
      const owner=memberForAgent(project,task.assigneeAgentId),reviewer=memberForAgent(project,task.reviewerAgentId),position=taskPosition.get(task.key)??{x:0,y:355};
      nodes.push({id:`task:${task.key}`,type:"research",position,width:282,selectable:false,data:{id:task.key,title:task.title,subtitle:`${task.key} · ${task.attempt?`第 ${task.attempt} 次执行`:"尚未开始"}`,detail:`评审：${reviewer?.label??"未分配"}${task.status==="REVIEWING"?" · 复核中":task.status==="APPROVED"?" · 通过":task.review?" · 尚未放行":" · 独立复核"}`,status:taskDisplay(project,task).label,footer:task.outputFilename,tone:taskDisplay(project,task).tone,selected:(target.type==="task"||target.type==="review")&&target.id===task.key,open:()=>open({type:"task",id:task.key})}});
      if(owner)add(`owner:${task.key}`,`member:${owner.nodeId}`,`task:${task.key}`,"out-bottom","in-top",{label:"本人执行",detail:"",kind:"assignment",tone:"neutral",selected:false,open:()=>open({type:"task",id:task.key})});
      if(relations==="all"&&task.reviewId&&reviewer&&owner){
        const forward=members.findIndex(m=>m.nodeId===reviewer.nodeId)>members.findIndex(m=>m.nodeId===owner.nodeId);
        const rejected=task.status==="CHANGES_REQUESTED";
        add(`review:${task.key}`,rejected?`member:${reviewer.nodeId}`:`task:${task.key}`,rejected?`task:${task.key}`:`member:${reviewer.nodeId}`,forward!==rejected?"out-right":"out-left",forward!==rejected?"in-left":"in-right",{kind:"review",labelOffset:forward?-32:32,label:rejected?"评审退回":task.status==="APPROVED"?"独立评审通过":task.status==="REVIEWING"&&task.review?"补充证据复审":"正在独立评审",detail:reviewer.label,tone:rejected?"attention":task.status==="APPROVED"?"approved":"active",selected:target.type==="review"&&target.id===task.key,open:()=>open({type:"review",id:task.key})});
      }
    }
    for(const h of researchHandoffs(project)){
      const a=taskPosition.get(h.from.key)!,b=taskPosition.get(h.to.key)!;const right=b.x>a.x,same=b.x===a.x;
      add(`handoff:${h.id}`,`task:${h.from.key}`,`task:${h.to.key}`,same?"out-bottom":right?"out-right":"out-left",same?"in-top":right?"in-left":"in-right",{label:h.filename,detail:h.label,kind:"handoff",tone:h.tone,selected:target.type==="handoff"&&target.id===h.id,open:()=>open({type:"handoff",id:h.id})});
    }
    return {nodes,edges};
  },[project,state,target,open,owners,relations,archived]);
  return <ReactFlowProvider key={nodes.length}><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{padding:.18,maxZoom:1}} minZoom={.3} maxZoom={1.5} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{hideAttribution:false}} colorMode="light" ariaLabelConfig={{"controls.zoomIn.ariaLabel":"放大画布","controls.zoomOut.ariaLabel":"缩小画布","controls.fitView.ariaLabel":"适应画布"}}>
    <Background color="var(--line)" gap={24} size={1}/><Controls showInteractive={false}/>
  </ReactFlow></ReactFlowProvider>;
}
