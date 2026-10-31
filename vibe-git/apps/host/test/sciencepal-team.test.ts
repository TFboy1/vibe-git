import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectNextActions, type SPProject, type SPTeamPacket } from "@vibe-git/protocol";
import { localMemberTask } from "../src/sciencepal/local-member.js";
import { buildApp } from "../src/app.js";
import { SciencePALPipeline } from "../src/sciencepal/pipeline.js";
import { SciencePALMemberConnector, type ConnectorJournal, type MemberRequest } from "../src/sciencepal/member-connector.js";
import { SciencePALError, type SciencePALInputFile, type SciencePALRemote } from "../src/sciencepal/client.js";
import type { V20Service } from "../src/v20/service.js";

const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
class MemberRemote implements SciencePALRemote {
  askKinds = new Set<string>();
  states = new Map<string, string>();
  history: { id: string; threadId: string; agentId: string; startedAt: string }[] = [];
  messages = new Map<string, string>(); messageCalls: string[] = []; continuationCalls = 0;
  loseMessageAck = false; loseStartAck = false; loseStartWithoutRun = false;
  configured = true; rejectOnce = false; rejected = false; uncertain = false; wrongReceipt = false;
  calls: { id: string; kind: string; files: SciencePALInputFile[]; bytes: Uint8Array }[] = [];
  constructor(readonly agentId: string, readonly accountPrefix = agentId) {}
  async agents() { return [{ id: this.agentId, name: `Agent ${this.agentId}` }]; }
  async start(agentId: string, prompt: string, file?: SciencePALInputFile, more: SciencePALInputFile[] = []) {
    expect(agentId).toBe(this.agentId);
    const files = [file!, ...more], context = JSON.parse(Buffer.from(file!.bytes).toString()), kind = prompt.match(/SciencePAL (\w+) job/)![1]!;
    const id = `${this.accountPrefix}-${this.calls.length}`;
    let result: any = { synthetic: true, values: [1, 2, 3] };
    if (kind === "ALIGN") result = { alignmentMarkdown: context.publishedRequirement || "# Shared requirement", issues: [], tasks: [
      { key: "data", title: "Data", goal: "Create data", boundary: "Synthetic", acceptance: ["Sum is six"], dependencies: [], assigneeAgentId: context.agents[0].id },
      { key: "analysis", title: "Analyze", goal: "Read data", boundary: "Input only", acceptance: ["Sum is six"], dependencies: ["data"], assigneeAgentId: context.agents[1].id },
    ] };
    if (kind === "REVIEW") {
      const reject = this.rejectOnce && !this.rejected; this.rejected = true;
      result = { verdict: reject ? "request_changes" : "approve", summary: "Read input bytes", checks: context.task.acceptance.map((criterion: string) => ({ criterion, passed: !reject, evidence: `${context.task.outputFilename} values read` })), requiredChanges: reject ? ["Repair result"] : [] };
    }
    if (kind === "CHANGE_REVIEW") result = { verdict: "accept", rationale: "Recompute", affectedTaskKeys: ["analysis"], requirementMarkdown: "# R2\nRecompute" };
    if(context.governance) {
      if(kind==="ALIGN")for(const t of result.tasks)t.requirementIds=context.governance.requirements.filter((r:any)=>!r.retiredBy&&(t.key==="data"?r.sourceId===context.proposals[0].id:r.sourceId!==context.proposals[0].id)).map((r:any)=>r.id);
      if(kind==="REVIEW"&&result.verdict==="request_changes")result.requiredChangeCriteria=result.requiredChanges.map(()=>result.checks[0].criterion);
      if(kind==="CHANGE_REVIEW") {result.taskImpacts=context.taskFingerprints.map((t:any)=>({...t,affected:t.key==="analysis",rationale:"Data unchanged; summary revised"}));result.requirementEdits=[];}
    }
    const bytes = Buffer.from(JSON.stringify({ revision: context.revision, inputReceipts: files.map(f => ({ filename: f.filename, sha256: this.wrongReceipt ? "bad" : hash(f.bytes), size: f.bytes.length })), result }));
    this.calls.push({ id, kind, files, bytes });
    this.history.push({ id, threadId: id, agentId, startedAt: new Date().toISOString() });
    this.states.set(id, this.askKinds.has(kind) ? "asked" : "completed");
    if (this.uncertain) throw new SciencePALError("unknown", true);
    return { threadId: id, runId: id };
  }
  async run(id: string) { return this.states.get(id) ?? "completed"; }
  async threadRuns(id: string) { return this.history.filter(r => r.threadId === id); }
  webAnswer(threadId: string) {
    const id = `${threadId}-continued-${this.history.length}`;
    this.history.push({ id, threadId, agentId: this.agentId, startedAt: new Date(Date.now() + this.history.length).toISOString() });
    this.states.set(id, "completed"); return id;
  }
  async addMessage(_thread: string, id: string, text: string) {
    this.messageCalls.push(id);
    if (this.messages.has(id) && this.messages.get(id) !== text) throw new Error("duplicate id changed content");
    this.messages.set(id, text);
    if (this.loseMessageAck) { this.loseMessageAck = false; throw new SciencePALError("lost message ack", true); }
  }
  async continueRun(threadId: string) {
    this.continuationCalls++;
    if (this.loseStartWithoutRun) throw new SciencePALError("unknown without visible run", true);
    const runId = this.webAnswer(threadId);
    if (this.loseStartAck) { this.loseStartAck = false; throw new SciencePALError("lost start ack", true); }
    return { runId };
  }
  async sandbox(id: string) { return { sandboxId: id, agentId: this.agentId, projectId: id }; }
  async download(id: string) { return this.calls.find(c => c.id === id)!.bytes; }
}
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup(sharedExpert = false, codex = false, platform = "codex", governance = false) {
  const root = await mkdtemp(join(tmpdir(), "vibe-team-")); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const hostRemote = new MemberRemote("HOST-MUST-NOT-RUN"); hostRemote.configured = false;
  const app = await buildApp({ dbPath: ":memory:", dataDir: root, staticDir: false, backupDatabase: false, sciencepal: { remote: hostRemote, worker: false } });
  cleanup.push(() => app.close());
  const pipeline = (app as any).sciencepalPipeline as SciencePALPipeline, service = (app as any).v20Service as V20Service;
  const captain = JSON.parse(await readFile(join(root, "captain.json"), "utf8"));
  const invite = JSON.parse(await readFile(join(root, "invite.json"), "utf8"));
  const member = service.join(invite.inviteToken, "http://localhost"), outsider = service.join(invite.inviteToken, "http://localhost");
  const raw = (token: string, path: string, body?: unknown, method?: string) => app.inject({ method: (method ?? (body === undefined ? "GET" : "POST")) as any, url: path, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { payload: body as any }) });
  const request = (token: string): MemberRequest => async (path, body, method) => { const r = await raw(token, path, body, method); if (r.statusCode >= 400) throw new Error(`${r.statusCode}: ${r.body}`); return r.json(); };
  const a = request(captain.nodeToken), b = request(member.nodeToken);
  await a("/api/sciencepal-team/binding", { agent: codex ? { id: platform+"-local", name: platform+" A", platform } : { id: sharedExpert ? "biology" : "a", name: "A" } }, "PUT");
  await b("/api/sciencepal-team/binding", { agent: { id: sharedExpert ? "biology" : "b", name: "B" } }, "PUT");
  const planA = await a("/api/v1/plans", { filename: "a.md", content: "# A\nSynthetic data" });
  const planB = await b("/api/v1/plans", { filename: "b.md", content: "\n# B\r\nAnalyze data\r\n" });
  const input = { ...(governance?{governanceVersion:1}:{}), title: "Two member test", coordinatorNodeId: captain.nodeId, documentIds: [planA.id, planB.id] };
  const project = await a<SPProject>("/api/sciencepal-team/projects", input);
  const remoteA = new MemberRemote(sharedExpert ? "biology" : "a", "a"), remoteB = new MemberRemote(sharedExpert ? "biology" : "b", "b");
  let savedA: ConnectorJournal = { projectId: project.id, phase: "IDLE" };
  const connectorA = new SciencePALMemberConnector(remoteA, a, structuredClone(savedA), async j => { savedA = structuredClone(j); });
  const connectorB = new SciencePALMemberConnector(remoteB, b, { projectId: project.id, phase: "IDLE" }, async () => {});
  const command = (action: string, body: object = {}, req = a) => req<SPProject>(`/api/sciencepal-team/projects/${project.id}/commands/${action}`, { revision: pipeline.get(project.id).revision, ...body });
  const until = async (phase: string) => {
    for (let i = 0; i < 30; i++) {
      if (pipeline.get(project.id).phase === phase) return pipeline.get(project.id);
      await pipeline.tick(); await connectorA.step(); await connectorB.step();
    }
    throw new Error(`Not settled: ${pipeline.get(project.id).phase}`);
  };
  const publish = async () => { await command("align"); const p = await until("READY"); await command("publish", { alignmentRunId: p.alignmentRunId }); };
  return { root, invite, app, service, pipeline, hostRemote, captain, member, outsider, raw, a, b, planA, planB, input, project, remoteA, remoteB, connectorA, connectorB, command, until, publish, saved: () => savedA };
}

