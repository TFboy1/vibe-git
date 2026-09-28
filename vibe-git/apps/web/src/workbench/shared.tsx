import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X, AlertCircle, Check } from "lucide-react";

export function useAction(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const alive = useRef(true), running = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 3500); return () => clearTimeout(timer); }, [notice]);
  const run = async (work: () => Promise<unknown>, message = "已保存") => {
    if (running.current) return; running.current = true; setBusy(true); setError("");
    try { await work(); await refresh(); if (alive.current) setNotice(message); }
    catch (error) { if (alive.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  };
  return { busy, error, notice, run, setError };
}
export function Feedback({ error, notice }: { error?: string; notice?: string }) {
  return <>{error && <div className="wb-message wb-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
    {notice && <div className="wb-message wb-success" role="status"><Check size={16} /><span>{notice}</span></div>}</>;
}
export function Sheet({ title, children, close, dirty = false, wide = false }: { title: string; children: ReactNode; close: () => void; dirty?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  const requestClose = () => { if (!dirty || window.confirm("有未保存内容，仍要离开？")) close(); };
  useEffect(() => {
    const dialog = ref.current; const previous = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  useEffect(() => { if (!dirty) return; const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leave); return () => window.removeEventListener("beforeunload", leave); }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const currentUrl = location.href;
    const back = (event: PopStateEvent) => {
      if (window.confirm("有未保存内容，仍要离开？")) return;
      event.stopImmediatePropagation(); history.pushState(null, "", currentUrl);
    };
    window.addEventListener("popstate", back, { capture: true });
    return () => window.removeEventListener("popstate", back, { capture: true });
  }, [dirty]);
  return <dialog ref={ref} className={`wb-sheet ${wide ? "wb-wide" : ""}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); requestClose(); }}>
    <header className="wb-sheet-heading"><h2 id={titleId}>{title}</h2><button type="button" className="wb-icon" onClick={requestClose} aria-label="关闭详情"><X size={19} /></button></header>
    <div className="wb-sheet-body">{children}</div>
  </dialog>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="wb-empty"><p>{title}</p>{children}</div>;
}
export function downloadText(name: string, content: string, json = false) {
  const url = URL.createObjectURL(new Blob([content], { type: json ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const lines = (value: string) => value.split("\n").map(line => line.trim()).filter(Boolean);
