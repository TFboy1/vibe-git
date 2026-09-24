import { File, FileCheck2 } from "lucide-react";
import { useEffect, useMemo, useState, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  Panel,
  useReactFlow,
  useViewport,
  useStore,
  type Node,
  type NodeProps,
  type Viewport,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { V20BootstrapPayload } from "@vibe-git/protocol";
import {
  deriveTopologyLayout,
  derivePackageParticipants,
  derivePackageProgress,
  deriveMemberVisualState,
  liveTasks,
  label,
  type InspectorTarget,
} from "./model";
export function Avatar({
  id,
  captain = false,
}: {
  id: string;
  captain?: boolean;
}) {
  let seed = 2166136261;
  for (const c of id) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
  const cells = [];
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++) {
      seed = Math.imul(seed ^ (seed >>> 13), 1597334677);
      if (seed & 1) {
        cells.push(
          <rect
            key={`${x}-${y}`}
            x={x * 8 + 6}
            y={y * 8 + 6}
            width="7"
            height="7"
          />,
        );
        if (x !== 2)
          cells.push(
            <rect
              key={`${4 - x}-${y}`}
              x={(4 - x) * 8 + 6}
              y={y * 8 + 6}
              width="7"
              height="7"
            />,
          );
      }
    }
  return (
    <span className={`avatar ${captain ? "captain-avatar" : ""}`}>
      <svg viewBox="0 0 52 52" aria-hidden="true">
        {cells}
      </svg>
    </span>
  );
}
type MemberData = {
  id: string;
  name: string;
  role: string;
  branch: string;
  online: boolean;
  tone: string;
  text: string;
  pulse: boolean;
  done: number;
  total: number;
  pr: number;
  plan: string;
  own: boolean;
  collaborations: number;
  open: (tab?: string) => void;
};
function MemberNode({ data: d }: NodeProps<Node<MemberData>>) {
  return (
    <button
      className={`member-node ${d.tone} ${d.pulse ? "pulse" : ""} ${d.online ? "" : "offline"}`}
      onClick={() => d.open()}
    >
      <Avatar id={d.id} captain={d.role === "captain"} />
      <div>
        <strong>{d.name}</strong>
        <small>
          <i className={`online-dot ${d.online ? "" : "is-offline"}`} />
          {d.role === "captain" ? "队长" : "成员"} ·{" "}
          {d.online ? "在线" : "离线"}
        </small>
        <span onClick={d.own && d.plan === "未提交" ? e => { e.stopPropagation(); d.open("plan"); } : undefined}>
          {d.own && d.plan === "未提交" ? "提交提案 · " : ""}
          {d.text} · {d.done}/{d.total}
        </span>
        <code title={d.branch}>{d.branch || "未连接工作区"}</code>
      </div>
      <span className="node-badges">
        <span
          className={
            d.plan === "影响待核实"
              ? "change"
              : d.plan === "有新修订"
                ? "running"
                : ""
          }
          title={d.plan}
        >
          {d.plan === "未提交" ? <File size={12} aria-hidden="true" /> : <FileCheck2 size={12} aria-hidden="true" />}
        </span>
        {d.pr > 0 && <b>{d.pr} PR</b>}
      </span>
      {d.collaborations > 1 && (
        <span
          className="collaboration-count"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              d.open("packages");
            }
          }}
          onClick={(e) => {
            e.stopPropagation();
            d.open("packages");
          }}
        >
          +{d.collaborations - 1} 协作
        </span>
      )}
    </button>
  );
}
function GroupNode({
  data,
}: NodeProps<Node<{ name: string; summary: string; open: () => void }>>) {
  return (
    <div className="package-frame">
      <button onClick={data.open}>
        <small>工作包协作</small>
        <strong>{data.name}</strong>
        <span>{data.summary}</span>
      </button>
    </div>
  );
}
const nodeTypes = { member: MemberNode, package: GroupNode };
const fitPadding = { top: "24px", right: "24px", bottom: "175px", left: "24px" } as const;
function Controls({
  layoutKey,
  drawer,
  active,
}: {
  layoutKey: string;
  drawer: boolean;
  active: boolean;
}) {
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const last = useRef("");
  useEffect(() => {
    const key = `${layoutKey}:${drawer}:${width}:${height}`;
    if (!active || !width || !height || last.current === key) return;
    const t = setTimeout(
      () => {
        last.current = key;
        void flow.fitView({
          padding: fitPadding,
          duration: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? 0
            : 280,
          maxZoom: 1,
        });
      },
      440,
    );
    return () => clearTimeout(t);
  }, [layoutKey, drawer, flow, active, width, height]);
  return (
    <Panel position="bottom-left" className="canvas-controls">
      <button onClick={() => void flow.zoomOut()} aria-label="缩小">
        −
      </button>
      <button
        onClick={() =>
          void flow.setViewport({ ...flow.getViewport(), zoom: 1 })
        }
      >
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={() => void flow.zoomIn()} aria-label="放大">
        ＋
      </button>
      <button onClick={() => void flow.fitView({ padding: fitPadding, maxZoom: 1 })}>
        适应画布
      </button>
    </Panel>
  );
}
export function TopologyCanvas({
  data,
  open,
  drawer,
  seen,
  active,
}: {
  data: V20BootstrapPayload;
  open: (t: InspectorTarget) => void;
  drawer: boolean;
  seen: Set<string>;
  active: boolean;
}) {
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  const [focus, setFocus] = useState("");
  const [search, setSearch] = useState("");
  const [maxColumns, setMaxColumns] = useState(() => innerWidth < 1200 ? 3 : 4);
  const [compactNodes, setCompactNodes] = useState(() => innerWidth < 768);
  useEffect(() => {
    const resize = () => {
      setMaxColumns(innerWidth < 1200 ? 3 : 4);
      setCompactNodes(innerWidth < 768);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const [legend, setLegend] = useState(true);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const previous = useRef(new Map<string, string>());
  useEffect(() => {
    const owners = new Set<string>();
    for (const change of data.pullRequests) {
      if (
        previous.current.has(change.id) &&
        previous.current.get(change.id) !== "APPLIED" &&
        change.status === "APPLIED"
      )
        owners.add(change.submitterNodeId);
      previous.current.set(change.id, change.status);
    }
    if (owners.size) setConfirmed(owners);
  }, [data.pullRequests]);
  useEffect(() => {
    if (!confirmed.size) return;
    const timer = setTimeout(() => setConfirmed(new Set()), 900);
    return () => clearTimeout(timer);
  }, [confirmed]);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const packs = data.modules.flatMap((m) =>
    m.packages.map((p) => ({ ...p, module: m.name })),
  );
  const selected = packs.find((p) => p.id === focus);
  const layout = deriveTopologyLayout(data, selected, maxColumns);
  const nodes = useMemo(() => {
    const list: Node[] = [];
    if (selected) {
      const p = derivePackageProgress(selected, data);
      list.push({
        id: "focused-package",
        type: "package",
        position: { x: 0, y: 0 },
        width: layout.width,
        height: layout.height,
        style: { width: layout.width, height: layout.height },
        data: {
          name: selected.name,
          summary: `${selected.module} · ${label(selected.status)} · ${derivePackageParticipants(selected, data).length} 人 · ${p.done}/${p.total} 项完成 · ${selected.plannedStart ?? "未排期"} — ${selected.plannedEnd ?? "—"}`,
          open: () => open({ type: "package", id: selected.id }),
        },
        selectable: false,
      });
    }
    for (const pos of layout.positions) {
      const n = data.nodes.find((n) => n.id === pos.id)!;
      const tasks = liveTasks(data).filter((t) => t.assigneeNodeId === n.id);
      const state = deriveMemberVisualState(n, data, seen);
      const plan = data.plans.find((p) => p.ownerNodeId === n.id);
      list.push({
        id: n.id,
        type: "member",
        position: { x: pos.x, y: pos.y },
        // These cards have fixed CSS dimensions. Keep them on controlled nodes
        // so a data refresh cannot discard React Flow's measured dimensions.
        width: compactNodes ? 168 : 196,
        height: compactNodes ? 92 : 104,
        ...(pos.inside ? { parentId: "focused-package" } : {}),
        data: {
          id: n.id,
          own: n.id === data.viewer.id,
          name: n.label,
          role: n.role,
          branch: n.git?.branch ?? "",
          online: n.connected,
          ...state,
          tone: confirmed.has(n.id) ? "confirmed" : state.tone,
          done: tasks.filter((t) => t.status === "DONE").length,
          total: tasks.length,
          pr: data.pullRequests.filter(
            (p) =>
              p.submitterNodeId === n.id &&
              ["QUEUED", "IN_REVIEW"].includes(p.status),
          ).length,
          plan: !plan
            ? "未提交"
            : !data.alignments.some(
                  (a) =>
                    a.moduleRevisionSnapshot === data.moduleRevision &&
                    a.planImpacts?.some((p) => p.documentId === plan.id),
                )
              ? "影响待核实"
              : plan.revision > Math.max(0, ...data.alignments.flatMap(a => a.planSnapshot.filter(p => p.nodeId === n.id).map(p => p.revision)))
                ? "有新修订"
                : "已提交",
          collaborations: packs.filter((p) =>
            derivePackageParticipants(p, data).some(
              (person) => person.id === n.id,
            ),
          ).length,
          open: (tab?: string) => open({ type: "member", id: n.id, tab }),
        },
      });
    }
    return list;
  }, [data, focus, seen, open, confirmed, maxColumns, compactNodes]);
  return (
    <div className="topology-view">
      <div className="canvas-toolbar">
        <input
          aria-label="搜索工作包"
          type="search"
          placeholder="搜索工作包"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="package-filters">
          <button
            className={!selected ? "selected" : ""}
            onClick={() => setFocus("")}
          >
            全部成员
          </button>
          {packs
            .filter((p) => p.name.includes(search))
            .sort(
              (a, b) =>
                Number(b.status === "in_progress") -
                Number(a.status === "in_progress"),
            )
            .map((p) => (
              <button
                key={p.id}
                className={focus === p.id ? "selected" : ""}
                onClick={() => setFocus(p.id)}
              >
                {p.name}
                <small>
                  {derivePackageParticipants(p, data).length} 人 ·{" "}
                  {derivePackageProgress(p, data).percent}%
                </small>
              </button>
            ))}
        </div>
      </div>
      <div className="flow-wrap">
        <ReactFlowProvider>
          <ReactFlow
            onInit={setFlow}
            nodes={nodes}
            edges={[]}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            minZoom={0.55}
            maxZoom={1.45}
            defaultViewport={viewport}
            onMoveEnd={(_, v) => setViewport(v)}
            fitView
            fitViewOptions={{ maxZoom: 1, padding: fitPadding }}
            zoomOnDoubleClick={false}
            onPaneClick={(e) => {
              if (e.detail === 2) {
                void flow?.fitView({
                  padding: fitPadding,
                  minZoom: 1,
                  maxZoom: 1,
                  duration: 200,
                });
              }
            }}
            colorMode="dark"
          >
            <Background color="#292e39" gap={28} size={1} />
            <Controls
              layoutKey={`${focus}:${maxColumns}:${layout.positions.map(n => `${n.id}:${n.x}:${n.y}`).join(",")}`}
              drawer={drawer}
              active={active}
            />
            {data.nodes.length > 10 && (
              <MiniMap pannable zoomable position="bottom-right" />
            )}
          </ReactFlow>
        </ReactFlowProvider>
        {!data.nodes.length && (
          <div className="canvas-empty">暂无成员，请从顶部邀请成员。</div>
        )}
        {!packs.length && <div className="canvas-note">尚未建立工作包分组</div>}
        <div className="legend">
          <button onClick={() => setLegend(!legend)}>
            {legend ? "收起图例" : "状态图例"}
          </button>
          {legend && (
            <>
              <span className="running">● 进行中</span>
              <span className="done">● 完成</span>
              <span className="blocked">● 等待 / 暂停</span>
              <span className="change">● 需求变更</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
