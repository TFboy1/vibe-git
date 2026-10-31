import {createGovernance,taskFingerprint,changeSnapshot,assertChangeSnapshot,applyRequirementDelta,assertTaskInput,evidenceRevision,assertUnaffectedAlignment,reusableTask} from "./research-governance.js";
import {hasRunCapacity} from "./run-budget.js";
import {executionHistory} from './execution-history.js';
import {validateScientificChecks,checkScientificResult,scientificError} from "./scientific-checks.js";
import {constrainResearch} from "./research-constraints.js";
import { isLocalResearchPlatform, researchPlatformName } from "@vibe-git/protocol";
import { createHash, randomUUID } from "node:crypto";
import { isLatestSPRun, type SPCreateProject, type SPInput, type SPProject, type SPRun, type SPTask, type SPTaskAttempt, type SciencePALArtifact, type SPTeam, type SPTeamPacket } from "@vibe-git/protocol";
import { badRequest, forbidden, invalidState, notFound, revisionConflict } from "../domain/errors.js";
import type { V20Repository } from "../v20/repository.js";
import { MAX_ARTIFACT_BYTES, SciencePALError, type SciencePALRemote } from "./client.js";
import { alignmentResult, changeResult, envelope, jobPrompt, object, reviewResult, reviewOutputGuidance, governancePrompt, string } from "./pipeline-contract.js";
import { projectEvidence } from "./evidence.js";
import { validateSource } from "./source.js";
import { checkTaskResult, resultValidationError, validateResultSchemas } from "./result-contract.js";
import { commandSnapshot } from "./browser-commands.js";

const now = () => new Date().toISOString();
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const unsettled = (run: SPRun) => ["READY", "STARTING", "RUNNING", "NEEDS_INPUT", "COMPLETED", "UNKNOWN"].includes(run.status);
const busy = (run: SPRun) => ["READY", "STARTING", "RUNNING", "NEEDS_INPUT", "COMPLETED"].includes(run.status);