describe("SciencePAL original member identity and distributed handoff", () => {

  it("carries original continuation history into review and rework without private replies", async()=>{
    const s=await setup();await s.publish();s.remoteA.askKinds.add('TASK');s.remoteB.rejectOnce=true;await s.pipeline.tick();
    await s.connectorA.step();expect(s.pipeline.get(s.project.id).runs.at(-1)!.status).toBe('NEEDS_INPUT');
    const original={...s.connectorA.journal.remote!};await s.connectorA.reply('PRIVATE ANSWER: research parameter');
    s.remoteA.askKinds.clear();await s.connectorA.step();await s.pipeline.tick();
    const p=s.pipeline.get(s.project.id),review=p.runs.find(r=>r.kind==='REVIEW')!;
    const context=JSON.parse(Buffer.from(s.pipeline.file(p.id,review.inputs[0]!.artifactId).bytes).toString());
    expect(context.executionHistory.attempts).toHaveLength(1);
    expect(context.executionHistory.attempts[0]).toMatchObject({threadId:original.threadId,artifact:{id:p.tasks[0]!.artifactId},continuations:[{previousRunId:original.runId,source:'member-reply'}]});
    expect(JSON.stringify(context.executionHistory)).not.toMatch(/PRIVATE ANSWER|claimId|nodeToken|replyText|messageId/);
    await s.connectorB.step();await s.pipeline.tick();expect(s.pipeline.get(p.id).phase).toBe('CHANGES_REQUESTED');
    await s.command('rework',{taskKey:'data'});
    const repaired=s.pipeline.get(p.id).runs.at(-1)!;
    const retryContext=JSON.parse(Buffer.from(s.pipeline.file(p.id,repaired.inputs[0]!.artifactId).bytes).toString());
    expect(retryContext.executionHistory.attempts).toHaveLength(1);
    expect(retryContext.executionHistory.attempts[0].continuations[0].threadId).toBe(original.threadId);
    expect(retryContext.executionHistory.limitation).toContain('Not an independent provider audit');
  });

  it("supplements rejected evidence once without changing bytes, criteria, author or execution count", async()=>{
    const s=await setup();s.remoteB.rejectOnce=true;await s.publish();const rejected=await s.until('CHANGES_REQUESTED');
    const task=rejected.tasks[0]!, old={artifactId:task.artifactId,executionId:task.executionId,attempt:task.attempt,acceptance:task.acceptance,reviewId:task.reviewId};
    const path=`/api/sciencepal-team/projects/${rejected.id}/commands/supplement-review`;
    const body={revision:rejected.revision,taskKey:'data',reviewId:old.reviewId,note:'Observed original tool record; source and timestamps supplied for independent assessment.\n'+ '# original tool output\n'.repeat(250)};
    expect((await s.raw(s.member.nodeToken,path,body)).statusCode).toBe(403);
    expect((await s.raw(s.captain.nodeToken,path,{...body,reviewId:'stale'})).statusCode).toBe(409);
    expect((await s.raw(s.captain.nodeToken,path,{...body,note:''})).statusCode).toBe(400);
    expect((await s.raw(s.captain.nodeToken,path,{...body,note:'x'.repeat(16001)})).statusCode).toBe(400);
    const p=await s.command('supplement-review',body), revised=p.tasks[0]!;
    expect(revised).toMatchObject({artifactId:old.artifactId,executionId:old.executionId,attempt:old.attempt,acceptance:old.acceptance,status:'REVIEWING'});
    expect(p.runs.find(r=>r.id===old.reviewId)!.output).not.toBeNull();expect(p.runs.filter(r=>r.kind==='TASK'&&r.taskKey==='data')).toHaveLength(1);
    const review=p.runs.find(r=>r.id===revised.reviewId)!;expect(review.agent.id).toBe(task.reviewerAgentId);
    const context=JSON.parse(Buffer.from(s.pipeline.file(p.id,review.inputs[0]!.artifactId).bytes).toString());expect(context.feedback).toContain(body.note);
    expect(p.tasks[1]!.executionId).toBeNull();expect((await s.raw(s.captain.nodeToken,path,body)).statusCode).toBe(409);
    s.remoteB.rejected=false;await s.until('CHANGES_REQUESTED');
    const latest=s.pipeline.get(p.id);expect((await s.raw(s.captain.nodeToken,path,{...body,reviewId:latest.tasks[0]!.reviewId})).statusCode).toBe(409);
    expect(projectNextActions(latest,s.captain.nodeId).actions.some(a=>a.operation==='supplement-review'&&a.body?.taskKey==='data')).toBe(false);
    await s.command('rework',{taskKey:'data'});await s.until('COMPLETED');
  });

  it("retries an explicitly throttled initial submission with the same claim identity", async () => {
    const s = await setup(); await s.command('align');
    const start = s.remoteA.start.bind(s.remoteA); let rejected = false;
    s.remoteA.start = async (...args) => { if (!rejected) { rejected = true; throw new SciencePALError('429', false, true); } return start(...args); };
    await expect(s.connectorA.step()).rejects.toThrow('429'); const saved = s.saved(), claim = saved.claimId;
    expect(saved.phase).toBe('CLAIMING');
    await new SciencePALMemberConnector(s.remoteA, s.a, saved, async () => {}).step();
    const r = s.pipeline.get(s.project.id).runs[0]!;
    expect(r.claimId).toBe(claim); expect(r.status).toBe('COLLECTED'); expect(s.remoteA.calls).toHaveLength(1);
  });
  it("automatically adopts a web answer in the original thread without sending or starting anything", async () => {
    const s = await setup(true); s.remoteA.askKinds.add("ALIGN"); await s.command("align");
    await s.connectorA.step();
    const initial = s.pipeline.get(s.project.id).runs[0]!;
    expect(initial.status).toBe("NEEDS_INPUT");
    await s.connectorA.step(); expect(s.remoteA.continuationCalls).toBe(0); // no answer, no guessing
    const next = s.remoteA.webAnswer(initial.threadId!);
    await s.connectorA.step(); await s.connectorA.step();
    const done = s.pipeline.get(s.project.id);
    expect(done.phase).toBe("READY");
    expect(done.runs[0]).toMatchObject({ threadId: initial.threadId, runId: next, status: "COLLECTED", continuations: [{ previousRunId: initial.runId, runId: next, source: "sciencepal-web" }] });
    expect(s.remoteA.calls).toHaveLength(1); expect(s.remoteA.messages.size).toBe(0); expect(s.remoteA.continuationCalls).toBe(0);
  });
  it("deduplicates a saved answer after a lost message acknowledgement and restart", async () => {
    const s = await setup(); s.remoteA.askKinds.add("ALIGN"); await s.command("align"); await s.connectorA.step();
    s.remoteA.loseMessageAck = true;
    await expect(s.connectorA.reply("Use the frozen research protocol.")).rejects.toThrow("lost message ack");
    const restarted = new SciencePALMemberConnector(s.remoteA, s.a, s.saved(), async () => {});
    await restarted.step(); await restarted.step();
    expect(s.remoteA.messages.size).toBe(1); expect(new Set(s.remoteA.messageCalls).size).toBe(1);
    expect(s.remoteA.continuationCalls).toBe(1); expect(s.pipeline.get(s.project.id).phase).toBe("READY");
    expect(s.pipeline.get(s.project.id).runs[0]!.continuations![0]).toMatchObject({ source: "member-reply", replySha256: hash(Buffer.from("Use the frozen research protocol.")) });
  });
  it("recovers a lost continuation start response without a second start or answer", async () => {
    const s = await setup(); s.remoteA.askKinds.add("ALIGN"); await s.command("align"); await s.connectorA.step();
    s.remoteA.loseStartAck = true; await s.connectorA.reply("Keep the original data.");
    const restarted = new SciencePALMemberConnector(s.remoteA, s.a, s.saved(), async () => {});
    await restarted.step(); await restarted.step();
    expect(s.remoteA.continuationCalls).toBe(1); expect(s.remoteA.messageCalls).toHaveLength(1);
    expect(s.pipeline.get(s.project.id).phase).toBe("READY");
  });
  it("does not repeat an uncertain start when no new run is visible", async () => {
    const s = await setup(); s.remoteA.askKinds.add("ALIGN"); await s.command("align"); await s.connectorA.step();
    s.remoteA.loseStartWithoutRun = true; await s.connectorA.reply("Continue this protocol.");
    await s.connectorA.step(); await s.connectorA.step();
    await expect(s.connectorA.reply("replacement answer")).rejects.toThrow("已有待确认");
    expect(s.remoteA.continuationCalls).toBe(1); expect(s.remoteA.messages.size).toBe(1);
    expect(s.pipeline.get(s.project.id).runs[0]!.status).toBe("NEEDS_INPUT");
  });
  it("retries an explicitly rejected start without re-posting the saved answer", async () => {
    const s = await setup(); s.remoteA.askKinds.add('ALIGN'); await s.command('align'); await s.connectorA.step();
    const start = s.remoteA.continueRun.bind(s.remoteA); let rejected = false;
    s.remoteA.continueRun = async thread => { if (!rejected) { rejected = true; throw new SciencePALError('rate limited', false, true); } return start(thread); };
    await expect(s.connectorA.reply('Keep the original protocol.')).rejects.toThrow('rate limited');
    await s.connectorA.step(); await s.connectorA.step();
    expect(s.remoteA.messageCalls).toHaveLength(1); expect(s.remoteA.continuationCalls).toBe(1);
    expect(s.pipeline.get(s.project.id).phase).toBe('READY');
  });
  it("rejects superseded-run output after continuation and detects corrupted history in evidence", async () => {
    const s = await setup(); s.remoteA.askKinds.add('ALIGN'); await s.command('align'); await s.connectorA.step();
    const initial = s.saved().remote!; await s.connectorA.reply('Use the unchanged inputs.');
    const r = s.pipeline.get(s.project.id).runs[0]!;
    await expect(s.pipeline.memberComplete(s.project.id, s.captain.nodeId, r.id, { ...initial, agentId:'a', sandboxId:initial.threadId, base64:Buffer.from(s.remoteA.calls[0]!.bytes).toString('base64') })).rejects.toThrow('不匹配');
    await s.connectorA.step();
    const corrupted = s.pipeline.get(s.project.id); corrupted.runs[0]!.continuations![0]!.threadId = 'other-thread';
    s.service.repo.db.prepare('UPDATE sciencepal_projects SET data=? WHERE id=?').run(JSON.stringify(corrupted), corrupted.id);
    expect(()=>s.pipeline.evidence(corrupted.id)).toThrow('原线程');
  });
  it("replays a continuation acknowledgement lost after Host persistence", async () => {
    const s = await setup(); s.remoteA.askKinds.add("ALIGN"); await s.command("align"); await s.connectorA.step();
    const remote = s.saved().remote!; s.remoteA.webAnswer(remote.threadId);
    let fail = true, snapshot = s.saved();
    const request: MemberRequest = async (path, body, method) => { const value = await s.a(path, body, method); if (path.endsWith('/continued') && fail) { fail = false; throw new Error('lost Host ack'); } return value; };
    const connector = new SciencePALMemberConnector(s.remoteA, request, snapshot, async j => { snapshot = structuredClone(j); });
    await expect(connector.step()).rejects.toThrow('lost Host ack');
    const restarted = new SciencePALMemberConnector(s.remoteA, s.a, snapshot, async () => {});
    await restarted.step(); await restarted.step();
    expect(s.pipeline.get(s.project.id).runs[0]!.continuations).toHaveLength(1);
    expect(s.pipeline.get(s.project.id).phase).toBe('READY'); expect(s.remoteA.calls).toHaveLength(1);
  });
  it("rejects ambiguous, foreign and stale remote continuation histories", async () => {
    const s = await setup(); s.remoteA.askKinds.add('ALIGN'); await s.command('align'); await s.connectorA.step();
    const { threadId } = s.saved().remote!;
    s.remoteA.webAnswer(threadId); s.remoteA.webAnswer(threadId);
    await expect(s.connectorA.step()).rejects.toThrow('多个');
    s.remoteA.history.pop(); s.remoteA.history.at(-1)!.agentId = 'foreign';
    await expect(s.connectorA.step()).rejects.toThrow('不匹配');
    s.remoteA.history.at(-1)!.agentId = 'a'; s.remoteA.history.at(-1)!.startedAt = '2000-01-01T00:00:00Z';
    await expect(s.connectorA.step()).rejects.toThrow('过早');
    expect(s.pipeline.get(s.project.id).runs[0]!.continuations).toBeUndefined();
    expect(s.remoteA.continuationCalls).toBe(0);
  });
  it("rejects replies while paused, running, revoked, or already answered on the web", async () => {
    const s = await setup(); s.remoteA.askKinds.add('ALIGN'); await s.command('align'); await s.connectorA.step();
    await s.command('pause'); await expect(s.connectorA.reply('reply')).rejects.toThrow('暂停'); await s.command('resume');
    const remote = s.saved().remote!; s.remoteA.states.set(remote.runId, 'running');
    await expect(s.connectorA.reply('reply')).rejects.toThrow('未等待输入');
    s.remoteA.states.set(remote.runId, 'asked'); s.remoteA.webAnswer(remote.threadId);
    await expect(s.connectorA.reply('reply')).rejects.toThrow('网页已产生');
    const node = s.service.repo.getNode(s.captain.nodeId)!; s.service.repo.putNode({ ...node, revoked: true });
    await expect(s.connectorA.reply('reply')).rejects.toThrow('403');
    expect(s.remoteA.messages.size).toBe(0);
  });
  it("enforces owner, original thread, compare-and-swap, history immutability and continuation limit", async () => {
    const s = await setup(true); s.remoteA.askKinds.add('ALIGN'); await s.command('align'); await s.connectorA.step();
    const r = s.pipeline.get(s.project.id).runs[0]!, path = `/api/sciencepal-team/projects/${s.project.id}/runs/${r.id}/continued`;
    const body = { threadId: r.threadId, previousRunId: r.runId, runId: 'next-1', source: 'sciencepal-web' };
    expect((await s.raw(s.member.nodeToken, path, body)).statusCode).toBe(403);
    expect((await s.raw(s.captain.nodeToken, path, { ...body, threadId: 'replacement' })).statusCode).toBe(400);
    await s.a(path, body); await s.a(path, body);
    expect((await s.raw(s.captain.nodeToken, path, { ...body, source: 'member-reply', messageId: 'x', replySha256: '0'.repeat(64) })).statusCode).toBe(409);
    expect((await s.raw(s.captain.nodeToken, path, { ...body, runId: 'next-2' })).statusCode).toBe(409);
    for (let i = 2; i <= 6; i++) { await s.pipeline.memberStatus(s.project.id, s.captain.nodeId, r.id, 'NEEDS_INPUT'); await s.a(path, { ...body, previousRunId: `next-${i-1}`, runId: `next-${i}` }); }
    await s.pipeline.memberStatus(s.project.id, s.captain.nodeId, r.id, 'NEEDS_INPUT');
    expect((await s.raw(s.captain.nodeToken, path, { ...body, previousRunId: 'next-6', runId: 'next-7' })).statusCode).toBe(409);
    expect(s.pipeline.get(s.project.id).runs[0]!.continuations).toHaveLength(6);
  });
  it("finishes both members' research workflow, rework and R2 with web replies at every stage", async () => {
    const s = await setup(true); s.remoteB.rejectOnce = true;
    for (const remote of [s.remoteA, s.remoteB]) remote.askKinds = new Set(['ALIGN','TASK','REVIEW','CHANGE_REVIEW']);
    const until = async (phase: string) => {
      for (let i=0; i<80; i++) {
        if (s.pipeline.get(s.project.id).phase === phase) return s.pipeline.get(s.project.id);
        for (const [c, remote] of [[s.connectorA,s.remoteA],[s.connectorB,s.remoteB]] as const) {
          await c.step();
          if (c.journal.remote && await remote.run(c.journal.remote.runId) === 'asked' && !(await remote.threadRuns(c.journal.remote.threadId)).some(r=>r.id!==c.journal.remote!.runId)) remote.webAnswer(c.journal.remote.threadId);
        }
        await s.pipeline.tick();
      }
      throw new Error('Workflow did not settle');
    };
    await s.command('align'); let ready = await until('READY'); await s.command('publish', { alignmentRunId: ready.alignmentRunId });
    await until('CHANGES_REQUESTED'); await s.command('rework', { taskKey:'data' }); await until('COMPLETED');
    await s.command('change', { request:'R2 check', }, s.b); const reviewed = await until('CHANGE_READY');
    await s.command('apply-change', { changeId: reviewed.changes[0]!.id }); ready = await until('READY');
    await s.command('publish', { alignmentRunId: ready.alignmentRunId }); const done = await until('COMPLETED');
    expect(done.runs.every(r=>r.continuations?.length === 1)).toBe(true);
    expect(s.pipeline.evidence(done.id,1).allApproved).toBe(true); expect(s.pipeline.evidence(done.id,2).allApproved).toBe(true);
    expect(s.remoteA.continuationCalls+s.remoteB.continuationCalls).toBe(0); expect(s.hostRemote.calls).toHaveLength(0);
  });
  it("keeps two members using the same built-in expert separate through rework and R2", async () => {
    const s = await setup(true);
    expect(new Set(s.project.agents.map(a => a.id)).size).toBe(2);
    expect(s.project.agents.map(a => a.runtimeAgentId)).toEqual(["biology", "biology"]);
    s.remoteB.rejectOnce = true;
    await s.publish(); await s.until("CHANGES_REQUESTED");
    await s.command("rework", { taskKey: "data" }); await s.until("COMPLETED");
    await s.command("change", { request: "R2 independent analysis" }, s.b);
    const reviewed = await s.until("CHANGE_READY");
    await s.command("apply-change", { changeId: reviewed.changes[0]!.id });
    const ready = await s.until("READY");
    await s.command("publish", { alignmentRunId: ready.alignmentRunId });
    const done = await s.until("COMPLETED");
    for (const t of done.tasks) {
      expect(t.assigneeAgentId).not.toBe(t.reviewerAgentId);
      const execution = done.runs.find(r => r.id === t.executionId)!;
      const review = done.runs.find(r => r.id === t.reviewId)!;
      expect(execution.ownerNodeId).not.toBe(review.ownerNodeId);
      expect(execution.agent.runtimeAgentId).toBe(review.agent.runtimeAgentId);
    }
    expect(s.pipeline.evidence(done.id, 1).handoffs.every(h => h.checks.every(c => c.passed))).toBe(true);
    expect(s.pipeline.evidence(done.id, 2).allApproved).toBe(true);
    expect(s.hostRemote.calls).toHaveLength(0);
  });
  it("does not let a shared expert id grant another member upload or claim rights", async () => {
    const s = await setup(true); await s.command("align");
    const run = s.pipeline.get(s.project.id).runs[0]!;
    const base = `/api/sciencepal-team/projects/${s.project.id}/runs/${run.id}`;
    expect((await s.raw(s.member.nodeToken, base + "/claim", { claimId: "other-member" })).statusCode).toBe(403);
    await s.connectorA.step();
    expect((await s.raw(s.member.nodeToken, base + "/complete", { agentId: "biology" })).statusCode).toBe(403);
    await s.b("/api/sciencepal-team/binding", { agent: { id: "changed-expert", name: "changed" } }, "PUT");
    expect(s.pipeline.get(s.project.id).team!.members[1]!.agent.runtimeAgentId).toBe("biology");
  });
  it("refuses a frozen expert that the member's current account cannot access before starting", async () => {
    const s = await setup(true); await s.command("align");
    const wrong = new MemberRemote("unavailable");
    const connector = new SciencePALMemberConnector(wrong, s.a, { projectId: s.project.id, phase: "IDLE" }, async () => {});
    await expect(connector.step()).rejects.toThrow("本账号无法使用");
    expect(wrong.calls).toHaveLength(0);
  });
  it("runs the actual CLI to join, reuse identity, submit a proposal and open a read-only session", async () => {
    const s = await setup(), address = await s.app.listen({ host: "127.0.0.1", port: 0 });
    const joinFile = join(s.root, "join.txt"), memberFile = join(s.root, "new-member.json"), planFile = join(s.root, "plan.md");
    await writeFile(joinFile, `${address}/join/${s.invite.inviteToken}`); await writeFile(planFile, "# CLI proposal\nSynthetic task");
    const entry = fileURLToPath(new URL("../src/sciencepal/member-main.ts", import.meta.url));
    const env = { ...process.env, VIBE_GIT_JOIN_FILE: joinFile, VIBE_GIT_MEMBER_FILE: memberFile, VIBE_GIT_HOST: address, SCIENCEPAL_AUTH_FILE: "", SCIENCEPAL_API_KEY: "" };
    const cli = (...args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", entry, ...args], { env });
    await cli("join"); const credentialBytes = await readFile(memberFile, "utf8");
    await expect(cli("join")).rejects.toThrow(); expect(await readFile(memberFile, "utf8")).toBe(credentialBytes);
    const state = JSON.parse((await cli("state")).stdout); expect(state.viewer.role).toBe("member");
    const plan = JSON.parse((await cli("plan", planFile)).stdout); expect(plan.revision).toBe(1);
    const ticket = new URL((await cli("panel")).stdout.trim());
    const response = await s.app.inject({ url: ticket.pathname + ticket.search });
    expect(response.statusCode).toBe(302); expect(response.headers.location).toBe("/sciencepal/team");
    const cookie = String(response.headers["set-cookie"]).split(";")[0]!;
    expect((await s.app.inject({ url: "/api/sciencepal-team/state", headers: { cookie } })).statusCode).toBe(200);
    expect((await s.app.inject({ method: "POST", url: "/api/sciencepal-team/projects", headers: { cookie }, payload: s.input })).statusCode).toBe(403);
    const captainEnv = { ...env, VIBE_GIT_MEMBER_FILE: join(s.root, "captain.json") };
    const captainCli = (...args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", entry, ...args], { env: captainEnv });
    const template = join(s.root, "research.json");
    await writeFile(join(s.root, "source.txt"), "PUBLIC RESEARCH INPUT");
    await writeFile(template, JSON.stringify({ title: "Research", sourceFile: { path: "source.txt", filename: "source-test.txt", sourceUrl: "https://example.org/data", attribution: "Synthetic fixture" } }));
    const prepared = JSON.parse((await captainCli("prepare", s.member.node.id, template)).stdout);
    expect(prepared.documentIds).toEqual([s.planA.id, s.planB.id]);
    expect(Buffer.from(prepared.source.base64, "base64").toString()).toBe("PUBLIC RESEARCH INPUT");
    const newProject = JSON.parse((await captainCli("create", await (async () => { const file = join(s.root, "prepared.json"); await writeFile(file, JSON.stringify(prepared)); return file; })())).stdout);
    const evidenceFile = join(s.root, "evidence.json");
    await captainCli("evidence", newProject.id, evidenceFile);
    expect(JSON.parse(await readFile(evidenceFile, "utf8")).projectId).toBe(newProject.id);
    await expect(captainCli("evidence", newProject.id, evidenceFile)).rejects.toThrow();
    try { await captainCli("doctor"); throw new Error("expected missing key failure"); }
    catch (e) { const diagnostic = JSON.parse((e as { stdout: string }).stdout); expect(diagnostic.ready).toBe(false); expect(diagnostic.checks[0].passed).toBe(true); }
    expect(s.hostRemote.calls).toHaveLength(0);
  }, 20_000);
  it("requires original credentials; rejects claimed identities and legacy local access", async () => {
    const s = await setup();
    expect((await s.app.inject({ url: "/api/sciencepal-team/state", headers: { "x-member-id": s.captain.nodeId } })).statusCode).toBe(403);
    expect((await s.raw(s.outsider.nodeToken, `/api/sciencepal-team/projects/${s.project.id}`)).statusCode).toBe(403);
    const legacy = await s.app.inject({ url: `/api/sciencepal/projects/${s.project.id}/evidence`, remoteAddress: "127.0.0.1", headers: { host: "localhost" } });
    expect(legacy.statusCode).toBe(403);
    expect((await s.raw(s.member.nodeToken, "/api/sciencepal-team/projects", s.input)).statusCode).toBe(403);
  });
  it("reuses proposal ownership/version checks and freezes actual documents", async () => {
    const s = await setup();
    const edit = { filename: "b.md", content: "# Changed", expectedRevision: 1 };
    expect((await s.raw(s.captain.nodeToken, `/api/v1/plans/${s.planB.id}`, edit, "PUT")).statusCode).toBe(403);
    await s.b(`/api/v1/plans/${s.planB.id}`, edit, "PUT");
    expect((await s.raw(s.member.nodeToken, `/api/v1/plans/${s.planB.id}`, edit, "PUT")).statusCode).toBe(409);
    expect((await s.raw(s.captain.nodeToken, "/api/sciencepal-team/projects", s.input)).statusCode).toBe(409);
    expect(s.pipeline.get(s.project.id).proposals[1]).toMatchObject({ ownerNodeId: s.member.node.id, documentId: s.planB.id, documentRevision: 1, content: s.planB.content, sha256: s.planB.sha256 });
  });
  it("rejects another member's claim and revocation takes effect immediately", async () => {
    const s = await setup(); await s.command("align"); const run = s.pipeline.get(s.project.id).runs[0]!;
    const path = `/api/sciencepal-team/projects/${s.project.id}/runs/${run.id}/claim`;
    expect((await s.raw(s.member.nodeToken, path, {})).statusCode).toBe(403);
    const node = s.service.repo.getNode(s.captain.nodeId)!; s.service.repo.putNode({ ...node, revoked: true });
    expect((await s.raw(s.captain.nodeToken, path, {})).statusCode).toBe(403);
  });
  it("runs two isolated connector clients through rejection, rework and approved byte handoff", async () => {
    const s = await setup(); s.remoteB.rejectOnce = true; await s.publish();
    const rejected = await s.until("CHANGES_REQUESTED");
    expect(rejected.tasks.find(t => t.key === "analysis")!.executionId).toBeNull();
    expect((await s.raw(s.member.nodeToken, `/api/sciencepal-team/projects/${s.project.id}/commands/rework`, { revision: 1, taskKey: "data" })).statusCode).toBe(403);
    await s.command("rework", { taskKey: "data" }); const done = await s.until("COMPLETED");
    expect(done.runs.filter(r => r.kind === "TASK" && r.taskKey === "data")).toHaveLength(2);
    const evidence = s.pipeline.evidence(s.project.id); expect(evidence.allApproved).toBe(true);
    expect(evidence.handoffs[0]!.checks.every(c => c.passed)).toBe(true);
    expect(evidence.team!.members.map(m => m.nodeId)).toEqual([s.captain.nodeId, s.member.node.id]);
    expect(done.runs.every(r => r.ownerNodeId && r.provenance === "member-connector")).toBe(true);
    expect(s.hostRemote.calls).toHaveLength(0);
    expect(s.remoteA.calls.every(c => c.id.startsWith("a-"))).toBe(true);
    expect(s.remoteB.calls.every(c => c.id.startsWith("b-"))).toBe(true);
  });
  it("allows member change proposals but reserves publication for captain across R2", async () => {
    const s = await setup(); await s.publish(); await s.until("COMPLETED");
    await s.command("change", { request: "Recompute in R2" }, s.b);
    const reviewed = await s.until("CHANGE_READY");
    expect(reviewed.changes[0]!.requestedByNodeId).toBe(s.member.node.id);
    expect((await s.raw(s.member.nodeToken, `/api/sciencepal-team/projects/${s.project.id}/commands/apply-change`, { revision: 1, changeId: reviewed.changes[0]!.id })).statusCode).toBe(403);
    await s.command("apply-change", { changeId: reviewed.changes[0]!.id }); const ready = await s.until("READY");
    await s.command("publish", { alignmentRunId: ready.alignmentRunId }); const done = await s.until("COMPLETED");
    expect(done.revision).toBe(2); expect(s.pipeline.evidence(s.project.id, 1).allApproved).toBe(true);
    expect(s.pipeline.evidence(s.project.id, 2).allApproved).toBe(true);
  });
  it("blocks corrupted receipts before review or downstream dispatch", async () => {
    const s = await setup(); await s.publish(); s.remoteA.wrongReceipt = true;
    await s.until("BLOCKED"); expect(s.remoteB.calls).toHaveLength(0);
    expect(s.pipeline.get(s.project.id).runs.at(-1)!.status).toBe("INVALID");
  });
  it("never repeats an uncertain remote submission after connector restart", async () => {
    const s = await setup(); await s.command("align"); s.remoteA.uncertain = true; await s.connectorA.step();
    expect(s.remoteA.calls).toHaveLength(1); expect(s.saved().phase).toBe("UNKNOWN");
    const restarted = new SciencePALMemberConnector(s.remoteA, s.a, s.saved(), async () => {});
    await restarted.step(); expect(s.remoteA.calls).toHaveLength(1);
    expect(s.pipeline.get(s.project.id).phase).toBe("BLOCKED");
  });
  it("replays a saved output acknowledgement without starting or replacing remote work", async () => {
    const s = await setup(); await s.command("align");
    let outputJournal: ConnectorJournal | undefined;
    const connector = new SciencePALMemberConnector(s.remoteA, s.a, { projectId: s.project.id, phase: "IDLE" }, async j => { if (j.phase === "OUTPUT") outputJournal = structuredClone(j); });
    await connector.step(); expect(s.pipeline.get(s.project.id).phase).toBe("READY");
    const restarted = new SciencePALMemberConnector(s.remoteA, s.a, structuredClone(outputJournal!), async () => {});
    await restarted.step(); expect(s.remoteA.calls).toHaveLength(1);
    const run = s.pipeline.get(s.project.id).runs[0]!;
    expect((await s.raw(s.captain.nodeToken, `/api/sciencepal-team/projects/${s.project.id}/runs/${run.id}/complete`, { ...outputJournal!.output, base64: Buffer.from("{}").toString("base64") })).statusCode).toBe(409);
  });
  it("recovers Host restart only with the owning connector's saved remote IDs", async () => {
    const s = await setup(); await s.command("align"); const run = s.pipeline.get(s.project.id).runs[0]!;
    const packet = await s.a<SPTeamPacket>(`/api/sciencepal-team/projects/${s.project.id}/runs/${run.id}/claim`, { claimId: "test-connector" });
    new SciencePALPipeline(s.service.repo, s.hostRemote);
    expect(s.pipeline.get(s.project.id).runs[0]!.status).toBe("UNKNOWN");
    await s.pipeline.memberStarted(s.project.id, s.captain.nodeId, packet.run.id, { threadId: "known-thread", runId: "known-run" });
    expect(s.pipeline.get(s.project.id).phase).toBe("ALIGNING");
    await expect(s.pipeline.memberStarted(s.project.id, s.captain.nodeId, packet.run.id, { threadId: "replacement", runId: "replacement" })).rejects.toThrow("替换");
  });
  it("prevents a second connector from claiming the same run and clears claim identity on explicit retry", async () => {
    const s = await setup(); await s.command("align"); const run = s.pipeline.get(s.project.id).runs[0]!;
    const path = `/api/sciencepal-team/projects/${s.project.id}/runs/${run.id}/claim`;
    await s.a(path, { claimId: "first" });
    expect((await s.raw(s.captain.nodeToken, path, { claimId: "second" })).statusCode).toBe(409);
    await s.a(path, { claimId: "first" }); // retry of the identical request is safe
    await s.pipeline.memberStatus(s.project.id, s.captain.nodeId, run.id, "FAILED");
    await s.command("retry", { runId: run.id }); await s.connectorA.step();
    expect(s.pipeline.get(s.project.id).phase).toBe("READY");
    expect(s.remoteA.calls).toHaveLength(1);
  });
  it("finishes validation from frozen bytes after a crash between storage and validation", async () => {
    const s = await setup(); await s.command("align");
    let outputJournal: ConnectorJournal | undefined;
    await new SciencePALMemberConnector(s.remoteA, s.a, { projectId: s.project.id, phase: "IDLE" }, async j => { if (j.phase === "OUTPUT") outputJournal = structuredClone(j); }).step();
    const p = s.pipeline.get(s.project.id); p.runs[0]!.status = "COMPLETED"; p.phase = "ALIGNING"; p.alignment = null;
    s.service.repo.db.prepare("UPDATE sciencepal_projects SET data=? WHERE id=?").run(JSON.stringify(p), p.id);
    await new SciencePALMemberConnector(s.remoteA, s.a, outputJournal!, async () => {}).step();
    expect(s.pipeline.get(p.id).phase).toBe("READY"); expect(s.remoteA.calls).toHaveLength(1);
  });
  it("keeps file reads scoped to the selected team project and denies revoked result uploads", async () => {
    const s = await setup(); await s.command("align"); await s.connectorA.step();
    const p = s.pipeline.get(s.project.id), run = p.runs[0]!;
    expect((await s.raw(s.outsider.nodeToken, `/api/sciencepal-team/projects/${p.id}/artifacts/${run.output!.id}`)).statusCode).toBe(403);
    const other = await s.a<SPProject>("/api/sciencepal-team/projects", s.input);
    expect((await s.raw(s.captain.nodeToken, `/api/sciencepal-team/projects/${other.id}/artifacts/${run.output!.id}`)).statusCode).toBe(404);
    const node = s.service.repo.getNode(s.captain.nodeId)!; s.service.repo.putNode({ ...node, revoked: true });
    expect((await s.raw(s.captain.nodeToken, `/api/sciencepal-team/projects/${p.id}/runs/${run.id}/complete`, {})).statusCode).toBe(403);
  });
});

describe("Codex and SciencePAL in the same member project", () => {
  const context = (s: Awaited<ReturnType<typeof setup>>) => ({ host: "http://localhost", nodeId: s.captain.nodeId, projectId: s.project.id });
  async function fixtureBytes(s: Awaited<ReturnType<typeof setup>>, packet: SPTeamPacket) {
    // Reuse deterministic research fixture generation only; no platform call is made.
    const files = packet.files.map(f => ({ filename: f.filename, bytes: Buffer.from(f.base64, 'base64') }));
    await s.remoteA.start('a', packet.run.prompt.replace(/Vibe-Git [^ ]+ /, 'Vibe-Git SciencePAL '), files[0], files.slice(1));
    return s.remoteA.calls.at(-1)!.bytes;
  }
  async function localStep(s: Awaited<ReturnType<typeof setup>>) {
    const p = s.pipeline.get(s.project.id), r = p.runs.find(r => r.ownerNodeId === s.captain.nodeId && r.revision === p.revision && r.status === 'READY');
    if (!r || p.paused || ['BLOCKED','CHANGES_REQUESTED','CHANGE_READY'].includes(p.phase)) return;
    const dir = join(s.root, r.id);
    await localMemberTask('take', s.a, context(s), dir);
    const state = JSON.parse(await readFile(join(dir, 'task.json'), 'utf8'));
    const output = join(dir, state.packet.run.outputFilename); await writeFile(output, await fixtureBytes(s, state.packet));
    await localMemberTask('submit', s.a, context(s), dir, output);
  }
  it.each(["codex","claude","cursor","gemini","opencode","deepseek"])("%s uses one project for review, rework, R2 and late-result rejection", async platform => {
    const s = await setup(false, true, platform); s.remoteB.rejectOnce = true;
    const until = async (phase: string) => { for (let i=0;i<60;i++) { if (s.pipeline.get(s.project.id).phase === phase) return s.pipeline.get(s.project.id); await localStep(s); await s.connectorB.step(); await s.pipeline.tick(); } throw new Error('not settled'); };
    await s.command('align'); const ready = await until('READY'); await s.command('publish', { alignmentRunId: ready.alignmentRunId });
    await until('CHANGES_REQUESTED'); await s.command('rework', { taskKey:'data', note:'repair' }); await until('COMPLETED');
    const old = s.pipeline.get(s.project.id).runs.find(r => r.agent.platform === platform)!;
    const bytes = Buffer.from(s.pipeline.file(s.project.id, old.output!.id).bytes).toString('base64');
    await s.command('change', { request:'R2' }, s.b); const change = await until('CHANGE_READY'); await s.command('apply-change', { changeId:change.changes[0]!.id });
    const r2 = await until('READY'); await s.command('publish', { alignmentRunId:r2.alignmentRunId }); const done = await until('COMPLETED');
    expect(s.pipeline.evidence(done.id,1).allApproved).toBe(true); expect(s.pipeline.evidence(done.id,2).allApproved).toBe(true);
    expect(done.runs.filter(r=>r.agent.platform === platform).every(r=>r.localExecution && !r.threadId && !r.runId && !r.sandboxId)).toBe(true);
    expect(done.tasks.every(t => done.runs.find(r=>r.id===t.executionId)!.agent.platform !== done.runs.find(r=>r.id===t.reviewId)!.agent.platform)).toBe(true);
    await expect(s.pipeline.memberCompleteLocal(done.id,s.captain.nodeId,old.id,{claimId:old.claimId!,base64:bytes})).rejects.toThrow('新版本');
    expect(projectNextActions(done,s.captain.nodeId).actions[0]!.kind).toBe('completed');
  });
  it("checks owner, platform, claim, revoked membership and frozen binding", async () => {
    const s = await setup(false,true); await s.command('align'); const r=s.pipeline.get(s.project.id).runs[0]!;
    const path=`/api/sciencepal-team/projects/${s.project.id}/runs/${r.id}`;
    const packet=await s.a<SPTeamPacket>(path+'/claim',{claimId:'saved'}), bytes=Buffer.from(await fixtureBytes(s,packet)).toString('base64');
    expect((await s.raw(s.member.nodeToken,path+'/complete-local',{claimId:'saved',base64:bytes})).statusCode).toBe(403);
    expect((await s.raw(s.captain.nodeToken,path+'/complete-local',{claimId:'wrong',base64:bytes})).statusCode).toBe(403);
    expect((await s.raw(s.captain.nodeToken,path+'/started',{threadId:'pretend',runId:'pretend'})).statusCode).toBe(400);
    expect((await s.raw(s.captain.nodeToken,path+'/complete',{threadId:'pretend',runId:'pretend'})).statusCode).toBe(400);
    await s.a('/api/sciencepal-team/binding',{agent:{id:'a',name:'SciencePAL'}},'PUT');
    expect(s.pipeline.get(s.project.id).runs[0]!.agent.platform).toBe('codex');
    const node=s.service.repo.getNode(s.captain.nodeId)!;s.service.repo.putNode({...node,revoked:true});
    expect((await s.raw(s.captain.nodeToken,path+'/complete-local',{claimId:'saved',base64:bytes})).statusCode).toBe(403);
    const sp = await setup(); await sp.command('align'); const remote=sp.pipeline.get(sp.project.id).runs[0]!;
    await sp.pipeline.claim(sp.project.id,sp.captain.nodeId,remote.id,'saved');
    await expect(sp.pipeline.memberCompleteLocal(sp.project.id,sp.captain.nodeId,remote.id,{claimId:'saved',base64:bytes})).rejects.toThrow('平台');
  });
  it("replays a lost local claim/submit acknowledgement without replacing bytes or execution identity", async () => {
    const s = await setup(false,true); await s.command('align'); const dir=join(s.root,'local'); let lost=true;
    const request: MemberRequest = async(path,body,method)=>{ const value=await s.a(path,body,method);if(lost&&path.endsWith('/claim')){lost=false;throw new Error('lost ack');}return value; };
    await expect(localMemberTask('take',request,context(s),dir)).rejects.toThrow('lost ack');
    const before=s.pipeline.get(s.project.id).runs[0]!.localExecution!.id;
    await localMemberTask('take',s.a,context(s),dir); await localMemberTask('take',s.a,context(s),dir);
    const saved=JSON.parse(await readFile(join(dir,'task.json'),'utf8')), output=join(dir,'output.json');
    await writeFile(output,await fixtureBytes(s,saved.packet));
    await localMemberTask('submit',s.a,context(s),dir,output); await localMemberTask('submit',s.a,context(s),dir,output);
    expect(s.pipeline.get(s.project.id).runs[0]!.localExecution!.id).toBe(before);
    expect(s.pipeline.get(s.project.id).runs).toHaveLength(1);
    const changed=JSON.parse(await readFile(output,'utf8'));changed.result.alignmentMarkdown='changed';await writeFile(output,JSON.stringify(changed));
    await expect(localMemberTask('submit',s.a,context(s),dir,output)).rejects.toThrow('不能替换');
  });
  it("refuses mutated input bytes, another member directory, and paused submission", async () => {
    const s=await setup(false,true); await s.command('align');const dir=join(s.root,'local');await localMemberTask('take',s.a,context(s),dir);
    const saved=JSON.parse(await readFile(join(dir,'task.json'),'utf8')), output=join(dir,'output.json');await writeFile(output,await fixtureBytes(s,saved.packet));
    await s.command('pause');await expect(localMemberTask('submit',s.a,context(s),dir,output)).rejects.toThrow('暂不能');await s.command('resume');
    await expect(localMemberTask('take',s.a,{...context(s),host:'http://other-host'},dir)).rejects.toThrow('另一成员');
    await writeFile(join(dir,'inputs','context.json'),'changed');
    await expect(localMemberTask('submit',s.a,context(s),dir,output)).rejects.toThrow('冻结输入已变化');
    expect(s.pipeline.get(s.project.id).runs[0]!.output).toBeNull();
  });
  it("blocks an invalid local envelope and retries with a fresh local execution record", async () => {
    const s=await setup(false,true);await s.command('align');const r=s.pipeline.get(s.project.id).runs[0]!;
    await s.pipeline.claim(s.project.id,s.captain.nodeId,r.id,'first');
    const old=s.pipeline.get(s.project.id).runs[0]!.localExecution!.id;
    const invalid=await s.pipeline.memberCompleteLocal(s.project.id,s.captain.nodeId,r.id,{claimId:'first',base64:Buffer.from('{}').toString('base64')});
    expect(invalid.status).toBe('INVALID');expect(s.pipeline.get(s.project.id).phase).toBe('BLOCKED');
    expect(projectNextActions(s.pipeline.get(s.project.id),s.captain.nodeId).actions[0]).toMatchObject({operation:'retry',body:{runId:r.id}});
    await s.command('retry',{runId:r.id});const retry=s.pipeline.get(s.project.id).runs.at(-1)!;expect(retry.localExecution).toBeUndefined();
    await s.pipeline.claim(s.project.id,s.captain.nodeId,retry.id,'second');expect(s.pipeline.get(s.project.id).runs.at(-1)!.localExecution!.id).not.toBe(old);
    await expect(s.pipeline.memberCompleteLocal(s.project.id,s.captain.nodeId,r.id,{claimId:'first',base64:Buffer.from('{}').toString('base64')})).rejects.toThrow('新版本');
  });
  it("next actions name the responsible member and distinguish publish, input, failure, pause and completion", async () => {
    const s=await setup(false,true); const draft=projectNextActions(s.project,s.member.node.id);expect(draft.actions[0]).toMatchObject({operation:'align',isMine:false,ownerNodeId:s.captain.nodeId});
    await s.command('align'); const queued=projectNextActions(s.pipeline.get(s.project.id),s.captain.nodeId);expect(queued.actions[0]).toMatchObject({operation:'take',platform:'codex',isMine:true});
    await localStep(s);const ready=s.pipeline.get(s.project.id);expect(projectNextActions(ready,s.captain.nodeId).actions[0]).toMatchObject({operation:'publish',body:{revision:1,alignmentRunId:ready.alignmentRunId}});
    await s.command('publish',{alignmentRunId:ready.alignmentRunId});await s.pipeline.tick();await localStep(s);
    s.remoteB.askKinds.add('REVIEW');await s.connectorB.step();const asked=s.pipeline.get(s.project.id);
    expect(projectNextActions(asked,s.captain.nodeId).actions[0]).toMatchObject({kind:'input',ownerNodeId:s.member.node.id,isMine:false,operation:'reply'});
    await s.command('pause');expect(projectNextActions(s.pipeline.get(s.project.id),s.captain.nodeId).actions[0]!.operation).toBe('resume');
    await s.command('resume');const run=asked.runs.at(-1)!;await s.pipeline.memberStatus(s.project.id,s.member.node.id,run.id,'UNKNOWN');
    const blocked=projectNextActions(s.pipeline.get(s.project.id),s.member.node.id);expect(blocked.actions[0]).toMatchObject({kind:'recover',isMine:true});expect(blocked.actions.some(a=>a.operation==='retry')).toBe(false);
  });
});

async function browserClient(s:Awaited<ReturnType<typeof setup>>,nodeId:string){
 const ticket=s.service.createBrowserTicket(s.service.repo.getNode(nodeId)!,"http://localhost");
 const exchanged=await s.app.inject({url:new URL(ticket.url).pathname});
 const cookie=String(exchanged.headers['set-cookie']).split(';')[0]!;
 const state=async()=> (await s.app.inject({url:'/api/sciencepal-team/state',headers:{cookie}})).json();
 const post=async(action:string,body:Record<string,unknown>={},headers:Record<string,string>={})=>{
  const st=await state(),p=s.pipeline.get(s.project.id);
  return s.app.inject({method:'POST',url:`/api/sciencepal-team/projects/${p.id}/commands/${action}`,headers:{host:'localhost',origin:'http://localhost',cookie,'x-vibe-csrf':st.csrfToken,'content-type':'application/json',...headers},payload:{revision:p.revision,expectedState:st.commandSnapshots?.[p.id],...body}});
 };
 return {cookie,state,post};
}
describe('Authenticated browser research controls',()=>{
 it('rejects cross-site, missing, wrong-session and invalid CSRF credentials',async()=>{
  const s=await setup(),a=await browserClient(s,s.captain.nodeId),b=await browserClient(s,s.member.node.id);
  for(const headers of [{origin:'https://foreign.example'},{origin:'null'},{'x-vibe-csrf':''},{'x-vibe-csrf':(await b.state()).csrfToken},{'sec-fetch-site':'cross-site'}])expect((await a.post('align',{},headers)).statusCode).toBe(403);
  expect(s.pipeline.get(s.project.id).runs).toHaveLength(0);
  expect((await a.post('align')).statusCode).toBe(200);
 });
 it('requires a fresh snapshot and blocks repeated old commands without a new run',async()=>{
  const s=await setup(),a=await browserClient(s,s.captain.nodeId),st=await a.state(),snapshot=st.commandSnapshots[s.project.id];
  expect((await a.post('align',{expectedState:null})).statusCode).toBe(400);
  expect((await a.post('align',{expectedState:snapshot})).statusCode).toBe(200);
  expect((await a.post('align',{expectedState:snapshot})).statusCode).toBe(409);
  expect(s.pipeline.get(s.project.id).runs).toHaveLength(1);
 });
 it('keeps an open browser confirmation valid across idle worker ticks but rejects real changes',async()=>{
  const s=await setup();await s.publish();await s.pipeline.tick();const a=await browserClient(s,s.captain.nodeId),before=await a.state(),snapshot=before.commandSnapshots[s.project.id];
  vi.useFakeTimers({toFake:['Date']});
  try {vi.setSystemTime(Date.now()+5000);await s.pipeline.tick();} finally {vi.useRealTimers();}
  expect((await a.state()).commandSnapshots[s.project.id]).toBe(snapshot);
  expect((await a.post('pause',{expectedState:snapshot})).statusCode).toBe(200);
  expect((await a.post('resume',{expectedState:snapshot})).statusCode).toBe(409);
 });
 it('keeps a waiting-input confirmation valid on repeated identical status reports',async()=>{
  const s=await setup();await s.publish();s.remoteA.askKinds.add('TASK');await s.pipeline.tick();await s.connectorA.step();
  const p=s.pipeline.get(s.project.id),run=p.runs.find(r=>r.status==='NEEDS_INPUT')!;expect(run).toBeDefined();
  const a=await browserClient(s,s.captain.nodeId),snapshot=(await a.state()).commandSnapshots[p.id];
  vi.useFakeTimers({toFake:['Date']});
  try {vi.setSystemTime(Date.now()+5000);await s.pipeline.memberStatus(p.id,s.captain.nodeId,run.id,'NEEDS_INPUT');} finally {vi.useRealTimers();}
  expect((await a.state()).commandSnapshots[p.id]).toBe(snapshot);
  expect((await a.post('pause',{expectedState:snapshot})).statusCode).toBe(200);
 });
 it('denies other members, outsiders and a different captain',async()=>{
  const s=await setup(),b=await browserClient(s,s.member.node.id),o=await browserClient(s,s.outsider.node.id);
  expect((await b.post('align')).statusCode).toBe(403);
  expect((await o.post('align',{expectedState:'fake'})).statusCode).toBe(403);
  const n=s.service.repo.getNode(s.member.node.id)!;s.service.repo.putNode({...n,role:'captain'});
  expect((await b.post('align')).statusCode).toBe(403);
 });
 it('does not grant session access to binding, claiming, submitting or recovering Agent runs',async()=>{
  const s=await setup(),a=await browserClient(s,s.captain.nodeId),st=await a.state();
  const headers={cookie:a.cookie,origin:'http://localhost','x-vibe-csrf':st.csrfToken};
  expect((await s.app.inject({method:'PUT',url:'/api/sciencepal-team/binding',headers,payload:{agent:{id:'other',name:'other'}}})).statusCode).toBe(403);
  expect((await a.post('recover',{threadId:'other'})).statusCode).toBe(403);
  await a.post('align');const r=s.pipeline.get(s.project.id).runs[0]!;
  expect((await s.app.inject({method:'POST',url:`/api/sciencepal-team/projects/${s.project.id}/runs/${r.id}/claim`,headers,payload:{claimId:'test'}})).statusCode).toBe(403);
 });
 it('revokes browser writes immediately when a member is revoked',async()=>{
  const s=await setup(),a=await browserClient(s,s.captain.nodeId),st=await a.state();
  const n=s.service.repo.getNode(s.captain.nodeId)!;s.service.repo.putNode({...n,revoked:true});
  expect((await a.post('align',{expectedState:st.commandSnapshots[s.project.id]},{'x-vibe-csrf':st.csrfToken})).statusCode).toBe(403);
 });
 it('accepts supplemental evidence only through a fresh captain browser session',async()=>{
  const s=await setup(),a=await browserClient(s,s.captain.nodeId),b=await browserClient(s,s.member.node.id);s.remoteB.rejectOnce=true;
  await s.publish();const p=await s.until('CHANGES_REQUESTED'),t=p.tasks[0]!;
  const body={taskKey:t.key,reviewId:t.reviewId,note:'Original tool event observed; independent reviewer must evaluate its limits.'};
  expect((await b.post('supplement-review',body)).statusCode).toBe(403);
  expect((await a.post('supplement-review',body,{origin:'https://foreign.example'})).statusCode).toBe(403);
  expect((await a.post('supplement-review',body)).statusCode).toBe(200);
  expect((await a.post('supplement-review',body)).statusCode).toBe(409);
  const done=await s.until('COMPLETED');expect(done.tasks[0]!.executionId).toBe(t.executionId);expect(done.tasks[0]!.artifactId).toBe(t.artifactId);expect(done.tasks[0]!.attempt).toBe(1);
 });
 it('runs browser publish, pause/resume, rejection/rework and member-proposed R2 with the real pipeline',async()=>{
  const s=await setup(),a=await browserClient(s,s.captain.nodeId),b=await browserClient(s,s.member.node.id);s.remoteB.rejectOnce=true;
  expect((await a.post('align')).statusCode).toBe(200);let ready=await s.until('READY');
  expect((await b.post('publish',{alignmentRunId:ready.alignmentRunId})).statusCode).toBe(403);
  expect((await a.post('publish',{alignmentRunId:ready.alignmentRunId})).statusCode).toBe(200);
  expect((await a.post('pause')).statusCode).toBe(200);expect(s.pipeline.get(s.project.id).paused).toBe(true);
  expect((await a.post('resume')).statusCode).toBe(200);await s.until('CHANGES_REQUESTED');
  expect((await b.post('rework',{taskKey:'data'})).statusCode).toBe(403);
  expect((await a.post('rework',{taskKey:'data',note:'Repair original output.'})).statusCode).toBe(200);await s.until('COMPLETED');
  expect(s.pipeline.evidence(s.project.id,1).allApproved).toBe(true);
  expect((await b.post('change',{request:'R2 independent analysis'})).statusCode).toBe(200);const c=await s.until('CHANGE_READY');
  expect((await a.post('apply-change',{changeId:c.changes[0]!.id})).statusCode).toBe(200);ready=await s.until('READY');
  expect((await a.post('publish',{alignmentRunId:ready.alignmentRunId,revision:1})).statusCode).toBe(409);
  expect((await a.post('publish',{alignmentRunId:ready.alignmentRunId})).statusCode).toBe(200);await s.until('COMPLETED');
  expect(s.pipeline.evidence(s.project.id,2).allApproved).toBe(true);expect(s.hostRemote.calls).toHaveLength(0);
 });
});

// Local entry tests use the real HTTP boundary, never a real SciencePAL account.
import {buildResearchPanel} from '../src/sciencepal/local-panel.js';
import {memberPresence,recordPresence} from '../src/sciencepal/presence.js';
import {EventEmitter} from 'node:events';
import type {ChildProcess} from 'node:child_process';
async function localEntry(s:Awaited<ReturnType<typeof setup>>,captain=false,realWorker=false){
 const host=await s.app.listen({host:'127.0.0.1',port:0}),profile=join(s.root,'entry-profile');let starts=0,environment:NodeJS.ProcessEnv={},child:EventEmitter|null=null;
 const panel=await buildResearchPanel({profileDir:profile,...(captain?{captainFile:join(s.root,'captain.json'),hostUrl:host}:{}),remote:()=>s.remoteA,...(realWorker?{worker:(env:NodeJS.ProcessEnv)=>spawn(process.execPath,['--use-env-proxy',fileURLToPath(new URL('../dist/sciencepal/member-main.js',import.meta.url)),'work',s.project.id],{env,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']})}:{worker:(env:NodeJS.ProcessEnv)=>{starts++;environment=env;child=new EventEmitter();(child as any).kill=()=>{child!.emit('exit',null,'SIGTERM');return true;};return child as ChildProcess;}})});
 await panel.listen();cleanup.push(()=>panel.app.close());
 const ticket=new URL(panel.ticket()),opened=await panel.app.inject({url:ticket.pathname}),cookie=String(opened.headers['set-cookie']).split(';')[0]!;
 const info=()=>panel.app.inject({url:'/api/local/research',headers:{cookie}});
 const call=async(path:string,body:unknown={},method='POST',extra:Record<string,string>={})=>{const state=(await info()).json();return panel.app.inject({url:path,method:method as any,headers:{cookie,origin:panel.origin(),'x-vibe-csrf':state.csrfToken,...extra},...(method==='GET'?{}:{payload:body as any})});};
 return {host,profile,panel,ticket,cookie,info,call,starts:()=>starts,env:()=>environment};
}
describe('Research local onboarding and member presence',()=>{
 it('gracefully stops and restarts the actual worker process without a stale journal lock',async()=>{
  const s=await setup(),l=await localEntry(s,true,true);
  await l.call('/api/local/research/agents',{apiKey:'TEST_ONLY_NO_REMOTE_RUN'});
  const wait=async(check:()=>Promise<boolean>)=>{for(let i=0;i<120;i++){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error('Worker lifecycle timeout');};
  for(let attempt=0;attempt<2;attempt++){
   expect((await l.call('/api/local/research/start',{projectId:s.project.id})).statusCode).toBe(200);
   await wait(async()=>(await readdir(l.profile)).some(f=>f.endsWith('.lock')));
   expect((await l.info()).json().runner.state).toBe('running');
   await l.call('/api/local/research/stop');
   await wait(async()=>(await l.info()).json().runner.state==='stopped');
   expect((await readdir(l.profile)).filter(f=>f.endsWith('.lock'))).toEqual([]);
  }
  expect(s.pipeline.get(s.project.id).runs).toEqual([]);
 },30000);

 it('joins once, keeps credentials and key local, and saves own proposal through the original identity',async()=>{
  const s=await setup(),l=await localEntry(s);
  expect((await l.call('/api/local/research/join',{invite:l.host+'/join/'+s.invite.inviteToken})).statusCode).toBe(200);
  expect((await l.call('/api/local/research/join',{invite:l.host+'/join/'+s.invite.inviteToken})).statusCode).toBe(409);
  const key='TEST_KEY_ONLY';expect((await l.call('/api/local/research/agents',{apiKey:key})).statusCode).toBe(200);
  expect((await l.call('/api/local/research/bind',{platform:'sciencepal',agentId:'a'})).statusCode).toBe(200);
  expect((await l.call('/api/v1/plans',{filename:'mine.md',content:'# My research'})).statusCode).toBe(200);
  const state=(await l.call('/api/sciencepal-team/state',{},'GET')).json();expect(state.viewer.id).not.toBe(s.captain.nodeId);
  expect(state.members.find((m:any)=>m.id===state.viewer.id).plan.content).toBe('# My research');
  expect(JSON.stringify(state)).not.toContain(key);expect(JSON.stringify(state)).not.toContain('nodeToken');expect((await l.info()).body).not.toContain(key);
  expect(JSON.parse(await readFile(join(l.profile,'sciencepal-auth.json'),'utf8')).apiKey).toBe(key);
 });
 it('requires one-use local tickets, own session, Origin and CSRF',async()=>{
  const s=await setup(),l=await localEntry(s,true);
  expect((await l.panel.app.inject({url:l.ticket.pathname})).statusCode).toBe(403);
  expect((await l.panel.app.inject({url:'/api/local/research'})).statusCode).toBe(403);
  expect((await l.call('/api/local/research/bind',{platform:'codex'},'POST',{origin:'https://evil.example'})).statusCode).toBe(403);
  expect((await l.call('/api/local/research/bind',{platform:'codex'},'POST',{'x-vibe-csrf':'bad'})).statusCode).toBe(403);
 });
 it('starts only the owned frozen project, prevents duplicate starts and stops only its child',async()=>{
  const s=await setup(),l=await localEntry(s,true);await l.call('/api/local/research/agents',{apiKey:'TEST_ONLY'});
  expect((await l.call('/api/local/research/start',{projectId:s.project.id})).statusCode).toBe(200);
  expect((await l.call('/api/local/research/start',{projectId:s.project.id})).statusCode).toBe(200);expect(l.starts()).toBe(1);
  expect(l.env().SCIENCEPAL_API_KEY).toBe('');expect(l.env().SCIENCEPAL_AUTH_FILE).toBe(join(l.profile,'sciencepal-auth.json'));
  expect(l.env().VIBE_GIT_CONNECTOR_STATE).toMatch(/connector-[a-f0-9]{24}\.json$/);
  expect((await l.call('/api/local/research/bind',{platform:'codex'})).statusCode).toBe(409);
  expect((await l.call('/api/local/research/stop')).json().runner.state).toBe('stopped');
 });
 it('does not pretend to start a Codex model and preserves protected Host endpoints',async()=>{
  const s=await setup(false,true),l=await localEntry(s,true);
  expect((await l.call('/api/local/research/start',{projectId:s.project.id})).statusCode).toBe(400);expect(l.starts()).toBe(0);
  expect((await l.call('/api/v1/local/cloudflare/stop')).statusCode).toBe(403);
  expect((await l.call(`/api/sciencepal-team/projects/${s.project.id}/commands/align`,{revision:1})).statusCode).toBe(403);
  expect((await l.call(`/api/sciencepal-team/projects/${s.project.id}/commands/recover`,{revision:1,expectedState:'x'})).statusCode).toBe(403);
 });
 it('derives offline on timeout without a fake browser heartbeat and ignores stale stop signals',async()=>{
  const s=await setup(),repo=s.service.repo,id=s.captain.nodeId,p=s.project.id;
  expect(memberPresence(repo,id,p,1000).connector.state).toBe('never');
  recordPresence(repo,id,p,{channel:'connector',instanceId:'instance_one',status:'ready'},1000);
  expect(memberPresence(repo,id,p,31000).connector.state).toBe('online');expect(memberPresence(repo,id,p,31001).connector.state).toBe('offline');
  recordPresence(repo,id,p,{channel:'connector',instanceId:'instance_two',status:'working'},32000);
  recordPresence(repo,id,p,{channel:'connector',instanceId:'instance_one',status:'stopped'},33000);
  expect(memberPresence(repo,id,p,33000).connector.status).toBe('working');
  expect(()=>recordPresence(repo,id,p,{channel:'connector',instanceId:'instance_three',status:'ready'},33000)).toThrow('已有活跃');
 });
 it('scopes connector heartbeats to actual membership and cannot be forged with a browser session',async()=>{
  const s=await setup(),browser=await browserClient(s,s.captain.nodeId),st=await browser.state();
  expect((await s.app.inject({method:'POST',url:'/api/sciencepal-team/heartbeat',headers:{cookie:browser.cookie,origin:'http://localhost','x-vibe-csrf':st.csrfToken},payload:{channel:'connector',instanceId:'instance_test',projectId:s.project.id,status:'ready'}})).statusCode).toBe(403);
  expect((await s.raw(s.outsider.nodeToken,'/api/sciencepal-team/heartbeat',{channel:'connector',instanceId:'instance_test',projectId:s.project.id,status:'ready'})).statusCode).toBe(403);
  const n=s.service.repo.getNode(s.captain.nodeId)!;s.service.repo.putNode({...n,revoked:true});expect((await s.raw(s.captain.nodeToken,'/api/sciencepal-team/heartbeat',{channel:'panel',instanceId:'instance_test',status:'ready'})).statusCode).toBe(403);
 });
});

import {memberJournalPath} from '../src/sciencepal/member-journal.js';
describe('Same-project local Codex actions and shared continuation journal',()=>{
 it('prepares a deterministic owned task directory, replays take, and submits immutable output for review',async()=>{
  const s=await setup(false,true),l=await localEntry(s,true);await s.command('align');const r=s.pipeline.get(s.project.id).runs[0]!;
  const body={projectId:s.project.id,runId:r.id},first=await l.call('/api/local/research/codex-take',body);expect(first.statusCode).toBe(200);const info=first.json();
  expect(info.prepared).toBe(true);expect(info.directory.startsWith(join(l.profile,'codex-tasks'))).toBe(true);
  expect((await l.call('/api/local/research/codex-take',body)).json().directory).toBe(info.directory);
  expect((await l.call('/api/local/research/codex-submit',body)).json().error).toContain('尚未找到');
  const saved=JSON.parse(await readFile(join(info.directory,'task.json'),'utf8')),files=saved.packet.files.map((f:any)=>({filename:f.filename,bytes:Buffer.from(f.base64,'base64')}));
  await s.remoteA.start('a',saved.packet.run.prompt.replace('Vibe-Git Codex','Vibe-Git SciencePAL'),files[0],files.slice(1));await writeFile(info.outputPath,s.remoteA.calls.at(-1)!.bytes);
  expect((await l.call('/api/local/research/codex-submit',{...body,directory:'not-trusted',outputPath:'not-trusted'})).json().status).toBe('COLLECTED');
  expect((await l.call('/api/local/research/codex-submit',body)).json().status).toBe('COLLECTED');expect(s.pipeline.get(s.project.id).runs).toHaveLength(1);
  const before=s.pipeline.get(s.project.id).runs[0]!.output!.sha256;await writeFile(info.outputPath,JSON.stringify({...JSON.parse(s.remoteA.calls.at(-1)!.bytes.toString()),result:{alignmentMarkdown:'replace'}}));
  expect((await l.call('/api/local/research/codex-submit',body)).statusCode).not.toBe(200);expect(s.pipeline.get(s.project.id).runs[0]!.output!.sha256).toBe(before);
 });
 it('rejects wrong platforms, forged source origins, revoked membership and unknown run ids',async()=>{
  const s=await setup(),l=await localEntry(s,true);await s.command('align');const run=s.pipeline.get(s.project.id).runs[0]!;
  const body={projectId:s.project.id,runId:run.id};expect((await l.call('/api/local/research/codex-take',body)).statusCode).toBe(403);
  expect((await l.call('/api/local/research/codex-take',body,'POST',{origin:'https://elsewhere.example'})).statusCode).toBe(403);
  expect((await l.call('/api/local/research/codex-take',{...body,runId:'other'})).statusCode).toBe(403);
  const n=s.service.repo.getNode(s.captain.nodeId)!;s.service.repo.putNode({...n,revoked:true});expect((await l.call('/api/local/research/codex-task?'+new URLSearchParams(body),{},'GET')).statusCode).toBe(403);
 });
 it('does not take over an existing CLI claim or guess a new directory for it',async()=>{
  const s=await setup(false,true),l=await localEntry(s,true);await s.command('align');const r=s.pipeline.get(s.project.id).runs[0]!;
  await localMemberTask('take',s.a,{host:l.host,nodeId:s.captain.nodeId,projectId:s.project.id},join(s.root,'original-cli-task'));
  expect((await l.call('/api/local/research/codex-take',{projectId:s.project.id,runId:r.id})).json().error).toContain('其他入口领取');
 });
 it('keeps a selected run guard when a caller passes the wrong task id',async()=>{
  const s=await setup(false,true);await s.command('align');
  await expect(localMemberTask('take',s.a,{host:'http://localhost',nodeId:s.captain.nodeId,projectId:s.project.id,runId:'wrong'},join(s.root,'wrong-run'))).rejects.toThrow('没有本人');
  expect(s.pipeline.get(s.project.id).runs[0]!.status).toBe('READY');
 });
 it('uses the exact same scoped journal in the local panel and compiled CLI resolver',async()=>{
  const s=await setup(),l=await localEntry(s,true);await l.call('/api/local/research/agents',{apiKey:'TEST_ONLY'});await l.call('/api/local/research/start',{projectId:s.project.id});
  const actual=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../dist/sciencepal/member-main.js',import.meta.url)),'journal-path',s.project.id,l.profile],{env:{...process.env,VIBE_GIT_MEMBER_FILE:join(s.root,'captain.json'),VIBE_GIT_HOST:l.host}});
  expect(actual.stdout.trim()).toBe(l.env().VIBE_GIT_CONNECTOR_STATE);await l.call('/api/local/research/stop');
 });
 it('reuses a valid in-flight legacy journal and refuses conflicting or foreign logs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vibe-journal-test-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
  const scope=hash(Buffer.from('http://localhost\nmember\np')),legacy=join(root,'connector-p.json'),current=await memberJournalPath(root,'http://localhost','member','p');
  await writeFile(legacy,JSON.stringify({scope,journal:{projectId:'p',phase:'RUNNING'}}));expect(await memberJournalPath(root,'http://localhost','member','p')).toBe(legacy);
  await writeFile(current,JSON.stringify({scope,journal:{projectId:'p',phase:'IDLE'}}));await expect(memberJournalPath(root,'http://localhost','member','p')).rejects.toThrow('两份日志');
  await expect(memberJournalPath(root,'http://localhost','different-member','p')).rejects.toThrow('其他身份');
 });
});


import {AgentRegistry} from '@vibe-git/relay/agent-registry';
import {startLocalAgent,agentRunState,reconcileLocalAgent} from '../src/sciencepal/local-agent.js';
import {managedCodexTask} from '../src/sciencepal/local-codex.js';
describe('shared research executor and constraints permissions',()=>{
 it.each([true,false])('local startup failure is retryable only when dispatch is known not to occur: %s',async safe=>{
  const s=await setup(false,true,'gemini');await s.command('align');const run=s.pipeline.get(s.project.id).runs[0]!;
  const context={host:'http://localhost',nodeId:s.captain.nodeId,projectId:s.project.id,runId:run.id,profileDir:join(s.root,'profile')};
  const info=await managedCodexTask('take',s.a,context),registry=new AgentRegistry();
  registry.register({kind:'gemini',probe:()=>({kind:'gemini',state:'unverified',detail:'fixture',version:null,transports:{appServer:'unsupported',cli:'unverified',preferred:'cli'}}),start:async()=>{throw Object.assign(new Error('start rejected'),{safeToRetry:safe});}});
  const task=JSON.parse(await readFile(join(info.directory,'task.json'),'utf8'));
  const path=`/api/sciencepal-team/projects/${s.project.id}/runs/${run.id}/failed-local`;
  expect((await s.raw(s.member.nodeToken,path,{claimId:task.claimId})).statusCode).toBe(403);
  expect((await s.raw(s.captain.nodeToken,path,{claimId:'wrong'})).statusCode).toBe(403);
  await expect(startLocalAgent(s.a,context,registry)).rejects.toThrow('start rejected');
  expect(s.pipeline.get(s.project.id).runs[0]!.status).toBe(safe?'FAILED':'RUNNING');
  expect((await agentRunState(info.directory))?.state).toBe(safe?'FAILED':'STARTING');
  if(!safe){await expect(reconcileLocalAgent(info.directory,false)).rejects.toThrow('先核对');expect((await reconcileLocalAgent(info.directory,true)).state).toBe('INTERRUPTED');}
  if(safe){await s.command('retry',{runId:run.id});expect(s.pipeline.get(s.project.id).runs.at(-1)!.status).toBe('READY');await expect(s.a(path,{claimId:task.claimId})).rejects.toThrow('新版本');}
 });

 it('starts the frozen local provider once, persists completion and rejects a restart duplicate',async()=>{
  const s=await setup(false,true,'gemini');await s.command('align');const run=s.pipeline.get(s.project.id).runs[0]!;
  const context={host:'http://localhost',nodeId:s.captain.nodeId,projectId:s.project.id,runId:run.id,profileDir:join(s.root,'profile')};
  const task=await managedCodexTask('take',s.a,context),registry=new AgentRegistry();let count=0,finish:(v:any)=>void=()=>{},received:any;
  registry.register({kind:'gemini',probe:()=>({kind:'gemini',state:'unverified',detail:'synthetic',version:null,transports:{appServer:'unsupported',cli:'unverified',preferred:'cli'}}),start:async(prompt,workspace,_transport,env)=>{count++;received={prompt,workspace,env};return {transport:'cli',runtimeId:'synthetic',done:new Promise(r=>{finish=r;}),interrupt:async()=>({status:'INTERRUPTED',detail:'test',outputSummary:null})};}});
  await startLocalAgent(s.a,context,registry,{VIBE_AGENT:'codex',SCIENCEPAL_API_KEY:'TEST_SECRET',VIBE_GIT_MEMBER_FILE:'private-profile'});expect(received.env.VIBE_AGENT).toBe('gemini');expect(received.env.SCIENCEPAL_API_KEY).toBeUndefined();expect(received.env.VIBE_GIT_MEMBER_FILE).toBeUndefined();expect(received.workspace).toBe(task.directory);expect(received.prompt).toContain('Gemini');
  await expect(startLocalAgent(s.a,context,registry)).rejects.toThrow('已有执行记录');expect(count).toBe(1);
  await expect(reconcileLocalAgent(task.directory,true)).rejects.toThrow('仍在本入口执行');
  finish({status:'COMPLETED',detail:'synthetic fixture',outputSummary:null});
  for(let i=0;i<30&&(await agentRunState(task.directory))?.state!=='COMPLETED';i++)await new Promise(r=>setTimeout(r,10));
  expect((await agentRunState(task.directory))?.state).toBe('COMPLETED');
  await expect(startLocalAgent(s.a,context,new AgentRegistry())).rejects.toThrow('已有执行记录');
  await writeFile(join(task.directory,'adapter-run.json'),'{');
  expect((await agentRunState(task.directory))?.state).toBe('STARTING');
  await expect(startLocalAgent(s.a,context,registry)).rejects.toThrow('已有执行记录');
 });
 it('rejects an unknown binding, wrong platform ID and a member editing captain constraints',async()=>{
  const s=await setup();
  expect((await s.raw(s.captain.nodeToken,'/api/sciencepal-team/binding',{agent:{id:'bad',name:'bad',platform:'typo'}},'PUT')).statusCode).toBe(400);
  expect((await s.raw(s.captain.nodeToken,'/api/sciencepal-team/binding',{agent:{id:'codex-local',name:'bad',platform:'gemini'}},'PUT')).statusCode).toBe(400);
  await s.command('align');await s.until('READY');
  await expect(s.command('set-constraints',{constraints:[{taskKey:'data',field:'seed',kind:'number',value:42}]},s.b)).rejects.toThrow('403');
  await expect(s.command('set-scientific-checks',{checks:{version:1,tasks:{data:[{id:'sum',kind:'sum',totalPath:'total',rowsPath:'rows',valueField:'value',absoluteTolerance:0}]}}},s.b)).rejects.toThrow('403');
  const frozen=await s.command('set-constraints',{constraints:[{taskKey:'data',field:'seed',kind:'number',value:42}]});expect(frozen.resultContracts).toBeDefined();
 });
});

describe('Terminal acknowledgement recovery',()=>{
 it.each([false,true])('reconciles a lost FAILED acknowledgement before or after captain retry: %s',async retried=>{
  const s=await setup();s.remoteA.askKinds.add('ALIGN');await s.command('align');await s.connectorA.step();
  const remoteId=s.connectorA.journal.remote!.runId,runId=s.connectorA.journal.localRunId!;s.remoteA.states.set(remoteId,'failed');
  let snapshot=structuredClone(s.saved()),lost=false;
  const request:MemberRequest=async(path,body,method)=>{const result=await s.a(path,body,method);if((body as any)?.status==='FAILED'&&!lost){lost=true;throw new SciencePALError('lost FAILED acknowledgement',false,true);}return result;};
  const failing=new SciencePALMemberConnector(s.remoteA,request,snapshot,async j=>{snapshot=structuredClone(j);});
  await expect(failing.step()).rejects.toThrow('lost FAILED');expect(snapshot.phase).toBe('FAILING');expect(s.pipeline.get(s.project.id).runs[0]!.status).toBe('FAILED');
  if(retried)await s.command('retry',{runId});
  const restarted=new SciencePALMemberConnector(s.remoteA,s.a,snapshot,async()=>{});await restarted.step();
  expect(restarted.journal.phase).toBe('IDLE');expect(s.remoteA.calls).toHaveLength(1);
  if(retried){await restarted.step();expect(s.remoteA.calls).toHaveLength(2);expect(s.pipeline.get(s.project.id).runs[0]!.status).toBe('FAILED');}
 });
 it('replays a rejected submission failure without dispatching again when Host acknowledgement is lost',async()=>{
  const s=await setup();await s.command('align');let starts=0,lost=false,snapshot:ConnectorJournal={phase:'IDLE',projectId:s.project.id};
  s.remoteA.start=async()=>{starts++;throw new SciencePALError('explicit rejection');};
  const request:MemberRequest=async(path,body,method)=>{const result=await s.a(path,body,method);if((body as any)?.status==='FAILED'&&!lost){lost=true;throw new SciencePALError('lost rejection acknowledgement',false,true);}return result;};
  const connector=new SciencePALMemberConnector(s.remoteA,request,snapshot,async j=>{snapshot=structuredClone(j);});
  await expect(connector.step()).rejects.toThrow('lost rejection');expect(snapshot.phase).toBe('FAILING');
  const restarted=new SciencePALMemberConnector(s.remoteA,s.a,snapshot,async()=>{});await restarted.step();expect(restarted.journal.phase).toBe('IDLE');expect(starts).toBe(1);
 });
 it('reconciles legacy RUNNING journals and makes repeated terminal reports idempotent',async()=>{
  const s=await setup();s.remoteA.askKinds.add('ALIGN');await s.command('align');await s.connectorA.step();
  const legacy=structuredClone(s.saved()),id=legacy.localRunId!,path=`/api/sciencepal-team/projects/${s.project.id}/runs/${id}/status`;
  await s.a(path,{status:'FAILED'});const before=JSON.stringify(s.pipeline.get(s.project.id));await s.a(path,{status:'FAILED'});
  expect(JSON.stringify(s.pipeline.get(s.project.id))).toBe(before);
  const restarted=new SciencePALMemberConnector(s.remoteA,s.a,legacy,async()=>{});await restarted.step();expect(restarted.journal.phase).toBe('IDLE');expect(s.remoteA.calls).toHaveLength(1);
 });
});

describe('Owner-confirmed local interruption recovery',()=>{
 it('recovers a stale marker after panel restart, retains dispatch history and still validates output',async()=>{
  const s=await setup(false,true),l=await localEntry(s,true);await s.command('align');const r=s.pipeline.get(s.project.id).runs[0]!,body={projectId:s.project.id,runId:r.id};
  const info=(await l.call('/api/local/research/codex-take',body)).json(),saved=JSON.parse(await readFile(join(info.directory,'task.json'),'utf8'));
  const files=saved.packet.files.map((f:any)=>({filename:f.filename,bytes:Buffer.from(f.base64,'base64')}));await s.remoteA.start('a',saved.packet.run.prompt.replace('Vibe-Git Codex','Vibe-Git SciencePAL'),files[0],files.slice(1));
  await writeFile(info.outputPath,s.remoteA.calls.at(-1)!.bytes);
  await writeFile(join(info.directory,'adapter-run.json'),JSON.stringify({state:'RUNNING',platform:'codex',runtimeId:'stopped-fixture',at:'2026-10-31T00:00:00Z',detail:'fixture crash'}));
  await l.panel.app.close();
  const panel=await buildResearchPanel({profileDir:l.profile,captainFile:join(s.root,'captain.json'),hostUrl:l.host});await panel.listen();cleanup.push(()=>panel.app.close());
  const opened=await panel.app.inject({url:new URL(panel.ticket()).pathname}),cookie=String(opened.headers['set-cookie']).split(';')[0]!;
  const csrf=(await panel.app.inject({url:'/api/local/research',headers:{cookie}})).json().csrfToken;
  const post=(action:string,payload:any)=>panel.app.inject({method:'POST',url:'/api/local/research/'+action,headers:{cookie,origin:panel.origin(),'x-vibe-csrf':csrf},payload});
  expect((await post('codex-submit',body)).statusCode).toBe(409);
  expect((await post('agent-reconcile',body)).statusCode).toBe(400);
  expect((await post('agent-reconcile',{...body,runId:'foreign',confirmedStopped:true})).statusCode).toBe(403);
  expect((await post('agent-reconcile',{...body,confirmedStopped:true})).json()).toMatchObject({state:'INTERRUPTED',runtimeId:'stopped-fixture',recovery:{previousState:'RUNNING',confirmedStopped:true}});
  expect((await post('agent-reconcile',{...body,confirmedStopped:true})).statusCode).toBe(200);
  await expect(startLocalAgent(s.a,{host:l.host,nodeId:s.captain.nodeId,projectId:s.project.id,runId:r.id,profileDir:l.profile})).rejects.toThrow('已有执行记录');
  await writeFile(info.outputPath,'{}');expect((await post('codex-submit',body)).statusCode).toBe(400);
  await writeFile(info.outputPath,s.remoteA.calls.at(-1)!.bytes);expect((await post('codex-submit',body)).json().status).toBe('COLLECTED');
  expect((await agentRunState(info.directory))?.recovery?.confirmedStopped).toBe(true);
 });
});


it("checks the shared budget before remote reply and keeps a repeated continuation receipt idempotent",async()=>{
 const s=await setup();s.remoteA.askKinds.add("ALIGN");await s.command("align");await s.connectorA.step();
 let p=s.pipeline.get(s.project.id);p.maxRuns=2;
 s.service.repo.db.prepare("UPDATE sciencepal_projects SET data=? WHERE id=?").run(JSON.stringify(p),p.id);
 await s.connectorA.reply("First continuation uses the final slot.");
 p=s.pipeline.get(p.id);const r=p.runs[0]!,last=r.continuations![0]!;
 const path=`/api/sciencepal-team/projects/${p.id}/runs/${r.id}/continued`;
 const {at:_at,...receipt}=last;
 expect((await s.raw(s.captain.nodeToken,path,receipt)).statusCode).toBe(200);
 await s.pipeline.memberStatus(p.id,s.captain.nodeId,r.id,"NEEDS_INPUT");
 const before=JSON.stringify(s.pipeline.get(p.id)),messages=s.remoteA.messageCalls.length;
 await expect(s.connectorA.reply("Must not send or spend another slot.")).rejects.toThrow("上限");
 expect(s.remoteA.messageCalls.length).toBe(messages);
 expect((await s.raw(s.captain.nodeToken,path,{threadId:r.threadId,previousRunId:r.runId,runId:"over-budget",source:"sciencepal-web"})).statusCode).toBe(409);
 expect(JSON.stringify(s.pipeline.get(p.id))).toBe(before);
});

it("rejects supplemental review at a continuation-filled project budget without changing evidence",async()=>{
 const s=await setup();s.remoteB.rejectOnce=true;await s.publish();const p=await s.until("CHANGES_REQUESTED");
 p.runs[0]!.continuations=[{threadId:"historical",previousRunId:"old",runId:"next",source:"sciencepal-web",at:p.createdAt}];p.maxRuns=p.runs.length+1;
 s.service.repo.db.prepare("UPDATE sciencepal_projects SET data=? WHERE id=?").run(JSON.stringify(p),p.id);
 const before=JSON.stringify(s.pipeline.get(p.id)),t=p.tasks[0]!;
 await expect(s.command("supplement-review",{taskKey:t.key,reviewId:t.reviewId,note:"Additional evidence cannot bypass the shared run budget."})).rejects.toThrow(/上限|最多/);
 await expect(s.command("rework",{taskKey:t.key})).rejects.toThrow(/上限|最多/);
 expect(projectNextActions(p,s.captain.nodeId).actions.some(a=>a.kind==="budget")).toBe(true);
 expect(JSON.stringify(s.pipeline.get(p.id))).toBe(before);
});

it("governance survives member connectors, criterion-bound rework and captain-only selective change",async()=>{
 const s=await setup(false,false,"codex",true);s.remoteB.rejectOnce=true;
 expect(s.project.governance?.version).toBe(1);
 await s.command("align");let p=await s.until("READY");await s.command("publish",{alignmentRunId:p.alignmentRunId});
 p=await s.until("CHANGES_REQUESTED");
 expect((await s.raw(s.member.nodeToken,`/api/sciencepal-team/projects/${p.id}/commands/rework`,{revision:p.revision,taskKey:"data"})).statusCode).toBe(403);
 await s.command("rework",{taskKey:"data"});p=await s.until("COMPLETED");const original=p.tasks[0]!.artifactId;
 await s.command("change",{request:"Improve summary limitations"});p=await s.until("CHANGE_READY");
 const body={revision:p.revision,changeId:p.changes.at(-1)!.id};
 expect((await s.raw(s.member.nodeToken,`/api/sciencepal-team/projects/${p.id}/commands/apply-change`,body)).statusCode).toBe(403);
 await s.command("apply-change",body);p=await s.until("READY");await s.command("publish",{alignmentRunId:p.alignmentRunId});
 p=await s.until("COMPLETED");expect(p.tasks[0]!.artifactId).toBe(original);expect(p.tasks[0]!.carriedFrom?.revision).toBe(1);
 expect(s.pipeline.evidence(p.id).allApproved).toBe(true);
});


describe('Human mistakes and safe recovery',()=>{
 it.each(['%','%ZZ','%E0%A4%A'])('rejects malformed invitation encoding %s without locking out a correct retry',async token=>{
  const s=await setup(),l=await localEntry(s);
  const bad=await l.call('/api/local/research/join',{invite:l.host+'/join/'+token});
  expect(bad.statusCode).toBe(400);
  expect((await l.info()).json()).toMatchObject({configured:false,joining:false});expect(bad.json().error).toContain('邀请链接');
  expect((await l.call('/api/local/research/join',{invite:l.host+'/join/'+s.invite.inviteToken})).statusCode).toBe(200);
 });
 it.each([
  {name:'empty file',text:''},
  {name:'unfinished JSON',text:'{"revision":1,'},
  {name:'Markdown code fence',text:'```json\n{}\n```'},
 ])('explains $name without consuming the local claim, then accepts a corrected file',async ({text})=>{
  const s=await setup(false,true),l=await localEntry(s,true);await s.command('align');
  const run=s.pipeline.get(s.project.id).runs[0]!,body={projectId:s.project.id,runId:run.id};
  const info=(await l.call('/api/local/research/codex-take',body)).json();
  const before=structuredClone(s.pipeline.get(s.project.id).runs[0]!);
  await writeFile(info.outputPath,text);
  const bad=await l.call('/api/local/research/codex-submit',body);
  expect(bad.statusCode).toBe(400);expect(bad.json().error).toContain('完整 JSON');expect(bad.json().error).toContain('无需重新领取');
  expect(s.pipeline.get(s.project.id).runs[0]).toEqual(before);
  const saved=JSON.parse(await readFile(join(info.directory,'task.json'),'utf8')),files=saved.packet.files.map((f:any)=>({filename:f.filename,bytes:Buffer.from(f.base64,'base64')}));
  await s.remoteA.start('a',saved.packet.run.prompt.replace('Vibe-Git Codex','Vibe-Git SciencePAL'),files[0],files.slice(1));
  await writeFile(info.outputPath,s.remoteA.calls.at(-1)!.bytes);
  expect((await l.call('/api/local/research/codex-submit',body)).json().status).toBe('COLLECTED');
  expect(s.pipeline.get(s.project.id).runs).toHaveLength(1);
  expect(s.pipeline.get(s.project.id).runs[0]!.localExecution!.id).toBe(before.localExecution!.id);
 });
 it.each(['old revision','missing receipt','wrong receipt','missing result'])('blocks a mistaken %s and allows same-task correction',async mistake=>{
  const s=await setup(false,true),l=await localEntry(s,true);await s.command('align');
  const run=s.pipeline.get(s.project.id).runs[0]!,body={projectId:s.project.id,runId:run.id};
  const info=(await l.call('/api/local/research/codex-take',body)).json();
  const saved=JSON.parse(await readFile(join(info.directory,'task.json'),'utf8')),files=saved.packet.files.map((f:any)=>({filename:f.filename,bytes:Buffer.from(f.base64,'base64')}));
  await s.remoteA.start('a',saved.packet.run.prompt.replace('Vibe-Git Codex','Vibe-Git SciencePAL'),files[0],files.slice(1));
  const good=s.remoteA.calls.at(-1)!.bytes,bad=JSON.parse(Buffer.from(good).toString());
  if(mistake==='old revision')bad.revision=0;
  if(mistake==='missing receipt')bad.inputReceipts=[];
  if(mistake==='wrong receipt')bad.inputReceipts[0].sha256='0'.repeat(64);
  if(mistake==='missing result')delete bad.result;
  const before=structuredClone(s.pipeline.get(s.project.id));await writeFile(info.outputPath,JSON.stringify(bad));
  const response=await l.call('/api/local/research/codex-submit',body);expect(response.statusCode).toBe(400);expect(response.json().error).toMatch(/版本|回执|校验|结果/);
  expect(s.pipeline.get(s.project.id)).toEqual(before);
  await writeFile(info.outputPath,good);expect((await l.call('/api/local/research/codex-submit',body)).json().status).toBe('COLLECTED');
 });
});

it('Human mistakes: preserves uncertain join after a lost acknowledgement without creating another member',async()=>{
 const s=await setup(),l=await localEntry(s);const original=globalThis.fetch;let joins=0;
 const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  const response=await original(input,init);
  if(String(input)===l.host+'/api/v1/join'){joins++;throw Error('simulated lost acknowledgement after server accepted join');}
  return response;
 });
 try{
  const body={invite:l.host+'/join/'+s.invite.inviteToken};
  const first=await l.call('/api/local/research/join',body);expect(first.statusCode).toBe(400);expect(first.json().error).toContain('尚未确认');
  expect((await l.info()).json()).toMatchObject({configured:false,joining:true});
  expect((await l.call('/api/local/research/join',body)).statusCode).toBe(409);expect(joins).toBe(1);
 }finally{spy.mockRestore();}
});

it.each([
 {name:'empty source',patch:{base64:''}},
 {name:'oversized source',patch:{base64:Buffer.alloc(256*1024+1,65).toString('base64')}},
 {name:'non UTF-8 source',patch:{base64:Buffer.from([0xff,0xfe,0xff]).toString('base64')}},
 {name:'missing attribution',patch:{attribution:'  '}},
 {name:'wrong source URL',patch:{sourceUrl:'http://example.org/data'}},
 {name:'unsupported source file',patch:{filename:'source-data.xlsx'}},
])('Human mistakes: rejects $name before creating a project, then accepts repaired input',async ({patch})=>{
 const s=await setup(),before=s.pipeline.list().length;
 const source={filename:'source-data.csv',base64:Buffer.from('x,y\n1,2\n').toString('base64'),sourceUrl:'https://example.org/data',attribution:'Generated test data'};
 const url='/api/sciencepal-team/projects';
 expect((await s.raw(s.captain.nodeToken,url,{...s.input,source:{...source,...patch}})).statusCode).toBe(400);
 expect(s.pipeline.list()).toHaveLength(before);expect(s.remoteA.calls).toHaveLength(0);expect(s.remoteB.calls).toHaveLength(0);
 expect((await s.raw(s.captain.nodeToken,url,{...s.input,source})).statusCode).toBe(200);expect(s.pipeline.list()).toHaveLength(before+1);
});

describe("Waiting-input original thread location",()=>{
 it("publishes the verified location before output and preserves it through a connector restart",async()=>{
  const s=await setup(true);s.remoteA.askKinds.add("ALIGN");await s.command("align");await s.connectorA.step();
  const initial=s.pipeline.get(s.project.id),r=initial.runs[0]!;
  expect(r.status).toBe("NEEDS_INPUT");expect(r.output).toBeNull();expect(r.projectId).toBe(r.threadId);
  const restarted=new SciencePALMemberConnector(s.remoteA,s.a,s.saved(),async()=>{});
  vi.useFakeTimers({toFake:['Date']});
  try {vi.setSystemTime(Date.now()+5000);await restarted.step();}finally{vi.useRealTimers();}
  expect(s.pipeline.get(s.project.id).updatedAt).toBe(initial.updatedAt);
  s.remoteA.webAnswer(r.threadId!);await restarted.step();await restarted.step();
  expect(s.pipeline.get(s.project.id).phase).toBe("READY");expect(s.remoteA.calls).toHaveLength(1);
  expect(s.remoteA.messageCalls).toHaveLength(0);expect(s.remoteA.continuationCalls).toBe(0);
 });
 it("rejects another member, mismatched receipts and replacement locations",async()=>{
  const s=await setup();s.remoteA.askKinds.add("ALIGN");await s.command("align");await s.connectorA.step();
  const r=s.pipeline.get(s.project.id).runs[0]!,path=`/api/sciencepal-team/projects/${s.project.id}/runs/${r.id}/status`;
  const location={threadId:r.threadId,runId:r.runId,projectId:r.projectId};
  expect((await s.raw(s.member.nodeToken,path,{status:"NEEDS_INPUT",location})).statusCode).toBe(403);
  for(const bad of [{...location,threadId:"another-thread"},{...location,runId:"another-run"},{...location,projectId:"another-project"},{...location,projectId:"https://other.invalid"}])
   expect((await s.raw(s.captain.nodeToken,path,{status:"NEEDS_INPUT",location:bad})).statusCode).toBeGreaterThanOrEqual(400);
  expect(s.pipeline.get(s.project.id).runs[0]!.projectId).toBe(r.projectId);
 });
 it("does not replace a bound location on completion and accepts legacy completion without it",async()=>{
  const s=await setup();s.remoteA.askKinds.add("ALIGN");await s.command("align");await s.connectorA.step();
  const r=s.pipeline.get(s.project.id).runs[0]!;
  const body={threadId:r.threadId!,runId:r.runId!,agentId:"a",sandboxId:r.threadId!,base64:Buffer.from(s.remoteA.calls[0]!.bytes).toString("base64")};
  await expect(s.pipeline.memberComplete(s.project.id,s.captain.nodeId,r.id,{...body,projectId:"different-project"})).rejects.toThrow("不匹配");
  expect(s.pipeline.get(s.project.id).runs[0]!.output).toBeNull();
  await s.pipeline.memberComplete(s.project.id,s.captain.nodeId,r.id,body);
  expect(s.pipeline.get(s.project.id).runs[0]!.projectId).toBe(r.projectId);
  expect(s.pipeline.get(s.project.id).phase).toBe("READY");
 });
 it("recovers a failed location read without losing waiting state or launching another job",async()=>{
  const s=await setup();s.remoteA.askKinds.add("ALIGN");const sandbox=s.remoteA.sandbox.bind(s.remoteA);let unavailable=true;
  s.remoteA.sandbox=async id=>{if(unavailable)throw new SciencePALError("temporary read failure",false,true);return sandbox(id);};
  await s.command("align");await expect(s.connectorA.step()).rejects.toThrow("temporary read failure");
  const r=s.pipeline.get(s.project.id).runs[0]!;expect(r.status).toBe("NEEDS_INPUT");expect(r.projectId).toBeNull();
  unavailable=false;const restarted=new SciencePALMemberConnector(s.remoteA,s.a,s.saved(),async()=>{});await restarted.step();
  expect(s.pipeline.get(s.project.id).runs[0]).toMatchObject({id:r.id,threadId:r.threadId,runId:r.runId,projectId:r.threadId,status:"NEEDS_INPUT"});
  expect(s.remoteA.calls).toHaveLength(1);expect(s.remoteA.messageCalls).toHaveLength(0);expect(s.remoteA.continuationCalls).toBe(0);
 });
 it("keeps waiting visible without a location when remote thread verification fails",async()=>{
  const s=await setup();s.remoteA.askKinds.add("ALIGN");s.remoteA.sandbox=async id=>({sandboxId:id,projectId:'wrong-project',agentId:'other-agent'});
  await s.command("align");await expect(s.connectorA.step()).rejects.toThrow("不匹配");
  const r=s.pipeline.get(s.project.id).runs[0]!;
  expect(r.status).toBe("NEEDS_INPUT");expect(r.projectId).toBeNull();expect(s.remoteA.calls).toHaveLength(1);
 });
});
