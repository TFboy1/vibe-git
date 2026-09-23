import { useEffect, useState } from "react";
import type { MarkdownDocument, V20BootstrapPayload } from "@vibe-git/protocol";
import { api } from "./api";
import { Markdown } from "./Markdown";

type Version = Omit<MarkdownDocument, "content"> & { current: boolean; withdrawn: boolean };

async function ownerVersion(ownerNodeId: string, revision?: number): Promise<Version | undefined> {
  for (let offset = 0; ; offset += 200) {
    const page = await api.planHistory(200, offset);
    const found = page.items.find((item) => item.ownerNodeId === ownerNodeId && (revision === undefined || item.revision === revision));
    if (found) return found;
    if (offset + page.items.length >= page.total || page.items.length === 0) return undefined;
  }
}

export function PlanHistory({ data, active, onChanged, ownerId, writable = true }: { data: V20BootstrapPayload; active: boolean; ownerId?: string; writable?: boolean; onChanged(): Promise<void> }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<MarkdownDocument | null>(null);
  const [previous, setPrevious] = useState<MarkdownDocument | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const marker = data.plans.map((plan) => `${plan.id}:${plan.revision}`).join("|");
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void api.planHistory(50, offset).then((result) => {
      if (!cancelled) { setVersions(result.items); setTotal(result.total); setError(""); }
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [active, marker, offset]);
  const show = async (version: Version, compare = false) => {
    setPending(true); setError("");
    try {
      const current = await api.document(version.id);
      const prior = compare ? await ownerVersion(version.ownerNodeId, version.revision - 1) : undefined;
      setSelected(current);
      setPrevious(prior ? await api.document(prior.id) : null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  };
  const restore = async (version: Version) => {
    if (!window.confirm(`将 v${version.revision} 的正文恢复为一个新版本？已有版本仍会保留。`)) return;
    setPending(true); setError("");
    try {
      const latest = await ownerVersion(data.viewer.id);
      const expectedRevision = latest?.revision ?? 0;
      await api.restorePlan(version.id, expectedRevision);
      setSelected(null); setPrevious(null); setOffset(0);
      await onChanged();
      const result = await api.planHistory(50, 0); setVersions(result.items); setTotal(result.total);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  };
  return <section className="plan-history-section"><div className="section-head"><div><h2>提案版本</h2><p>旧版本和撤回记录保留。恢复时会生成新版本，不会覆盖历史，也不会改动已冻结的对齐稿。</p></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="history"><div className="history-row history-head"><span>提案</span><span>版本</span><span>提交时间</span><span>内容 hash</span><span>操作</span></div>
      {versions.filter(version => !ownerId || version.ownerNodeId === ownerId).map((version) => <div className="history-row" key={version.id}><strong>{data.nodes.find((node) => node.id === version.ownerNodeId)?.label ?? version.ownerNodeId.slice(0, 8)} · {version.filename}{version.current ? " · 当前" : version.withdrawn ? " · 已撤回" : ""}</strong><span>v{version.revision}</span><span>{new Date(version.createdAt).toLocaleString("zh-CN")}</span><code title={version.sha256}>{version.sha256.slice(0, 12)}…</code><span className="history-actions"><button className="detail-button" disabled={pending} onClick={() => void show(version)}>查看</button><button className="detail-button" disabled={pending || version.revision === 1} onClick={() => void show(version, true)}>对比</button>{version.ownerNodeId === data.viewer.id && !version.current && <button className="detail-button" disabled={pending || !writable} onClick={() => void restore(version)}>恢复</button>}</span></div>)}
      {!versions.length && <div className="no-results">尚无提案版本。</div>}
    </div>
    {total > 50 && <div className="history-pages"><button disabled={offset === 0 || pending} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</button><span>{offset + 1}–{Math.min(offset + 50, total)} / {total}</span><button disabled={offset + 50 >= total || pending} onClick={() => setOffset(offset + 50)}>下一页</button></div>}
    {selected && <div className="version-preview"><div className="subsection-head"><h3>{selected.filename} · v{selected.revision}{previous ? ` 对比 v${previous.revision}` : ""}</h3><button onClick={() => { setSelected(null); setPrevious(null); }}>关闭</button></div><div className={previous ? "version-columns" : ""}>{previous && <article><h4>上一个版本 · v{previous.revision}</h4><Markdown>{previous.content}</Markdown></article>}<article><h4>所选版本 · v{selected.revision}</h4><Markdown>{selected.content}</Markdown></article></div></div>}
  </section>;
}