/** Durable orchestration owns all dispatch decisions; the browser only issues explicit commands. */
export class SciencePALPipeline {
  private readonly locks = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling: Promise<void> | undefined;
  private closing = false;
  constructor(private readonly repo: V20Repository, private readonly remote: SciencePALRemote) {
    repo.db.exec(`CREATE TABLE IF NOT EXISTS sciencepal_projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sciencepal_pipeline_files (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, metadata TEXT NOT NULL, bytes BLOB NOT NULL);`);
    for (const p of this.list()) {
      let changed = false;
      for (const r of p.runs) if (r.status === "STARTING") {
        r.status = "UNKNOWN"; r.error = "Host 在提交中重启，远端结果未知；不会重复提交。"; p.phase = "BLOCKED"; p.error = r.error; changed = true;
      }
      if (changed) this.save(p, "恢复时发现未知提交，已阻止重新派发");
    }
  }
  startWorker() {
    if (this.timer) return;
    this.timer = setInterval(() => { if (!this.polling && !this.closing) {
      this.polling = this.tick().finally(() => { this.polling = undefined; });
    } }, 5000);
    this.timer.unref();
  }
  async close() { this.closing = true; clearInterval(this.timer); await this.polling; }
  list(): SPProject[] { return (this.repo.db.prepare("SELECT data FROM sciencepal_projects ORDER BY rowid DESC").all() as { data: string }[]).map(row => JSON.parse(row.data)); }
  get(id: string): SPProject {
    const row = this.repo.db.prepare("SELECT data FROM sciencepal_projects WHERE id=?").get(id) as { data: string } | undefined;
    if (!row) throw notFound("协作项目不存在"); return JSON.parse(row.data);
  }
  private save(p: SPProject, event?: string) {
    p.updatedAt = now();
    if (event) p.events.push({ at: p.updatedAt, message: event });
    this.repo.db.prepare("INSERT INTO sciencepal_projects(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(p.id, JSON.stringify(p));
  }
  private async locked<T>(id: string, fn: (p: SPProject) => Promise<T> | T): Promise<T> {
    if (this.locks.has(id)) throw invalidState("正在同步此项目，请稍后操作");
    this.locks.add(id);
    try { return await fn(this.get(id)); } finally { this.locks.delete(id); }
  }
  async create(input: SPCreateProject, team?: SPTeam): Promise<SPProject> {
    if (!team && !this.remote.configured) throw badRequest("尚未配置 SciencePAL API Key");
    const title = string(input?.title, "项目标题", 120);
    const source = input.source === undefined ? undefined : validateSource(input.source);
    const resultSchemas = input.resultSchemas === undefined ? undefined : validateResultSchemas(input.resultSchemas);
    if (!Array.isArray(input?.proposals) || input.proposals.length < 2 || input.proposals.length > 4) throw badRequest("需要 2–4 位不同 Agent 的提案");
    const proposals = input.proposals.map(plan => ({ id: randomUUID(), agentId: string(plan?.agentId, "Agent ID", 120), content: string(plan?.content, "提案", 8000), sha256: "" }));
    if (new Set(proposals.map(p => p.agentId)).size !== proposals.length) throw badRequest("提案 Agent 不能重复");
    const available = team ? team.members.map(m => m.agent) : await this.remote.agents(), agents = proposals.map(plan => available.find(a => a.id === plan.agentId));
    if (agents.some(a => !a) || !agents.some(a => a?.id === input.coordinatorId)) throw badRequest("Agent 不可用或对齐负责人未加入项目");
    proposals.forEach(plan => { plan.sha256 = hash(plan.content); });
    const p: SPProject = { id: randomUUID(), roomId: this.repo.room()!.id, title, revision: 1, phase: "DRAFT", paused: false,
      agents: agents as SPProject["agents"], coordinatorId: input.coordinatorId, proposals, requirementMarkdown: "", alignment: null, alignmentRunId: null,
      tasks: [], runs: [], changes: [], history: [], maxRuns: 32, error: null, createdAt: now(), updatedAt: now(), events: [] };
    if (team) {
      p.team = team;
      p.proposals = p.proposals.map((plan, index) => {
        const owner = team.members.find(m => m.agent.id === plan.agentId)!;
        const original = input.proposals[index]!.content;
        return { ...plan, content: original, sha256: hash(original), ownerNodeId: owner.nodeId, documentId: owner.documentId, documentRevision: owner.documentRevision };
      });
    }
    if(input.governanceVersion!==undefined&&input.governanceVersion!==1)throw badRequest("不支持的科研治理版本");
    if(input.governanceVersion===1)p.governance=createGovernance(p);
    if (source) p.source = { artifact: this.storeFile(p, source.filename, source.bytes), sourceUrl: source.sourceUrl, attribution: source.attribution };
    if (resultSchemas) p.resultContracts = this.storeFile(p, "result-contracts.json", Buffer.from(JSON.stringify(resultSchemas, null, 2)));
    if (input.scientificChecks) {const checks=validateScientificChecks(input.scientificChecks,p.source?.artifact.sha256);p.scientificChecks=this.storeFile(p,"scientific-checks.json",Buffer.from(JSON.stringify(checks)));}
    this.save(p, "提案已冻结：可启动自动对齐"); return p;
  }
  private storeFile(p: SPProject, filename: string, bytes: Uint8Array): SciencePALArtifact {
    if (!bytes.length || bytes.length > MAX_ARTIFACT_BYTES) throw badRequest("文件为空或超过 5 MiB");
    const meta: SciencePALArtifact = { id: randomUUID(), filename, sha256: hash(bytes), size: bytes.length, collectedAt: now() };
    this.repo.db.prepare("INSERT INTO sciencepal_pipeline_files(id,project_id,metadata,bytes) VALUES (?,?,?,?)").run(meta.id, p.id, JSON.stringify(meta), bytes);
    return meta;
  }
  file(projectId: string, artifactId: string): SciencePALArtifact & { bytes: Uint8Array } {
    const row = this.repo.db.prepare("SELECT metadata,bytes FROM sciencepal_pipeline_files WHERE id=? AND project_id=?").get(artifactId, projectId) as { metadata: string; bytes: Uint8Array } | undefined;
    if (!row) throw notFound("成果文件不存在");
    const meta = JSON.parse(row.metadata) as SciencePALArtifact;
    if (hash(row.bytes) !== meta.sha256) throw invalidState("冻结文件哈希已变化，已阻止交接");
    return { ...meta, bytes: row.bytes };
  }
  evidence(projectId: string, revision?: number) {
    const p = this.get(projectId), version = revision ?? p.revision;
    return projectEvidence(p, version, key => this.attempts(projectId, key, version), id => this.file(projectId, id));
  }
  attempts(projectId: string, taskKey: string, revision?: number): SPTaskAttempt[] {
    const p = this.get(projectId), version = revision ?? p.revision;
    if (!Number.isSafeInteger(version) || version < 1) throw badRequest("需求版本必须为正整数");
    const stage = version === p.revision ? p : p.history.find(h => h.revision === version);
    const task = stage?.tasks.find(t => t.key === taskKey);
    if (!task) throw notFound("此需求版本的任务不存在");
    const sourceVersion=task.carriedFrom?.revision??version;
    const runs = p.runs.filter(r => r.revision === sourceVersion && r.taskKey === taskKey);
    const read = (id: string): unknown => {
      const file = this.file(projectId, id);
      try { return JSON.parse(Buffer.from(file.bytes).toString("utf8")); }
      catch { throw invalidState("冻结证据不是有效 JSON"); }
    };
    return runs.filter(r => r.kind === "TASK").map((execution, index) => {
      const input = execution.inputs.find(i => i.filename === "context.json");
      if (!input) throw invalidState("执行缺少冻结上下文");
      const file = this.file(projectId, input.artifactId);
      if (file.sha256 !== input.sha256 || file.size !== input.size) throw invalidState("执行上下文与冻结清单不符");
      const context = object(read(input.artifactId));
      if (context.revision !== sourceVersion || object(context.task).key !== taskKey) throw invalidState("执行上下文版本或任务不符");
      return { number: index + 1, execution, feedback: typeof context.feedback === "string" ? context.feedback : "",
        // Artifact identity, rather than adjacency or filename, ties review retries to the right attempt.
        reviews: runs.filter(r => r.kind === "REVIEW" && execution.output && r.inputs.some(i => i.artifactId === execution.output!.id)).map(run => {
          if (run.status !== "COLLECTED") return { run, result: null };
          if (!run.output) throw invalidState("已采集评审缺少冻结成果");
          return { run, result: reviewResult(envelope(read(run.output.id), run), task.acceptance, task.outputFilename,!!stage?.governance) };
        }),
      };
    });
  }
  private queue(p: SPProject, kind: SPRun["kind"], agentId: string, context: unknown, files: string[] = [], taskKey: string | null = null): SPRun {
    if (!hasRunCapacity(p)) throw invalidState(`本项目达到 ${p.maxRuns} 次运行上限（含续接）；请结束当前实验并检查任务设计`);
    const resultSchemas = this.contracts(p);
    const contextFile = this.storeFile(p, "context.json", Buffer.from(JSON.stringify({ ...object(context), ...(p.governance ? {governance:p.governance} : {}), ...(resultSchemas ? { resultSchemas } : {}), ...(p.scientificChecks ? {scientificChecks:this.scienceRules(p)} : {}), ...(p.source ? { source: { filename: p.source.artifact.filename, sourceUrl: p.source.sourceUrl, attribution: p.source.attribution } } : {}) }, null, 2)));
    const metas = [contextFile, ...(p.source ? [this.file(p.id, p.source.artifact.id)] : []), ...files.map(id => this.file(p.id, id))];
    if (new Set(metas.map(m => m.filename)).size !== metas.length) throw badRequest("附件文件名冲突");
    if (metas.reduce((sum, m) => sum + m.size, 0) > MAX_ARTIFACT_BYTES) throw badRequest("本次交接附件合计超过 5 MiB");
    const inputs: SPInput[] = metas.map(m => ({ artifactId: m.id, filename: m.filename, size: m.size, sha256: m.sha256 }));
    const outputFilename = kind === "TASK" ? `${taskKey}.json` : `${kind.toLowerCase()}-result.json`;
    const run: SPRun = { id: randomUUID(), kind, revision: p.revision, taskKey, agent: p.agents.find(a => a.id === agentId)!, status: "READY",
      prompt: jobPrompt(kind, p.revision, outputFilename, inputs.map(i => i.filename), p.agents.find(a => a.id === agentId)?.platform)+(p.governance?governancePrompt():""), inputs, outputFilename, output: null,
      threadId: null, runId: null, sandboxId: null, projectId: null, createdAt: now(), updatedAt: now(), error: null, remoteStatus: null };
    if (p.team) {
      run.ownerNodeId = p.team.members.find(m => m.agent.id === agentId)!.nodeId;
      run.provenance = "member-connector";
    }
    p.runs.push(run); p.events.push({ at: now(), message: `${kind}${taskKey ? ` / ${taskKey}` : ""} 已排队，输入快照已保存` }); return run;
  }
  private contracts(p: SPProject) {
    if (!p.resultContracts) return undefined;
    const file = this.file(p.id, p.resultContracts.id);
    if (file.sha256 !== p.resultContracts.sha256 || file.size !== p.resultContracts.size) throw invalidState("成果格式与冻结清单不符");
    return validateResultSchemas(JSON.parse(Buffer.from(file.bytes).toString("utf8")));
  }
  private scienceRules(p:SPProject) {
    if(!p.scientificChecks)return undefined;const f=this.file(p.id,p.scientificChecks.id);
    if(f.sha256!==p.scientificChecks.sha256||f.size!==p.scientificChecks.size)throw invalidState("科学检查规则与冻结记录不符");
    if(p.source){const source=this.file(p.id,p.source.artifact.id);if(source.sha256!==p.source.artifact.sha256||source.size!==p.source.artifact.size)throw invalidState("科学检查源文件与冻结记录不符");}
    return validateScientificChecks(JSON.parse(Buffer.from(f.bytes).toString("utf8")),p.source?.artifact.sha256);
  }
  private verifyScience(p:SPProject,t:SPTask,result?:unknown,run?:SPRun) {
    const rules=this.scienceRules(p);if(!rules?.tasks[t.key])return undefined;
    const r=run??p.runs.find(r=>r.id===t.executionId);
    if(!r?.output||r.kind!=="TASK"||r.taskKey!==t.key||r.revision!==evidenceRevision(p,t)||!isLatestSPRun(p.runs,r)||(!run&&r.output.id!==t.artifactId))throw invalidState("科学检查缺少当前执行成果");
    const f=this.file(p.id,r.output.id);if(f.sha256!==r.output.sha256||f.size!==r.output.size)throw invalidState("科学检查成果绑定不符");
    const value=result??envelope(JSON.parse(Buffer.from(f.bytes).toString("utf8")),r);
    const check=checkScientificResult(rules,t.key,value,p.scientificChecks!.sha256,f.sha256,p.source?.artifact.sha256)!;
    r.scientificValidation=check;if(check.status!=="PASSED")throw badRequest(scientificError(check));return check;
  }
  private alignment(p: SPProject) {
    const previous=p.history.at(-1);
    const run = this.queue(p, "ALIGN", p.coordinatorId, { revision: p.revision, agents: p.agents, proposals: p.proposals,
      publishedRequirement: p.requirementMarkdown, ...(p.governance ? {previousTasks:previous?.tasks.length?previous.tasks:previous?.alignment?.tasks??[],lastAppliedChange:p.changes.filter(c=>c.status==="APPLIED").at(-1)} : {}), decisions: p.alignment?.issues.filter(i => i.selectedOptionId) ?? [], approvedChanges: p.changes.filter(c => c.status === "APPLIED") });
    p.alignmentRunId = run.id; p.phase = "ALIGNING"; p.error = null; this.save(p, "自动对齐已启动；发布前仍需检查对齐稿");
  }
  private approvalProof(p: SPProject, t: SPTask) {
    const scientificValidation=this.verifyScience(p,t);
    const r = p.runs.find(r => r.id === t.reviewId);
    if (t.status !== "APPROVED" || !t.artifactId || !r?.output || r.kind !== "REVIEW" || r.taskKey !== t.key || r.revision !== evidenceRevision(p,t) || r.status !== "COLLECTED" || !isLatestSPRun(p.runs, r) || r.agent.id !== t.reviewerAgentId || r.agent.id === t.assigneeAgentId) throw invalidState("上游缺少当前独立评审的批准依据");
    if(p.governance) {
      const execution=p.runs.find(run=>run.id===t.executionId);
      if(!execution?.output||execution.output.id!==t.artifactId)throw invalidState("批准未绑定当前执行成果");
      for(const run of [execution,r])this.checkRunTask(p,t,run);
    }
    const artifact = this.file(p.id, t.artifactId), reviewed = r.inputs.find(i => i.artifactId === artifact.id);
    if (!reviewed || reviewed.sha256 !== artifact.sha256 || reviewed.size !== artifact.size || reviewed.filename !== artifact.filename) throw invalidState("上游批准记录没有绑定当前成果字节");
    const reviewFile = this.file(p.id, r.output.id);
    if (reviewFile.sha256 !== r.output.sha256 || reviewFile.size !== r.output.size) throw invalidState("上游评审与冻结记录不匹配");
    const reviewFileUtf8 = Buffer.from(reviewFile.bytes).toString("utf8");
    if (hash(Buffer.from(reviewFileUtf8, "utf8")) !== reviewFile.sha256) throw invalidState("上游评审不是可无损交接的 UTF-8 文件");
    const result = reviewResult(envelope(JSON.parse(reviewFileUtf8), r), t.acceptance, t.outputFilename,!!p.governance);
    if (result.verdict !== "approve") throw invalidState("上游原始评审没有批准当前成果");
    const meta = ({id,filename,size,sha256}: SciencePALArtifact) => ({id,filename,size,sha256});
    // Embed exact original text in the frozen context: independently hashable, no
    // extra attachment slot per dependency, and subject to the existing size cap.
    return { ...(t.carriedFrom?{carriedFrom:t.carriedFrom}:{}), verdict: result.verdict, reviewerAgentId: r.agent.id, reviewRunId: r.id,
      reviewedArtifact: meta(artifact), reviewArtifact: meta(reviewFile), reviewFileUtf8, ...(scientificValidation?{scientificValidation}:{}) };
  }
  private context(p: SPProject, t: SPTask) {
    return { revision: p.revision, requirement: p.requirementMarkdown, ...(p.governance?{taskFingerprint:taskFingerprint(p,t)}:{}), task: t, feedback: t.feedback, executionHistory: executionHistory(p,t),
      upstream: t.dependencies.map(key => { const upstream = p.tasks.find(t => t.key === key)!; return { key, filename: upstream.outputFilename, acceptance: upstream.acceptance, approval: this.approvalProof(p, upstream) }; }) };
  }
  private execution(p: SPProject, t: SPTask) {
    const deps = t.dependencies.map(key => p.tasks.find(t => t.key === key)!);
    if (deps.some(d => d.status !== "APPROVED" || !d.artifactId)) throw invalidState("上游成果尚未通过独立评审");
    const context = this.context(p, t); // Validate upstream approval before creating any new artifact.
    // A repaired attempt gets the previous file under a distinct immutable attachment name.
    const files = deps.map(d => d.artifactId!);
    if (t.artifactId) {
      const old = this.file(p.id, t.artifactId);
      files.push(this.storeFile(p, `previous-${t.outputFilename}`, old.bytes).id);
    }
    const r = this.queue(p, "TASK", t.assigneeAgentId, context, files, t.key);
    t.attempt++; t.executionId = r.id; t.reviewId = null; t.artifactId = null; t.review = null; t.status = "RUNNING";
    this.save(p, `${t.title} 第 ${t.attempt} 次执行已排队`);
  }
  private review(p: SPProject, t: SPTask) {
    if (t.reviewerAgentId === t.assigneeAgentId || !t.artifactId) throw invalidState("评审必须由不同 Agent 读取真实成果");
    const files = [t.artifactId, ...t.dependencies.map(key => p.tasks.find(d => d.key === key)!.artifactId!)];
    const r = this.queue(p, "REVIEW", t.reviewerAgentId, this.context(p, t), files, t.key);
    t.reviewId = r.id; t.status = "REVIEWING"; this.save(p, `${t.title} 已提交独立 Agent 评审`);
  }
  async command(id: string, action: string, raw: unknown, actorNodeId?: string): Promise<SPProject> {
    const data = object(raw);
    return this.locked(id, async p => {
      if (data.expectedState !== undefined && data.expectedState !== commandSnapshot(p)) throw revisionConflict("项目状态已变化；请检查最新待办后重新确认，不会重复执行旧操作");
      if (data.revision !== p.revision) throw revisionConflict("需求版本已更新，请刷新后重试");
      switch (action) {
        case "rename": {
          const title = string(data.title, "项目标题", 120);
          p.title = title; this.save(p, "项目展示标题已更新；冻结需求、运行与原始证据保持原样"); break;
        }
        case "align":
          if (p.phase !== "DRAFT") throw invalidState("当前阶段不能重新对齐"); this.alignment(p); break;
        case "decide": {
          if (p.phase !== "NEEDS_DECISION" || data.alignmentRunId !== p.alignmentRunId) throw invalidState("冲突裁决快照已过期");
          const issue = p.alignment!.issues.find(i => i.id === data.issueId);
          if (!issue || !issue.options.some(o => o.id === data.optionId)) throw badRequest("冲突选项不存在");
          if (issue.selectedOptionId) throw revisionConflict("此冲突已完成裁决，不能覆盖已确认的选择");
          issue.selectedOptionId = String(data.optionId); if(p.governance)p.governance.decisions.push({runId:p.alignmentRunId!,issue:structuredClone(issue)}); this.save(p, `人工裁决：${issue.title}`);
          if (p.alignment!.issues.every(i => i.selectedOptionId)) this.alignment(p);
          break;
        }
        case "set-scientific-checks": {
          if(p.phase!=="READY"||p.revision!==1||!p.alignment||p.tasks.length)throw invalidState("科学检查仅可在首次发布前添加");
          const added=validateScientificChecks(data.checks,p.source?.artifact.sha256),old=this.scienceRules(p);
          for(const key of Object.keys(added.tasks))if(!p.alignment.tasks.some(t=>t.key===key))throw badRequest("检查任务不在对齐协议中");
          const tasks={...old?.tasks};for(const [key,rules] of Object.entries(added.tasks))tasks[key]=[...(tasks[key]??[]),...rules];
          const merged=validateScientificChecks({version:1,...(p.source?{sourceSha256:p.source.artifact.sha256}:{}),tasks},p.source?.artifact.sha256);
          p.scientificChecks=this.storeFile(p,"scientific-checks.json",Buffer.from(JSON.stringify(merged)));p.alignment.tasks=p.alignment.tasks.map(t=>({...t,...(merged.tasks[t.key]?{scientificChecks:merged.tasks[t.key]}:{})}));this.save(p,"已冻结可执行科学检查；Agent 批准不能绕过");break;
        }
        case "set-constraints": {
          if(p.phase!=="READY"||p.revision!==1||!p.alignment||p.tasks.length||p.runs.some(r=>r.kind==="TASK"))throw invalidState("科研约束只能在首次发布前收紧；发布后不可覆盖");
          const schemas=constrainResearch(p,this.contracts(p),data.constraints);
          p.resultContracts=this.storeFile(p,"result-contracts.json",Buffer.from(JSON.stringify(schemas,null,2)));
          p.alignment.tasks=p.alignment.tasks.map(t=>({...t,resultSchema:schemas[t.key]!}));
          this.save(p,"科研约束已冻结：方法、参数、源文件与数值约束将先于独立评审检查");break;
        }
        case "publish": {
          if (p.phase !== "READY" || !p.alignment || p.alignment.runId !== data.alignmentRunId || p.alignment.revision !== p.revision) throw invalidState("对齐稿已过期或尚不可发布");
          this.contracts(p); // Verify immutable contracts again before publication.
          const checks=this.scienceRules(p);if(checks&&Object.keys(checks.tasks).some(key=>!p.alignment!.tasks.some(t=>t.key===key)))throw badRequest("对齐稿遗漏了配置科学检查的任务");
          if(!p.governance)p.requirementMarkdown=p.alignment.alignmentMarkdown;
          else if(!p.requirementMarkdown)p.requirementMarkdown=p.proposals.map(plan=>`## 原始提案 ${plan.agentId}\n${plan.content}`).join("\n\n")+"\n\n## 对齐说明\n"+p.alignment.alignmentMarkdown;
          assertUnaffectedAlignment(p,p.alignment.tasks);
          p.tasks=p.alignment.tasks.map(t=>{
            const retained=reusableTask(p,t);
            if(retained){this.approvalProof(p,retained);return retained;}
            return {...t,status:"WAITING",attempt:0,executionId:null,reviewId:null,artifactId:null,feedback:"",review:null} as SPTask;
          });
          p.phase = "EXECUTING"; p.error = null; this.save(p, "对齐稿已确认发布：自动执行、文件交接和独立评审开始"); break;
        }
        case "pause": p.paused = true; this.save(p, "已暂停新任务派发；已提交远端运行仍会完成并被回收"); break;
        case "resume": p.paused = false; this.save(p, "已恢复自动派发"); break;
        case "rework": {
          const t = p.tasks.find(t => t.key === data.taskKey);
          if (!t || t.status !== "CHANGES_REQUESTED" || t.attempt >= 3) throw invalidState("仅可返工被退回任务，最多三次执行");
          if (!hasRunCapacity(p)) throw invalidState("已达到项目运行上限（含续接），无法安排返工；原成果和评审保留");
          const changes = t.review?.requiredChanges ?? [];
          const feedback = p.governance ? ["Repair only failed frozen criteria. Optional suggestions and captain notes cannot expand the protocol; new research requires a separate change.",...(t.review?.checks.filter(c=>!c.passed).map(c=>`${c.criterion}: ${c.evidence}`)??[]),...changes] : [t.review?.summary, ...changes].filter((v): v is string => !!v);
          const note = typeof data.note === "string" ? data.note.slice(0, 4000).trim() : "";
          // The UI pre-fills requiredChanges; include that block once, while retaining new captain guidance.
          const knownLines = new Set(feedback.flatMap(v => v.split(/\r?\n/)).map(v => v.trim()));
          const addedNote = note.split(/\r?\n/).filter(line => !knownLines.has(line.trim())).join("\n").trim();
          if (addedNote) feedback.push(addedNote);
          t.feedback = feedback.join("\n");
          t.status = "WAITING"; p.phase = "EXECUTING"; p.error = null; this.save(p, `${t.title} 按评审意见进入返工，原成果和评审记录保留`); break;
        }
        case "supplement-review": {
          const t = p.tasks.find(t => t.key === data.taskKey);
          if (!t || t.status !== "CHANGES_REQUESTED" || !t.artifactId || !t.reviewId || data.reviewId !== t.reviewId) throw invalidState("仅可对当前退回成果补充证据复审，请核对原评审");
          const note = string(data.note, "补充证据与来源", 16000);
          const execution = p.runs.find(r => r.id === t.executionId);
          if (!execution || execution.status !== "COLLECTED" || execution.output?.id !== t.artifactId || execution.resultValidation?.status === "FAILED" || execution.scientificValidation?.status === "FAILED") throw invalidState("原成果未通过文件或科学检查，必须修复成果后返工");
          const reviews = p.runs.filter(r => r.kind === "REVIEW" && r.revision === p.revision && r.taskKey === t.key && r.inputs.some(f => f.artifactId === t.artifactId));
          if (reviews.length >= 2) throw invalidState("同一成果最多补充复审一次；仍未通过时请返工或提出研究变更");
          if (!hasRunCapacity(p)) throw invalidState("已达到项目运行上限（含续接），无法新增补证复审");
          t.feedback = [t.feedback, "Captain-supplied supplemental evidence (a claim to evaluate, not an override):", note, "Keep all frozen acceptance criteria, original artifact bytes and numeric checks. Independently review this evidence; reject if it does not resolve the original review."].filter(Boolean).join("\n");
          this.review(p, t); p.phase = "EXECUTING"; p.error = null;
          this.save(p, `${t.title} 补充证据后复审：原成果与退回评审保留，没有重新执行或直接放行`); break;
        }
        case "recover": {
          const r = p.runs.find(r => r.id === data.runId);
          if (!r || r.revision !== p.revision || r.status !== "UNKNOWN" || !this.remote.threadRuns) throw invalidState("仅可接回结果未知的提交");
          const threadId = string(data.threadId, "远端 Thread ID", 120);
          if (!/^[a-zA-Z0-9_-]+$/.test(threadId)) throw badRequest("Thread ID 格式无效");
          const candidates = await this.remote.threadRuns(threadId);
          if (candidates.length !== 1) throw invalidState("此线程必须恰好有一次运行；请核对原始新建线程，不能接回续聊线程");
          const found = candidates[0]!;
          if (found.threadId !== threadId || found.agentId !== r.agent.id || !Number.isFinite(Date.parse(found.startedAt)) || Date.parse(found.startedAt) < Date.parse(r.createdAt) - 30_000) throw badRequest("远端线程、Agent 或创建时间与此次提交不符");
          if (this.list().some(project => project.runs.some(other => other.runId === found.id))) throw invalidState("此远端运行已经绑定，不能重复接回");
          r.threadId = threadId; r.runId = found.id; r.status = "RUNNING"; r.error = null; r.updatedAt = now(); p.error = null;
          if (r.kind === "ALIGN") p.phase = "ALIGNING";
          else if (r.kind === "CHANGE_REVIEW") p.phase = "CHANGE_REVIEW";
          else { const t = p.tasks.find(t => t.key === r.taskKey)!; t.status = r.kind === "TASK" ? "RUNNING" : "REVIEWING"; p.phase = "EXECUTING"; }
          this.save(p, `已核对并接回既有远端运行 ${found.id}，没有重新提交；成果仍须通过全部冻结输入校验`); break;
        }
        case "retry": {
          const r = p.runs.find(r => r.id === data.runId);
          if (!r || r.revision !== p.revision || !["FAILED", "INVALID"].includes(r.status)) throw invalidState("仅能重试确定失败或无效输出；未知提交不得重发");
          if (!isLatestSPRun(p.runs, r)) throw invalidState("该运行已经被后续尝试替代");
          if (!hasRunCapacity(p)) throw invalidState("已达到项目运行上限");
          const retry: SPRun = { ...r, id: randomUUID(), status: "READY", output: null, threadId: null, runId: null, sandboxId: null, projectId: null,
            error: null, remoteStatus: null, createdAt: now(), updatedAt: now(), prompt: `${r.prompt}\nPrevious attempt failed validation: ${r.error ?? "unknown"}. Fix the protocol violation; read the original attachments again.${r.kind === "REVIEW" ? reviewOutputGuidance(p.tasks.find(t => t.key === r.taskKey)!.outputFilename) : ""}` };
          delete retry.resultValidation; delete retry.scientificValidation;
          delete retry.claimId;
          delete retry.localExecution;
          delete retry.continuations;
          p.runs.push(retry); p.error = null;
          if (r.kind === "ALIGN") { p.alignmentRunId = retry.id; p.phase = "ALIGNING"; }
          else if (r.kind === "CHANGE_REVIEW") { p.changes.find(c => c.runId === r.id)!.runId = retry.id; p.phase = "CHANGE_REVIEW"; }
          else {
            const t = p.tasks.find(t => t.key === r.taskKey)!;
            if (r.kind === "TASK") { if (t.attempt >= 3) throw invalidState("此任务已达到三次执行上限"); t.executionId = retry.id; t.attempt++; t.status = "RUNNING"; }
            else { t.reviewId = retry.id; t.status = "REVIEWING"; }
            p.phase = "EXECUTING";
          }
          this.save(p, `已显式重试 ${r.kind}；原失败记录保留`); break;
        }
        case "change": {
          if (!["READY", "COMPLETED", "CHANGES_REQUESTED"].includes(p.phase) || p.runs.some(r => r.revision === p.revision && unsettled(r))) throw invalidState("请等待所有已提交运行结束后，在发布前、评审退回或阶段完成时提交变更");
          const request = string(data.request, "需求变更", 8000), previousPhase = p.phase;
          const r = this.queue(p, "CHANGE_REVIEW", p.coordinatorId, { revision: p.revision, requirement: p.phase === "READY" ? p.alignment?.alignmentMarkdown : p.requirementMarkdown,
            tasks: p.tasks.length ? p.tasks : p.alignment?.tasks ?? [],
            proposals: p.proposals, ...(p.governance?{taskFingerprints:(p.tasks.length?p.tasks:p.alignment?.tasks??[]).map(t=>({key:t.key,fingerprint:taskFingerprint(p,t)}))}:{}), change: request }, p.tasks.filter(t => t.artifactId).map(t => t.artifactId!));
          p.changes.push({ ...(p.governance?{snapshotSha256:changeSnapshot(p)}:{}), ...(actorNodeId ? { requestedByNodeId: actorNodeId } : {}), id: randomUUID(), request, baseRevision: p.revision, runId: r.id, previousPhase, status: "REVIEWING", result: null });
          p.phase = "CHANGE_REVIEW"; p.error = null; this.save(p, "需求变更快照已冻结，等待 SciencePAL 影响评审"); break;
        }
        case "apply-change": {
          const c = p.changes.find(c => c.id === data.changeId);
          if (!c || p.phase !== "CHANGE_READY" || c.baseRevision !== p.revision || c.status !== "ACCEPTED" || c.result?.verdict !== "accept") throw invalidState("变更未获批或审核版本已过期");
          assertChangeSnapshot(p,c);
          const priorGovernance=p.governance?structuredClone(p.governance):undefined;
          const requirement=p.governance?applyRequirementDelta(p,c):c.result.requirementMarkdown;
          p.history.push({...(priorGovernance?{governance:priorGovernance}:{}), revision:p.revision,requirementMarkdown:p.requirementMarkdown,alignment:p.alignment,tasks:p.tasks});
          c.status="APPLIED";p.revision++;p.requirementMarkdown=requirement;p.tasks=[];p.alignment=null;
          this.alignment(p); this.save(p, p.governance?"变更已人工确认：保留原协议并追加修订；重对齐后仅受影响任务重做，未受影响成果须核验原批准后复用":"变更已人工确认：旧阶段归档，新版本重新对齐；旧成果不会被当成新版本成果"); break;
        }
        case "dismiss-change": {
          const c = p.changes.find(c => c.id === data.changeId);
          if (p.phase !== "CHANGE_READY" || !c || !["ACCEPTED", "REJECTED"].includes(c.status)) throw invalidState("没有可关闭的变更评审");
          c.status = "DISMISSED"; p.phase = c.previousPhase; this.save(p, "未应用变更，恢复此前阶段"); break;
        }
        default: throw badRequest("未知协作操作");
      }
      if (actorNodeId) this.save(p, `成员 ${actorNodeId} 执行 ${action}`);
      return this.get(id);
    });
  }
  async tick(): Promise<void> {
    for (const brief of this.list()) {
      if (this.closing || this.locks.has(brief.id)) continue;
      await this.locked(brief.id, async p => {
        try {
          if (!p.team) for (const r of p.runs.filter(r => r.revision === p.revision && ["RUNNING", "NEEDS_INPUT", "COMPLETED"].includes(r.status))) await this.observe(p, r);
          if (!p.paused && !["BLOCKED", "NEEDS_DECISION", "CHANGE_READY", "CHANGES_REQUESTED"].includes(p.phase)) {
            this.advance(p);
            if (p.team) return; // Each member's connector dispatches with that member's local key.
            const active = p.runs.filter(r => ["STARTING", "RUNNING", "NEEDS_INPUT", "COMPLETED"].includes(r.status));
            for (const r of p.runs.filter(r => r.revision === p.revision && r.status === "READY")) {
              if (active.length >= 2 || active.some(a => a.agent.id === r.agent.id)) continue;
              await this.dispatch(p, r); active.push(r);
              if (p.phase === "BLOCKED") break;
            }
          }
        } catch (error) { p.phase = "BLOCKED"; p.error = this.safe(error); this.save(p, p.error); }
      });
    }
  }
  private advance(p: SPProject) {
    if (!["EXECUTING", "REVIEWING"].includes(p.phase)) return;
    const before = JSON.stringify(p);
    if (p.tasks.length && p.tasks.every(t => t.status === "APPROVED")) { p.tasks.forEach(t=>this.approvalProof(p,t)); p.phase = "COMPLETED"; this.save(p, "全部任务通过独立 Agent 评审，协作阶段完成"); return; }
    if (p.tasks.some(t => t.status === "CHANGES_REQUESTED")) { p.phase = "CHANGES_REQUESTED"; this.save(p, "评审要求修改：下游仍被阻止，等待确认返工"); return; }
    for (const t of p.tasks) {
      if (t.status === "REVIEWING" && !t.reviewId) this.review(p, t);
      if (t.status === "WAITING" && t.dependencies.every(key => p.tasks.find(d => d.key === key)?.status === "APPROVED")) this.execution(p, t);
    }
    p.phase = p.tasks.some(t => t.status === "RUNNING" || t.status === "WAITING") ? "EXECUTING" : "REVIEWING";
    // An idle poll is not a new project version: keep open browser confirmations valid.
    if (JSON.stringify(p) !== before) this.save(p);
  }
  private safe(error: unknown) {
    return error instanceof SciencePALError || (error instanceof Error && "statusCode" in error) ? error.message : "SciencePAL 处理失败；请检查运行记录并重试确定失败的步骤";
  }
  private memberRun(p: SPProject, nodeId: string, runId: string) {
    const node = this.repo.getNode(nodeId);
    const r = p.runs.find(r => r.id === runId);
    if (!node || node.revoked || !p.team || !r || r.ownerNodeId !== nodeId) throw forbidden("只能领取或回传自己负责的运行");
    if (r.revision !== p.revision || !isLatestSPRun(p.runs, r)) throw revisionConflict("运行已被新版本替代");
    return r;
  }
  async claim(projectId: string, nodeId: string, runId: string, claimId: string): Promise<SPTeamPacket> {
    return this.locked(projectId, p => {
      const r = this.memberRun(p, nodeId, runId);
      claimId = string(claimId, "连接器领取 ID", 120);
      if (r.claimId && r.claimId !== claimId) throw revisionConflict("任务已由另一个连接器领取");
      if (p.paused || ["BLOCKED", "CHANGES_REQUESTED", "CHANGE_READY"].includes(p.phase)) throw invalidState("项目暂不能领取任务");
      const localReplay = isLocalResearchPlatform(r.agent.platform) && r.claimId === claimId && r.status === "RUNNING";
      if (!["READY", "STARTING"].includes(r.status) && !localReplay) throw invalidState("运行已领取或状态未知，不能再次启动");
      const active = p.runs.filter(x => x.id !== r.id && ["STARTING", "RUNNING", "NEEDS_INPUT", "UNKNOWN"].includes(x.status));
      if (active.length >= 2 || active.some(x => x.agent.id === r.agent.id)) throw invalidState("等待当前运行结束");
      this.contracts(p);
      if(r.kind==="TASK"||r.kind==="REVIEW")this.checkRunTask(p,p.tasks.find(t=>t.key===r.taskKey)!,r);
      const files = r.inputs.map(i => {
        const file = this.file(p.id, i.artifactId);
        if (file.sha256 !== i.sha256 || file.size !== i.size) throw invalidState("冻结输入不匹配");
        return { ...i, base64: Buffer.from(file.bytes).toString("base64") };
      });
      if (!localReplay) {
        r.claimId = claimId; r.status = isLocalResearchPlatform(r.agent.platform) ? "RUNNING" : "STARTING";
        if (isLocalResearchPlatform(r.agent.platform)) r.localExecution = { id: randomUUID(), platform: r.agent.platform! };
        r.updatedAt = now(); this.save(p, `${nodeId} 已领取 ${r.kind}；等待成员连接器回执`);
      }
      return { projectId, run: r, files };
    });
  }
  async memberStarted(projectId: string, nodeId: string, runId: string, data: { threadId: string; runId: string }) {
    return this.locked(projectId, p => {
      const r = this.memberRun(p, nodeId, runId);
      if (isLocalResearchPlatform(r.agent.platform)) throw badRequest("Codex 本地任务不能绑定 SciencePAL 远端运行");
      const threadId = string(data.threadId, "线程 ID", 120), remoteRunId = string(data.runId, "运行 ID", 120);
      if (r.threadId && (r.threadId !== threadId || r.runId !== remoteRunId)) throw revisionConflict("不能替换已绑定的远端运行");
      if (this.list().some(other => other.runs.some(x => x.id !== r.id && (x.threadId === threadId || x.runId === remoteRunId || x.continuations?.some(c => c.previousRunId === remoteRunId || c.runId === remoteRunId))))) throw revisionConflict("远端线程或运行已绑定其他任务");
      if (["RUNNING", "COLLECTED", "INVALID", "NEEDS_INPUT"].includes(r.status) && r.threadId) return r;
      if (!["STARTING", "UNKNOWN"].includes(r.status)) throw invalidState("运行未领取");
      r.threadId = threadId; r.runId = remoteRunId; r.status = "RUNNING"; r.error = null; r.updatedAt = now();
      // An UNKNOWN submission may be recovered only from this member's saved remote IDs.
      if (p.phase === "BLOCKED" && !p.runs.some(x => x.id !== r.id && ["UNKNOWN", "INVALID", "FAILED"].includes(x.status) && isLatestSPRun(p.runs, x))) {
        p.phase = r.kind === "ALIGN" ? "ALIGNING" : r.kind === "CHANGE_REVIEW" ? "CHANGE_REVIEW" : "EXECUTING"; p.error = null;
      }
      this.save(p, `${nodeId} 回传远端运行 ID（成员连接器声明）`); return r;
    });
  }
  async memberContinued(projectId: string, nodeId: string, runId: string, data: Omit<NonNullable<SPRun["continuations"]>[number], "at">) {
    return this.locked(projectId, p => {
      const r = this.memberRun(p, nodeId, runId);
      if (isLocalResearchPlatform(r.agent.platform)) throw badRequest("Codex 本地任务不使用远端续接");
      const threadId = string(data.threadId, "线程 ID", 120), previousRunId = string(data.previousRunId, "原运行 ID", 120), nextId = string(data.runId, "续接运行 ID", 120);
      if (threadId !== r.threadId || previousRunId === nextId) throw badRequest("续接必须保留原线程并使用新的运行 ID");
      if (!["sciencepal-web", "member-reply"].includes(data.source)) throw badRequest("续接来源无效");
      if (data.source === "member-reply" && (!/^[a-zA-Z0-9_-]{1,120}$/.test(data.messageId ?? "") || !/^[a-f0-9]{64}$/.test(data.replySha256 ?? ""))) throw badRequest("本机回复需保存 messageId 和答复哈希");
      const transition = { threadId, previousRunId, runId: nextId, source: data.source,
        ...(data.source === "member-reply" ? { messageId: data.messageId, replySha256: data.replySha256 } : {}) };
      const last = r.continuations?.at(-1);
      if (r.runId === nextId && last) {
        const { at: _at, ...saved } = last;
        if (JSON.stringify(saved) !== JSON.stringify(transition)) throw revisionConflict("不能替换续接记录");
        return r;
      }
      if (r.runId !== previousRunId || !["NEEDS_INPUT", "UNKNOWN"].includes(r.status) || r.output) throw revisionConflict("仅本人当前等待输入的运行可以续接");
      if ((r.continuations?.length ?? 0) >= 6 || !hasRunCapacity(p)) throw invalidState("续接次数达到上限，请检查任务设计");
      if (this.list().some(other => other.runs.some(x => x.runId === nextId || x.continuations?.some(c => c.previousRunId === nextId || c.runId === nextId)))) throw revisionConflict("续接运行已存在，不能复用旧运行");
      (r.continuations ??= []).push({ ...transition, at: now() });
      r.runId = nextId; r.status = "RUNNING"; r.remoteStatus = "running"; r.error = null; r.updatedAt = now();
      if (p.phase === "BLOCKED" && !p.runs.some(x => x.id !== r.id && isLatestSPRun(p.runs, x) && ["UNKNOWN", "FAILED", "INVALID"].includes(x.status))) {
        p.phase = r.kind === "ALIGN" ? "ALIGNING" : r.kind === "CHANGE_REVIEW" ? "CHANGE_REVIEW" : "EXECUTING"; p.error = null;
      }
      this.save(p, `${nodeId} 在原线程续接 ${previousRunId} → ${nextId}（${data.source}）`); return r;
    });
  }
  async memberComplete(projectId: string, nodeId: string, runId: string, data: { threadId: string; runId: string; agentId: string; sandboxId: string; projectId?: string; base64: string }) {
    return this.locked(projectId, p => {
      const r = this.memberRun(p, nodeId, runId);
      if (isLocalResearchPlatform(r.agent.platform)) throw badRequest("Codex 成果须使用本地任务回执");
      if (r.threadId !== data.threadId || r.runId !== data.runId || (r.agent.runtimeAgentId ?? r.agent.id) !== data.agentId) throw badRequest("成员回执与已绑定的远端身份不匹配");
      const sandboxId = string(data.sandboxId, "沙箱 ID", 120);
      const encoded = string(data.base64, "成果字节", Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4);
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.toString("base64") !== encoded) throw badRequest("成果必须为规范 base64");
      if (r.output) {
        if (r.output.sha256 !== hash(bytes) || r.sandboxId !== sandboxId) throw revisionConflict("不能替换已冻结成果");
        if (r.status === "COMPLETED") {
          this.acceptOutput(p, r);
          if (!p.paused && p.phase !== "BLOCKED") this.advance(p);
        }
        return r;
      }
      if (!["RUNNING", "NEEDS_INPUT"].includes(r.status)) throw invalidState("运行尚未登记远端 ID");
      const task = p.tasks.find(t => t.key === r.taskKey);
      if (r.kind === "REVIEW" && p.runs.find(x => x.id === task?.executionId)?.sandboxId === sandboxId) throw badRequest("评审沙箱必须独立");
      const remoteProjectId = data.projectId ? string(data.projectId, "远端项目 ID", 120) : r.projectId;
      if (r.projectId && remoteProjectId !== r.projectId) throw badRequest("成果的远端项目与原线程记录不匹配");
      r.sandboxId = sandboxId; r.projectId = remoteProjectId;
      r.output = this.storeFile(p, r.outputFilename, bytes); r.remoteStatus = "completed"; r.status = "COMPLETED";
      this.save(p, `${nodeId} 已交回成果原始字节；开始 Host 校验`);
      this.acceptOutput(p, r);
      if (!p.paused && p.phase !== "BLOCKED") this.advance(p);
      return r;
    });
  }
  async memberStatus(projectId: string, nodeId: string, runId: string, status: string, location?: unknown) {
    return this.locked(projectId, p => {
      const r = this.memberRun(p, nodeId, runId);
      if (isLocalResearchPlatform(r.agent.platform)) throw badRequest("本地任务不接受远端运行状态");
      if ((status === "FAILED" || status === "UNKNOWN") && r.status === status && location === undefined) return r;
      if (!["STARTING", "RUNNING", "NEEDS_INPUT"].includes(r.status)) throw invalidState("当前运行不接受状态更新");
      let remoteProjectId = r.projectId;
      if (location !== undefined) {
        if (status !== "NEEDS_INPUT") throw badRequest("原线程入口仅随等待输入回执登记");
        const data = object(location), id = string(data.projectId, "远端项目 ID", 120);
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw badRequest("远端项目 ID 格式无效");
        if (data.threadId !== r.threadId || data.runId !== r.runId || !r.threadId || !r.runId) throw revisionConflict("原线程入口与当前运行回执不匹配");
        if (r.projectId && r.projectId !== id) throw revisionConflict("不能替换已绑定的远端项目");
        remoteProjectId = id;
      }
      if (status === "NEEDS_INPUT") {
        if (r.status !== "NEEDS_INPUT" || r.error !== "等待成员在 SciencePAL 回复" || remoteProjectId !== r.projectId) {
          r.status = "NEEDS_INPUT"; r.error = "等待成员在 SciencePAL 回复"; r.projectId = remoteProjectId; r.updatedAt = now(); this.save(p);
        }
      }
      else if (status === "FAILED" || status === "UNKNOWN") this.block(p, r, status === "UNKNOWN" ? "成员提交结果未知；禁止自动重新提交" : "成员连接器报告远端明确失败", status);
      else throw badRequest("无效成员状态");
      return r;
    });
  }
  async memberLocalFailed(projectId: string, nodeId: string, runId: string, data: { claimId: string }) {
    return this.locked(projectId, p => {
      const r = this.memberRun(p, nodeId, runId);
      if (!isLocalResearchPlatform(r.agent.platform) || !r.localExecution || !r.claimId || data.claimId !== r.claimId) throw forbidden("本地失败回执与领取身份不匹配");
      if (r.status === "FAILED") return r;
      if (r.status !== "RUNNING" || r.output) throw invalidState("已停止或已交回的任务不能改写为失败");
      this.block(p, r, "本人本地 Agent 已明确失败；保留原任务包，请由队长确认重试", "FAILED");
      return r;
    });
  }
  async memberCompleteLocal(projectId: string, nodeId: string, runId: string, data: { claimId: string; base64: string }) {
    return this.locked(projectId, p => {
      const r = this.memberRun(p, nodeId, runId);
      if (!isLocalResearchPlatform(r.agent.platform) || !r.localExecution || !r.claimId || data.claimId !== r.claimId) throw forbidden("本地成果与冻结平台或领取身份不匹配");
      const encoded = string(data.base64, "成果字节", Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4), bytes = Buffer.from(encoded, "base64");
      if (bytes.toString("base64") !== encoded) throw badRequest("成果必须为规范 base64");
      if (r.output) {
        if (r.output.sha256 !== hash(bytes)) throw revisionConflict("不能替换已冻结成果");
        if (r.status === "COMPLETED") { this.acceptOutput(p, r); if (!p.paused && p.phase !== "BLOCKED") this.advance(p); }
        return r;
      }
      if (p.paused || ["BLOCKED", "CHANGES_REQUESTED", "CHANGE_READY"].includes(p.phase)) throw invalidState("项目暂不能提交本地成果");
      if (r.status !== "RUNNING") throw invalidState("本地任务尚未领取或已停止");
      r.output = this.storeFile(p, r.outputFilename, bytes); r.status = "COMPLETED";
      this.save(p, `${nodeId} 交回 ${researchPlatformName(r.agent.platform)} 本地成果；开始同一项目的校验与评审`);
      this.acceptOutput(p, r); if (!p.paused && p.phase !== "BLOCKED") this.advance(p);
      return r;
    });
  }
  private checkRunTask(p:SPProject,t:SPTask,r:SPRun) {
    if(!p.governance)return;
    const input=r.inputs.find(i=>i.filename==="context.json");if(!input)throw invalidState("运行缺少冻结任务快照");
    const file=this.file(p.id,input.artifactId);
    if(file.sha256!==input.sha256||file.size!==input.size)throw invalidState("任务快照与运行指纹不符");
    assertTaskInput(p,t,JSON.parse(Buffer.from(file.bytes).toString("utf8")));
  }
  private block(p: SPProject, r: SPRun, error: string, status: SPRun["status"]) {
    r.status = status; r.error = error; r.updatedAt = now(); p.phase = "BLOCKED"; p.error = error;
    const t = p.tasks.find(t => t.key === r.taskKey); if (t) t.status = "BLOCKED";
    this.save(p, `${r.kind} 未通过：${error}`);
  }
  private async dispatch(p: SPProject, r: SPRun) {
    this.contracts(p);
    if(r.kind==="TASK"||r.kind==="REVIEW")this.checkRunTask(p,p.tasks.find(t=>t.key===r.taskKey)!,r);
    const files = r.inputs.map(i => {
      const file = this.file(p.id, i.artifactId);
      if (file.sha256 !== i.sha256 || file.size !== i.size) throw invalidState("输入附件与本次运行冻结清单不符");
      return { filename: i.filename, bytes: file.bytes };
    });
    r.status = "STARTING"; r.updatedAt = now(); this.save(p, `${r.agent.name} 开始 ${r.kind}，防重记录已写入`);
    try {
      const result = await this.remote.start(r.agent.id, r.prompt, files[0], files.slice(1));
      r.threadId = result.threadId; r.runId = result.runId; r.status = "RUNNING"; r.updatedAt = now(); this.save(p, `${r.kind} 已取得远端运行 ID`);
    } catch (error) { this.block(p, r, this.safe(error), error instanceof SciencePALError && !error.uncertain ? "FAILED" : "UNKNOWN"); }
  }
  private async observe(p: SPProject, r: SPRun) {
    if (r.status !== "COMPLETED") {
      try {
        const status = await this.remote.run(r.runId!); r.remoteStatus = status; r.error = null;
        if (["failed", "stopped", "cancelled", "error"].includes(status)) { this.block(p, r, `远端运行 ${status}`, "FAILED"); return; }
        if (["asked", "paused", "waiting_for_input"].includes(status)) { r.status = "NEEDS_INPUT"; r.error = "Agent 等待补充信息；需在 SciencePAL 处理，本系统不会自行再提交"; this.save(p); return; }
        r.status = status === "completed" ? "COMPLETED" : "RUNNING"; r.updatedAt = now(); this.save(p);
      } catch (error) { r.error = this.safe(error); this.save(p); return; }
    }
    if (r.status !== "COMPLETED") return;
    try {
      const task = p.tasks.find(t => t.key === r.taskKey);
      // Recover a crash between file freezing and result validation from the saved bytes.
      // Never silently replace an already-collected artifact with a later remote edit.
      if (!r.output) {
        const info = await this.remote.sandbox(r.threadId!);
        if (info.agentId !== r.agent.id) throw badRequest("线程 Agent 身份不匹配");
        if (r.kind === "REVIEW" && p.runs.find(run => run.id === task?.executionId)?.sandboxId === info.sandboxId) throw badRequest("评审必须在独立沙箱读取成果");
        const downloaded = await this.remote.download(info.sandboxId, r.outputFilename);
        r.sandboxId = info.sandboxId; r.projectId = info.projectId ?? null;
        r.output = this.storeFile(p, r.outputFilename, downloaded); this.save(p, `${r.kind} 真实成果已采集，开始结构与字节校验`);
      }
      this.acceptOutput(p, r);
    } catch (error) { this.block(p, r, this.safe(error), "INVALID"); }
  }
  private acceptOutput(p: SPProject, r: SPRun) {
    try {
      const task = p.tasks.find(t => t.key === r.taskKey);
      const bytes = this.file(p.id, r.output!.id).bytes;
      let raw: unknown;
      try { raw = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw badRequest("Agent 成果不是有效 JSON"); }
      const result = envelope(raw, r);
      if (r.revision !== p.revision) throw revisionConflict("迟到结果属于旧需求版本");
      if (r.kind === "ALIGN") {
        if (p.alignmentRunId !== r.id) throw revisionConflict("对齐结果已被后续运行替代");
        p.alignment = alignmentResult(result, p, r, this.contracts(p)); const rules=this.scienceRules(p); if(rules)p.alignment.tasks=p.alignment.tasks.map(t=>({...t,...(rules.tasks[t.key]?{scientificChecks:rules.tasks[t.key]}:{})})); if(!p.alignment.issues.length)assertUnaffectedAlignment(p,p.alignment.tasks); p.phase = p.alignment.issues.length ? "NEEDS_DECISION" : "READY";
      } else if (r.kind === "TASK") {
        if (!task || task.executionId !== r.id) throw revisionConflict("执行结果已过期");
        this.checkRunTask(p,task,r);
        const contracts = this.contracts(p);
        if (contracts) {
          r.resultValidation = checkTaskResult(contracts, task.key, result, p.resultContracts!.sha256);
          if (r.resultValidation.status === "FAILED") throw badRequest(resultValidationError(r.resultValidation));
        }
        this.verifyScience(p,task,result,r);
        task.artifactId = r.output!.id; task.status = "REVIEWING";
      } else if (r.kind === "REVIEW") {
        if (!task || task.reviewId !== r.id) throw revisionConflict("评审结果已过期");
        this.checkRunTask(p,task,r);
        task.review = reviewResult(result, task.acceptance, task.outputFilename,!!p.governance);
        if(task.review.verdict==="approve")this.verifyScience(p,task);
        task.status = task.review.verdict === "approve" ? "APPROVED" : "CHANGES_REQUESTED";
      } else {
        const change = p.changes.find(c => c.runId === r.id);
        if (!change || change.baseRevision !== p.revision) throw revisionConflict("需求变更审核已过期");
        assertChangeSnapshot(p,change); change.result = changeResult(result, p); change.status = change.result.verdict === "accept" ? "ACCEPTED" : "REJECTED"; p.phase = "CHANGE_READY";
      }
      r.status = "COLLECTED"; r.error = null; r.updatedAt = now(); p.error = null;
      this.save(p, `${r.kind}${r.taskKey ? ` / ${r.taskKey}` : ""} 文件证据与版本校验通过${task?.review ? `；裁决 ${task.review.verdict}` : ""}`);
    } catch (error) { this.block(p, r, this.safe(error), "INVALID"); }
  }
}
