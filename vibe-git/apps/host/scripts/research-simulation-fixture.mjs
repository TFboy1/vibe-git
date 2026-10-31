/** Deterministic synthetic fixture only. Never calls SciencePAL or a Codex model. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=b=>JSON.parse(Buffer.from(b).toString());
/** A preview Host is in memory: workers share its session, but new projects get distinct IDs. */
export function simulationSession(sessions,key,projectId,prefix,calculate) {
  let session=sessions.get(key);
  if(session&&session.journal.projectId!==projectId)throw Error('模拟连接器日志属于其他项目');
  if(!session){session={remote:new ResearchRemote(`${prefix}-${randomUUID()}`,calculate),journal:{projectId,phase:'IDLE'}};sessions.set(key,session);}
  return session;
}
export function simulatedEnvelope(kind, files) {
  const context = json(files[0].bytes);
    let result;
    if (kind === 'ALIGN') result = { alignmentMarkdown: `# Synthetic numerical protocol R${context.revision}`, issues: [], tasks: [
      { key: 'data', title: '整理测量数据与单位', goal: '保留原始数值和测量单位', boundary: '仅使用合成数据，不外推真实科研结论', acceptance: ['Values are [1,2,3] and unit is a.u.'], dependencies: [], assigneeAgentId: context.agents[0].id },
      { key: 'analysis', title: '独立重算研究统计量', goal: 'R1 计算均值；R2 计算样本方差', boundary: '只使用上游获批文件的实际字节', acceptance: ['Statistic matches independently recomputed upstream values'], dependencies: ['data'], assigneeAgentId: context.agents[1].id },
    ] };
    if (kind === 'TASK' && context.task.key === 'data') result = { synthetic: true, values: [1, 2, 3], unit: context.feedback || context.revision > 1 ? 'a.u.' : null };
    if (kind === 'TASK' && context.task.key === 'analysis') {
      const source = json(files.find(f => f.filename === 'data.json').bytes).result;
      const mean = source.values.reduce((a, b) => a + b, 0) / source.values.length;
      result = { synthetic: true, statistic: context.revision === 1 ? 'mean' : 'sample_variance', value: context.revision === 1 ? mean : source.values.reduce((s, x) => s + (x - mean) ** 2, 0) / (source.values.length - 1), unit: source.unit };
    }
    if (kind === 'REVIEW') {
      const target = json(files.find(f => f.filename === context.task.outputFilename).bytes).result;
      const passed = context.task.key === 'data' ? JSON.stringify(target.values) === '[1,2,3]' && target.unit === 'a.u.' : target.value === (context.revision === 1 ? 2 : 1);
      result = { verdict: passed ? 'approve' : 'request_changes', summary: passed ? '合成数据的数值与单位校验通过' : 'data.json 实际文件中缺少测量单位', checks: context.task.acceptance.map(criterion => ({ criterion, passed, evidence: `${context.task.outputFilename}: ${JSON.stringify(target)}` })), requiredChanges: passed ? [] : ['在成果文件中明确声明合成数据的测量单位为 a.u.'] };
    }
    if (kind === 'CHANGE_REVIEW') result = { verdict: 'accept', rationale: 'Recompute sample variance from approved synthetic input', affectedTaskKeys: ['analysis'], requirementMarkdown: '# R2\nUse sample variance (n-1), not the mean.' };
    return Buffer.from(JSON.stringify({ revision: context.revision, inputReceipts: files.map(f => ({ filename: f.filename, sha256: hash(f.bytes), size: f.bytes.length })), result }));
}
export class ResearchRemote {
  configured = true; calls = []; history = []; states = new Map(); messages = new Map();
  askReviewOnce = false;
  constructor(prefix,calculate=simulatedEnvelope) { this.prefix = prefix; this.calculate=calculate; }
  async agents() { return [{ id: 'simulated-research-expert', name: 'SIMULATED expert' }]; }
  async start(agentId, prompt, first, extra = []) {
    assert.equal(agentId, 'simulated-research-expert');
    const files = [first, ...extra], context = json(first.bytes), kind = prompt.match(/SciencePAL (\w+) job/)[1];
    const id = `${this.prefix}-${this.calls.length}`;
    const bytes = this.calculate(kind, files);
    this.calls.push({ id, kind, files, bytes });
    this.history.push({ id, threadId: id, agentId, startedAt: new Date().toISOString() });
    this.states.set(id, (kind === 'ALIGN' && context.revision === 1) || (kind === 'REVIEW' && this.askReviewOnce) ? 'asked' : 'completed');
    if (kind === 'REVIEW') this.askReviewOnce = false;
    return { threadId: id, runId: id };
  }
  async run(id) { return this.states.get(id); }
  async threadRuns(id) { return this.history.filter(r => r.threadId === id); }
  async addMessage(thread, id, content) { if (this.messages.has(id)) assert.equal(this.messages.get(id), content); this.messages.set(id, content); }
  async continueRun(threadId) {
    const parent = this.history.find(r => r.threadId === threadId), id = `${threadId}-reply`;
    this.history.push({ ...parent, id, startedAt: new Date().toISOString() }); this.states.set(id, 'completed'); return { runId: id };
  }
  async sandbox(threadId) { return { sandboxId: threadId, agentId: 'simulated-research-expert', projectId: 'simulated' }; }
  async download(id) { return this.calls.find(c => c.id === id).bytes; }
}
