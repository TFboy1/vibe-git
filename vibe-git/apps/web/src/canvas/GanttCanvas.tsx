import { useEffect, useRef, useState } from "react";
import type { V20BootstrapPayload } from "@vibe-git/protocol";
import { deriveGanttRows, label, type InspectorTarget } from "./model";
const day = (s: string) =>
  Math.floor(Date.parse(s.slice(0, 10) + "T00:00:00Z") / 86400000);
const date = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
export function GanttCanvas({
  data,
  open,
  active,
}: {
  active: boolean;
  data: V20BootstrapPayload;
  open: (t: InspectorTarget) => void;
}) {
  const [scale, setScale] = useState<"日" | "周" | "月">("周");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [mine, setMine] = useState(false);
  const [exception, setException] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  const [availableWidth, setAvailableWidth] = useState(0);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setAvailableWidth(Math.max(0, element.clientWidth - parseFloat(getComputedStyle(element).getPropertyValue("--gantt-label")))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const all = deriveGanttRows(data);
  const localNow = new Date();
  const today = day(`${localNow.getFullYear()}-${String(localNow.getMonth()+1).padStart(2,"0")}-${String(localNow.getDate()).padStart(2,"0")}`);
  const dates = all
    .flatMap((r) => [r.start, r.end, r.actualStart, r.actualEnd])
    .filter((s): s is string => !!s)
    .map(day)
    .filter(Number.isFinite);
  if (all.some((r) => r.actualStart && !r.actualEnd)) dates.push(today);
  const start = (dates.length ? Math.min(...dates) : today) - 1;
  const end = (dates.length ? Math.max(...dates) : today) + 3;
  const unit = scale === "日" ? 144 : scale === "周" ? 96 : 32;
  const timelineWidth = Math.max(Math.max(14, end - start + 1) * unit, availableWidth);
  const days = Array.from(
    // Extend the date grid to fill the canvas; never stretch a day's width.
    { length: Math.ceil(timelineWidth / unit) },
    (_, i) => start + i,
  );
  const keep = new Set<string>();
  for (const row of all) {
    if (
      mine &&
      (row.type !== "task" ||
        data.tasks.find((t) => t.id === row.id)?.assigneeNodeId !==
          data.viewer.id)
    )
      continue;
    if (
      exception &&
      !["BLOCKED", "PAUSED", "FAILED", "blocked"].includes(row.status)
    )
      continue;
    keep.add(row.key);
    let parent = row.parent;
    while (parent) {
      const ancestor = all.find((r) => r.id === parent);
      if (!ancestor) break;
      keep.add(ancestor.key);
      parent = ancestor.parent;
    }
  }
  const relevant = all.filter((r) => keep.has(r.key));
  const rows = relevant.filter(
    (r) =>
      !r.parent ||
      (!closed.has(r.parent) &&
        !closed.has(all.find((p) => p.id === r.parent)?.parent ?? "")),
  );
  const locate = () => {
    if (scroll.current) {
      const labelWidth = parseFloat(getComputedStyle(scroll.current).getPropertyValue("--gantt-label"));
      const visibleTimeline = Math.max(0, scroll.current.clientWidth - labelWidth);
      scroll.current.scrollLeft = Math.max(
        0,
        (Math.min(end, Math.max(start, today)) - start + 0.5) * unit - visibleTimeline / 2,
      );
    }
  };
  useEffect(() => {
    if (active) locate();
  }, [scale]);
  useEffect(() => {
    if (active && !placed.current) {
      placed.current = true;
      locate();
    }
  }, [active]);
  return (
    <div className="gantt-view">
      <div className="canvas-toolbar">
        <button onClick={locate}>今天</button>
        <div className="segmented">
          {(["日", "周", "月"] as const).map((s) => (
            <button
              key={s}
              className={scale === s ? "selected" : ""}
              onClick={() => setScale(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <button onClick={() => setClosed(new Set())}>展开全部</button>
        <button
          onClick={() =>
            setClosed(
              new Set(all.filter((r) => r.type !== "task").map((r) => r.id)),
            )
          }
        >
          收起全部
        </button>
        <label>
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => setMine(e.target.checked)}
          />
          只看我的工作
        </label>
        <label>
          <input
            type="checkbox"
            checked={exception}
            onChange={(e) => setException(e.target.checked)}
          />
          只看异常
        </label>
        <div className="gantt-legend" aria-label="条形图例">
          <span><i className="planned-swatch" />计划区间</span>
          <span><i className="actual-swatch" />实际执行</span>
        </div>
      </div>
      <div className="gantt-scroll" ref={scroll}>
        <div
          className="gantt-sheet"
          style={{
            width: `calc(var(--gantt-label) + ${timelineWidth}px)`,
          }}
        >
          <div className="gantt-header">
            <div className="gantt-name">模块 / 工作包 / 任务</div>
            <div className={`date-axis ${scale === "月" ? "month-scale" : ""}`}>
              {days.map((d, i) => (
                <div
                  style={{ width: unit }}
                  key={d}
                  className={d === today ? "today" : ""}
                >
                  {scale === "月"
                    ? i % 7 === 0 && timelineWidth - i * unit >= 40
                      ? date(d).slice(5)
                      : ""
                    : date(d).slice(5)}
                  <small>
                    {scale === "日"
                      ? ["日", "一", "二", "三", "四", "五", "六"][
                          new Date(d * 86400000).getUTCDay()
                        ]
                      : ""}
                  </small>
                </div>
              ))}
            </div>
          </div>
          {rows.map((row) => {
            const hasPlan = !!row.start && !!row.end;
            const planFrom = hasPlan ? day(row.start!) : null;
            const planTo = hasPlan ? day(row.end!) : null;
            const actualFrom = row.actualStart ? day(row.actualStart) : null;
            const actualTo = actualFrom === null ? null : Math.max(actualFrom, row.actualEnd ? day(row.actualEnd) : today);
            const from = planFrom === null ? actualFrom : actualFrom === null ? planFrom : Math.min(planFrom, actualFrom);
            const to = planTo === null ? actualTo : actualTo === null ? planTo : Math.max(planTo, actualTo);
            const interval = (first: number, last: number) => ({
              left: (first - from!) * unit + 2,
              width: Math.max(1, (last - first + 1) * unit - 4),
            });
            return (
              <div className={`gantt-line ${row.type}`} key={row.key}>
                <div
                  className="gantt-name"
                  style={{ paddingLeft: 12 + row.depth * 18 }}
                >
                  {row.type !== "task" && (
                    <button
                      aria-label={closed.has(row.id) ? "展开" : "收起"}
                      onClick={() =>
                        setClosed((old) => {
                          const next = new Set(old);
                          next.has(row.id)
                            ? next.delete(row.id)
                            : next.add(row.id);
                          return next;
                        })
                      }
                    >
                      {closed.has(row.id) ? "›" : "⌄"}
                    </button>
                  )}
                  <button
                    className="row-title"
                    onClick={() => open({ type: row.type, id: row.id })}
                  >
                    {row.name}
                    <small>
                      {!hasPlan ? "未排期" : row.owner || label(row.status)}
                    </small>
                  </button>
                </div>
                <div
                  className="gantt-track"
                  style={{ backgroundSize: `${unit * (scale === "月" ? 7 : 1)}px 100%` }}
                >
                  {today >= start && today <= end && (
                    <i
                      className="today-line"
                      style={{ left: (today - start + 0.5) * unit }}
                    />
                  )}
                  {from !== null && to !== null && (
                    <button
                      aria-label={`${row.name} ${label(row.status)}`}
                      className={`gantt-bar ${row.status.toLowerCase()}`}
                      style={{
                        left: (from - start) * unit,
                        width: (to - from + 1) * unit,
                      }}
                      title={`${row.name}\n${row.owner}\n计划 ${row.start ?? "未排期"} — ${row.end ?? "—"}\n实际 ${row.actualStart ?? "未开始"} — ${row.actualEnd ?? "未完成"}\n${label(row.status)}`}
                      onClick={() => open({ type: row.type, id: row.id })}
                    >
                      {planFrom !== null && planTo !== null && (
                        <span className="planned-bar" style={interval(planFrom, planTo)}>
                          {row.type !== "task" && (
                            <i className="summary-progress" style={{ width: `${row.percent}%` }} />
                          )}
                        </span>
                      )}
                      {row.type === "task" && actualFrom !== null && actualTo !== null && (
                        <span
                          className="actual-bar"
                          style={interval(actualFrom, actualTo)}
                        />
                      )}
                      {row.status === "DONE" && row.actualEnd && (
                        <b style={{ left: (day(row.actualEnd) - from + 1) * unit - 2 }}>✓</b>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {!rows.length && (
          <div className="canvas-empty">
            <p>{all.length ? "当前筛选下没有工作项" : "尚未建立排期"}</p>
            <button
              onClick={() =>
                open({ type: "project", id: "project", tab: "stage" })
              }
            >
              打开项目控制
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
