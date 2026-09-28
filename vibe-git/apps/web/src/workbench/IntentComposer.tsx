import { useEffect, useRef, useState } from "react";
import { FileText, MessageCircle, Upload, Check, Sparkles } from "lucide-react";
import type { IntentDraft } from "@vibe-git/protocol";
import { coordinationApi } from "../api";
import { bridge, bridgeStream } from "../canvas/localApi";
import type { IntentClarificationResult } from "../api";
import { Feedback, Sheet, lines, useAction } from "./shared";

export function IntentComposer({ intent, local, refresh, close, saved }: { intent?: IntentDraft | undefined; local: boolean; refresh: () => Promise<void>; close: () => void; saved: (id: string) => void }) {
  const [mode, setMode] = useState<"choose" | "markdown" | "clarify">(intent ? "markdown" : "choose");
  const [title, setTitle] = useState(intent?.title ?? ""), [content, setContent] = useState(intent?.content ?? "");
  const [acceptance, setAcceptance] = useState(intent?.acceptance.join("\n") ?? ""), [constraints, setConstraints] = useState(intent?.constraints ?? "");
  const [fileName, setFileName] = useState(""), [draft, setDraft] = useState<IntentClarificationResult | null>(null);
  const [answer, setAnswer] = useState(""), [question, setQuestion] = useState(""), [questionOptions, setQuestionOptions] = useState<Array<{ label: string; description: string }>>([]), [clarifyBusy, setClarifyBusy] = useState(false);
  const [progress, setProgress] = useState(""), [liveText, setLiveText] = useState(""), [elapsed, setElapsed] = useState(0);
  const request = useRef<AbortController | null>(null);
  const [provider, setProvider] = useState<"codex" | "openai">("codex"), [openaiConfigured, setOpenaiConfigured] = useState(false), [openaiSource, setOpenaiSource] = useState("none"), [openaiModel, setOpenaiModel] = useState("gpt-5"), [openaiKey, setOpenaiKey] = useState(""), [showOpenAISettings, setShowOpenAISettings] = useState(false);
  const [dirty, setDirty] = useState(false); const action = useAction(refresh); const sessionId = useState(() => crypto.randomUUID())[0];
  useEffect(() => { if (mode !== "clarify" || !local) return; void Promise.all([
    bridge<{ configured: boolean; source: string; model: string }>("/api/local/openai"),
    bridge<{ status: string }>("/api/local/codex").catch(() => ({ status: "unavailable" }))
  ]).then(([apiStatus, codexStatus]) => {
    setOpenaiConfigured(apiStatus.configured); setOpenaiSource(apiStatus.source); setOpenaiModel(apiStatus.model);
    if (apiStatus.configured && codexStatus.status !== "available") setProvider("openai");
  }).catch(() => undefined); }, [mode, local]);
  useEffect(() => { if (!clarifyBusy) return; const started = Date.now(); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000); return () => clearInterval(timer); }, [clarifyBusy]);
  useEffect(() => () => request.current?.abort(), []);
  const saveOpenAI = async () => { const status = await bridge<{ configured: boolean; source: string; model: string }>("/api/local/openai", { apiKey: openaiKey || undefined, model: openaiModel }); setOpenaiConfigured(status.configured); setOpenaiSource(status.source); setOpenaiModel(status.model); setOpenaiKey(""); setShowOpenAISettings(false); };
  const save = async () => { const result = await coordinationApi.saveIntent({ title: title.trim() || "未命名需求", content: content.trim(), acceptance: lines(acceptance), constraints, ...(intent ? { expectedRevision: intent.revision } : {}) }, intent?.id); setDirty(false); saved(result.id); };
  const clarify = async (message: string, start: boolean) => {
    const controller = new AbortController(); request.current = controller;
    setClarifyBusy(true); setElapsed(0); setProgress("正在连接"); setLiveText(""); action.setError("");
    try {
      let selected = "default"; try { selected = localStorage.getItem("vibe-git:codex-model") || "default"; } catch { /* private storage */ }
      const result = await bridgeStream<IntentClarificationResult>("/api/local/intent-clarify", { message, sessionId, start, provider, model: provider === "openai" ? openaiModel : selected === "default" ? undefined : selected }, (type, value) => {
        if (type === "status") setProgress(String(value));
        if (type === "delta") setLiveText(previous => (previous + String(value)).slice(-2000));
        if (type === "preview") setLiveText(String(value));
      }, controller.signal);
      setDraft(result); setQuestion(result.question); setQuestionOptions(result.options ?? []);
      if (result.title) setTitle(result.title); if (result.content) setContent(result.content);
      setAcceptance(result.acceptance.join("\n")); setConstraints(result.constraints); setAnswer("");
    } catch (error) {
      if (!controller.signal.aborted) action.setError(error instanceof Error ? error.message : String(error));
    } finally { request.current = null; setClarifyBusy(false); setProgress(""); setLiveText(""); }
  };
  const endClarify = () => { request.current?.abort(); void bridge("/api/local/intent-clarify/end", { sessionId }).catch(() => undefined); setMode(draft?.content ? "markdown" : "choose"); if (draft?.content) setDirty(true); };
  const stopClarify = () => { request.current?.abort(); void bridge("/api/local/intent-clarify/end", { sessionId }).catch(() => undefined); setDraft(null); setQuestion(""); setQuestionOptions([]); };
  const closeComposer = () => { request.current?.abort(); void bridge("/api/local/intent-clarify/end", { sessionId }).catch(() => undefined); close(); };
  const switchProvider = (next: "codex" | "openai") => { if (provider === "codex") void bridge("/api/local/intent-clarify/end", { sessionId }).catch(() => undefined); setProvider(next); setDraft(null); setQuestion(""); setQuestionOptions([]); setAnswer(""); };
  const importMarkdown = async (file: File) => { if (file.size > 256 * 1024) { action.setError("Markdown 不能超过 256 KiB"); return; } try { const value = await file.text(); setFileName(file.name); setContent(value); const heading = value.match(/^#\s+(.+)$/m)?.[1] ?? file.name.replace(/\.md$/i, ""); setTitle(heading); setDirty(true); } catch { action.setError("无法读取 Markdown 文件"); } };
  return <Sheet title={intent ? "编辑需求" : "提出需求"} close={closeComposer} dirty={dirty} wide={mode === "clarify"}>
    <Feedback error={action.error} notice={action.notice} />
    {mode === "choose" && <div className="intent-choice"><button className="intent-choice-card" onClick={() => setMode("markdown")}><FileText size={22} /><strong>提交 Markdown</strong><span>已有需求文档？直接上传。</span></button><button className="intent-choice-card" disabled={!local} onClick={() => setMode("clarify")}><Sparkles size={22} /><strong>让 AI 帮我梳理</strong><span>只说一句话，逐轮回答关键问题。</span></button>{!local && <p className="wb-muted">请在本机运行 vibe-git open 后使用 Codex 辅助。</p>}</div>}
    {mode === "markdown" && <form onSubmit={event => { event.preventDefault(); void action.run(save, "需求已保存"); }}>
      <div className="intent-upload"><label className="wb-file-button"><Upload size={15} />选择 .md 文件<input type="file" accept=".md,text/markdown" disabled={!local || action.busy} onChange={event => { const file = event.target.files?.[0]; if (file) void importMarkdown(file); }} /></label>{fileName && <span className="wb-muted">{fileName}</span>}</div>
      <label>需求标题<input required maxLength={160} value={title} onChange={event => { setTitle(event.target.value); setDirty(true); }} placeholder="可选" /></label>
      <label>Markdown 内容<textarea required rows={14} maxLength={256 * 1024} value={content} onChange={event => { setContent(event.target.value); setDirty(true); }} placeholder="也可以直接粘贴 Markdown" /></label>
      <details className="wb-disclosure"><summary>补充验收与约束（可选）</summary><label>验收要求<textarea rows={3} value={acceptance} onChange={event => { setAcceptance(event.target.value); setDirty(true); }} placeholder="每行一项" /></label><label>约束<textarea rows={3} value={constraints} onChange={event => { setConstraints(event.target.value); setDirty(true); }} placeholder="没有可以不填" /></label></details>
      <div className="wb-sheet-footer"><button type="submit" className="wb-primary" disabled={!local || action.busy || !content.trim()}>{action.busy ? "保存中…" : "提交需求"}</button><button type="button" onClick={() => setMode("choose")}>返回</button></div>
    </form>}
    {mode === "clarify" && <div className="intent-clarify">
      <div className="intent-clarify-head"><span><MessageCircle size={17} />需求梳理</span><button type="button" onClick={endClarify}>结束梳理</button></div>
      <div className="intent-provider">
        <label>接入方式<select value={provider} disabled={clarifyBusy} onChange={event => switchProvider(event.target.value as "codex" | "openai")}><option value="codex">本机 Codex</option><option value="openai">OpenAI API</option></select></label>
        {provider === "openai" && <><span className="wb-muted">{openaiSource === "environment" ? "环境变量" : openaiConfigured ? "API 已配置" : "尚未配置 Key"}</span><button type="button" onClick={() => setShowOpenAISettings(!showOpenAISettings)}>设置</button></>}
      </div>
      {provider === "openai" && showOpenAISettings && <div className="wb-callout intent-api-settings">
        <label>API Key<input type="password" autoComplete="off" value={openaiKey} onChange={event => setOpenaiKey(event.target.value)} placeholder={openaiConfigured ? "输入新 Key 可替换" : "sk-…"} /></label>
        <label>模型<input value={openaiModel} onChange={event => setOpenaiModel(event.target.value)} placeholder="gpt-5" /></label>
        <div className="wb-actions"><button type="button" className="wb-primary" disabled={!openaiKey.trim()} onClick={() => void action.run(saveOpenAI, "API 已配置")}>保存</button>{openaiConfigured && openaiSource !== "environment" && <button type="button" onClick={() => void bridge<{ configured: boolean; source: string }>("/api/local/openai", { clear: true }).then(status => { setOpenaiConfigured(status.configured); setOpenaiSource(status.source); setShowOpenAISettings(false); })}>清除 Key</button>}</div>
      </div>}
      {draft?.summary && <div className="wb-callout"><strong>当前理解</strong><p className="wb-preserve">{draft.summary}</p></div>}
      {question && <div className="intent-question"><span>{provider === "codex" ? "Codex Plan" : "下一步"}</span><p>{question}</p><div className="intent-options">{questionOptions.slice(0, 3).map(option => <button type="button" key={option.label} disabled={clarifyBusy} onClick={() => void clarify(option.label, false)}><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</button>)}</div></div>}
      {!draft && <p className="intent-intro">只用一句话描述你想实现什么。</p>}
      {draft?.status === "ready" && <div className="wb-callout wb-success"><Check size={16} />草稿已生成，可以编辑后提交。</div>}
      {clarifyBusy && <div className="intent-progress" role="status" aria-live="polite"><span className="intent-progress-dot" /><strong>{progress || "正在生成"}</strong><small>{elapsed}s</small>{liveText && <p>{liveText}</p>}</div>}
      {draft?.status !== "ready" && <label>自定义回答<textarea autoFocus rows={3} value={answer} disabled={clarifyBusy} onChange={event => setAnswer(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (answer.trim() && !clarifyBusy) void clarify(answer, !draft); } }} placeholder={draft ? "也可以输入自己的想法" : "例如：给用户增加多人面试房间"} /></label>}
      <div className="wb-actions"><button type="button" className="wb-primary" disabled={clarifyBusy || (!draft?.content && (!local || !answer.trim() || (provider === "openai" && !openaiConfigured)))} onClick={() => { if (draft?.status === "ready") { setMode("markdown"); setDirty(true); } else void clarify(answer, !draft); }}>{draft?.status === "ready" ? "编辑草稿" : "发送"}</button>{clarifyBusy && <button type="button" onClick={stopClarify}>停止</button>}{draft?.content && draft.status !== "ready" && <button type="button" onClick={() => { setMode("markdown"); setDirty(true); }}>直接编辑</button>}</div>
      {!clarifyBusy && draft?.status !== "ready" && <p className="wb-muted">Ctrl/⌘ + Enter 发送</p>}
    </div>}
    {mode === "markdown" && draft?.status === "ready" && <p className="wb-muted">Codex 已生成草稿，你可以直接修改后提交。</p>}
  </Sheet>;
}
