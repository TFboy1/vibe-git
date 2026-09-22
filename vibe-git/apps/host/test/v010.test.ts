import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const headers = (member: string) => ({ "content-type": "application/json", "x-member-id": member });
const agentRun = (runId: string, promptVersion: "pm-review.v1" | "coordinator-degrade.v1" | "plan-review.v1", inputHash = "input") => ({
  runId, promptVersion, inputHash, outputHash: `${runId}-output`, mode: "real", capability: "available", createdAt: new Date().toISOString()
});
async function create() { const app = await buildApp({ seedDemo: true, dbPath: ":memory:" }); apps.push(app); return app; }
afterEach(async () => { while (apps.length) await apps.pop()?.close(); });

describe("v0.10 共识与治理", () => {
  it("未全员确认不能发布，候选修订会清空旧确认，三人确认同一摘要后只失效相关 WorkUnit", async () => {
    const app = await create();
    let state = (await app.inject({ method: "GET", url: "/api/bootstrap" })).json();
    const consensus = state.consensusRevisions[0];

    const firstVote = await app.inject({ method: "POST", url: `/api/consensus/${consensus.id}/confirmations`, headers: headers("A"), payload: {
      requestId: "cons-vote-a-old", expectedConsensusRevision: consensus.revision, candidateHash: consensus.candidateHash, decision: "CONFIRMED"
    }});
    expect(firstVote.statusCode).toBe(200);
    const publishTooEarly = await app.inject({ method: "POST", url: `/api/consensus/${consensus.id}/publish`, headers: headers("A"), payload: {
      requestId: "publish-early", expectedConsensusRevision: firstVote.json().revision, expectedRequirementRevision: 1
    }});
    expect(publishTooEarly.statusCode).toBe(409);

    const revised = await app.inject({ method: "POST", url: `/api/consensus/${consensus.id}/revisions`, headers: headers("A"), payload: {
      requestId: "revise-consensus", expectedConsensusRevision: firstVote.json().revision, policyId: "POLICY-P0", requirementId: "REQ-SYNC",
      action: "REDUCE_DEPTH", after: "共享任务状态并按 room_seq 断线恢复；长期离线编辑延期。", acceptance: ["写入后广播 room_seq", "重连可补收事件"],
      rationale: "在 48 小时内保留最低协作闭环", sacrifices: ["长期离线编辑"], risks: ["隧道稳定性待真机验证"], agentRun: agentRun("coord-1", "coordinator-degrade.v1")
    }});
    expect(revised.statusCode).toBe(200);
    expect(revised.json().confirmations).toHaveLength(0);
    expect(revised.json().candidateHash).not.toBe(consensus.candidateHash);

    let revision = revised.json().revision as number;
    const candidateHash = revised.json().candidateHash as string;
    for (const member of ["A", "B", "C"]) {
      const vote = await app.inject({ method: "POST", url: `/api/consensus/${consensus.id}/confirmations`, headers: headers(member), payload: {
        requestId: `cons-vote-${member}`, expectedConsensusRevision: revision, candidateHash, decision: "CONFIRMED"
      }});
      expect(vote.statusCode).toBe(200);
      revision = vote.json().revision;
    }
    const published = await app.inject({ method: "POST", url: `/api/consensus/${consensus.id}/publish`, headers: headers("A"), payload: {
      requestId: "publish-final", expectedConsensusRevision: revision, expectedRequirementRevision: 1
    }});
    expect(published.statusCode).toBe(200);
    expect(published.json().requirementRevision).toBe(2);
    expect(published.json().invalidatedWorkUnitIds).toEqual(["WU-A-HOST", "WU-C-AUTH"]);
    state = (await app.inject({ method: "GET", url: "/api/bootstrap" })).json();
    expect(state.workUnits.find((unit: { id: string }) => unit.id === "WU-B-AUTH").impactState).toBe("VALID");
    expect(state.workUnits.find((unit: { id: string }) => unit.id === "WU-C-AUTH").impactState).toBe("INVALIDATED");
  });

  it("拒绝 Coordinator 超出 DelegationPolicy 的需求范围或动作", async () => {
    const app = await create();
    const response = await app.inject({ method: "POST", url: "/api/consensus/CONS-001/revisions", headers: headers("A"), payload: {
      requestId: "out-of-authority", expectedConsensusRevision: 1, policyId: "POLICY-P0", requirementId: "REQ-AUTH",
      action: "REDUCE_DEPTH", after: "删除邮箱验证", acceptance: ["自动登录"], rationale: "省时间", sacrifices: [], risks: [], agentRun: agentRun("coord-2", "coordinator-degrade.v1")
    }});
    expect(response.statusCode).toBe(403);
  });

  it("普通创意必须绑定同内容摘要的 PM PASS 与本人授权，Issue 可直接报告且不改变需求", async () => {
    const app = await create();
    const ideaContent = "注册后立即建立受限会话，完成邮箱验证后解锁完整权限。";
    const review = await app.inject({ method: "POST", url: "/api/idea-reviews", headers: headers("B"), payload: {
      requestId: "idea-review-pass", ideaContent, verdict: "PASS_FOR_SUBMISSION", rationale: "范围和验收明确", blockingIssues: [],
      submissionSummary: ideaContent, affectedRequirementIds: ["REQ-AUTH"], affectedModuleIds: ["MOD-AUTH"], suggestedImpact: "L2",
      agentRun: agentRun("pm-1", "pm-review.v1"), memberAuthorized: true
    }});
    expect(review.statusCode).toBe(200);
    const changedText = await app.inject({ method: "POST", url: "/api/governed-change-requests", headers: headers("B"), payload: {
      requestId: "changed-after-review", ideaReviewId: review.json().id, requirementId: "REQ-AUTH", expectedRequirementRevision: 1,
      proposedContent: `${ideaContent} 再自动创建管理员账号。`, reason: "扩大范围", impactLevel: "L2"
    }});
    expect(changedText.statusCode).toBe(409);
    const accepted = await app.inject({ method: "POST", url: "/api/governed-change-requests", headers: headers("B"), payload: {
      requestId: "same-after-review", ideaReviewId: review.json().id, requirementId: "REQ-AUTH", expectedRequirementRevision: 1,
      proposedContent: ideaContent, reason: "统一会话边界", impactLevel: "L2"
    }});
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe("OPEN");

    const before = (await app.inject({ method: "GET", url: "/api/bootstrap" })).json().room.requirementRevision;
    const issue = await app.inject({ method: "POST", url: "/api/issues", headers: headers("C"), payload: {
      requestId: "issue-direct", type: "DEFECT", title: "登录按钮无响应", description: "可重复复现", evidence: ["点击后无请求"], requirementIds: ["REQ-AUTH"], workUnitIds: ["WU-C-AUTH"]
    }});
    expect(issue.statusCode).toBe(200);
    const after = (await app.inject({ method: "GET", url: "/api/bootstrap" })).json().room.requirementRevision;
    expect(after).toBe(before);
  });

  it("冻结范围内的非 L0 创意被标记 FROZEN，不会进入普通批准流", async () => {
    const app = await create();
    const ideaContent = "把核心目标改为自动合并代码。";
    const review = await app.inject({ method: "POST", url: "/api/idea-reviews", headers: headers("A"), payload: {
      requestId: "frozen-review", ideaContent, verdict: "PASS_FOR_SUBMISSION", rationale: "仅用于验证冻结规则", blockingIssues: [], submissionSummary: ideaContent,
      affectedRequirementIds: ["REQ-ROOT"], affectedModuleIds: ["MOD-COLLAB"], suggestedImpact: "L3", agentRun: agentRun("pm-frozen", "pm-review.v1"), memberAuthorized: true
    }});
    const change = await app.inject({ method: "POST", url: "/api/governed-change-requests", headers: headers("A"), payload: {
      requestId: "frozen-change", ideaReviewId: review.json().id, requirementId: "REQ-ROOT", expectedRequirementRevision: 1,
      proposedContent: ideaContent, reason: "验证冻结", impactLevel: "L3"
    }});
    expect(change.statusCode).toBe(200);
    expect(change.json().status).toBe("FROZEN");
    expect(change.json().freezeState).toBe("FROZEN");
  });
});

describe("v0.10 模块、执行与证据", () => {
  it("同一模块允许多人拥有独立 WorkUnit，重复认领不重复创建", async () => {
    const app = await create();
    const initial = (await app.inject({ method: "GET", url: "/api/bootstrap" })).json();
    const module = initial.modules.find((item: { id: string }) => item.id === "MOD-AUTH");
    expect(initial.workUnits.filter((unit: { moduleId: string }) => unit.moduleId === "MOD-AUTH")).toHaveLength(2);
    const repeated = await app.inject({ method: "POST", url: "/api/modules/MOD-AUTH/claims", headers: headers("B"), payload: {
      requestId: "claim-existing", expectedModuleRevision: module.revision, title: "重复认领", deliverySlice: "重复", boundary: "重复", acceptanceIds: ["AC-AUTH-SESSION"], resources: [], dependencies: []
    }});
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().id).toBe("WU-B-AUTH");
    const after = (await app.inject({ method: "GET", url: "/api/work-units" })).json();
    expect(after.filter((unit: { moduleId: string; ownerId: string }) => unit.moduleId === "MOD-AUTH" && unit.ownerId === "B")).toHaveLength(1);
  });

  it("PlanReview 只允许当前契约 PASS 后 Ready；DONE 不能由普通状态接口直接设置", async () => {
    const app = await create();
    const review = await app.inject({ method: "POST", url: "/api/work-units/WU-B-AUTH/plans", headers: headers("B"), payload: {
      requestId: "plan-pass", expectedWorkUnitRevision: 1, planHash: "plan-b-v1", result: "PASS", findings: [], agentRun: agentRun("plan-b", "plan-review.v1")
    }});
    expect(review.statusCode).toBe(200);
    const ready = await app.inject({ method: "POST", url: "/api/work-units/WU-B-AUTH/ready", headers: headers("B"), payload: {
      requestId: "wu-ready", expectedWorkUnitRevision: review.json().workUnit.revision
    }});
    expect(ready.statusCode).toBe(200);
    expect(ready.json().status).toBe("READY");
    const directDone = await app.inject({ method: "POST", url: "/api/work-units/WU-B-AUTH/status", headers: headers("B"), payload: {
      requestId: "direct-done", expectedWorkUnitRevision: ready.json().revision, status: "DONE", note: "声称完成"
    }});
    expect(directDone.statusCode).toBe(409);
  });

  it("队长暂停只产生 INTERRUPT_REQUESTED，成员 Relay 回执后才变为 INTERRUPTED", async () => {
    const app = await create();
    const pause = await app.inject({ method: "POST", url: "/api/work-units/WU-A-HOST/pause", headers: headers("A"), payload: {
      requestId: "pause-a", action: "PAUSE", reason: "需求待重审", expectedWorkUnitRevision: 1
    }});
    expect(pause.statusCode).toBe(200);
    expect(pause.json().workUnit.executionStatus).toBe("INTERRUPT_REQUESTED");
    expect(pause.json().decision.status).toBe("REQUESTED");
    const ack = await app.inject({ method: "POST", url: `/api/execution-decisions/${pause.json().decision.id}/acknowledge`, headers: headers("A"), payload: {
      requestId: "pause-ack", result: "INTERRUPTED", detail: "本机受管理轮次已中断"
    }});
    expect(ack.statusCode).toBe(200);
    expect(ack.json().workUnit.executionStatus).toBe("INTERRUPTED");
  });

  it("证据必须覆盖验收项、绑定真实 Git SHA；一人完成不自动完成多人模块", async () => {
    const app = await create();
    const head = "0123456789abcdef0123456789abcdef01234567";
    await app.inject({ method: "POST", url: "/api/relays/heartbeat", headers: headers("B"), payload: {
      requestId: "git-b", device: { memberId: "B", deviceId: "device-b", relay: "available", codex: "unverified", git: "available", detail: "git ok", observedAt: new Date().toISOString() },
      gitReference: { taskId: "TASK-B", workUnitId: "WU-B-AUTH", memberId: "B", branch: "member-b/auth", baseSha: head, headSha: head, dirty: false, observedAt: new Date().toISOString() }
    }});
    const missing = await app.inject({ method: "POST", url: "/api/work-units/WU-B-AUTH/evidence", headers: headers("B"), payload: {
      requestId: "evidence-missing", expectedWorkUnitRevision: 1, contractRevision: 1, requirementRevision: 1, codeSha: head, environment: "test",
      items: [{ acceptanceId: "AC-AUTH-SESSION", verificationType: "TEST", commandOrSteps: "npm test", expectedResult: "pass", actualResult: "pass", passed: true, artifactRef: null }]
    }});
    expect(missing.statusCode).toBe(409);
    const complete = await app.inject({ method: "POST", url: "/api/work-units/WU-B-AUTH/evidence", headers: headers("B"), payload: {
      requestId: "evidence-complete", expectedWorkUnitRevision: 1, contractRevision: 1, requirementRevision: 1, codeSha: head, environment: "test",
      items: [
        { acceptanceId: "AC-AUTH-SESSION", verificationType: "TEST", commandOrSteps: "npm test", expectedResult: "pass", actualResult: "pass", passed: true, artifactRef: null },
        { acceptanceId: "AC-GIT-EVIDENCE", verificationType: "COMMAND", commandOrSteps: "git rev-parse HEAD", expectedResult: head, actualResult: head, passed: true, artifactRef: null }
      ]
    }});
    expect(complete.statusCode).toBe(200);
    const reviewed = await app.inject({ method: "POST", url: `/api/evidence/${complete.json().evidence.id}/reviews`, headers: headers("C"), payload: {
      requestId: "review-evidence", expectedEvidenceRevision: 1, decision: "ACCEPT", reason: "验收项和 SHA 一致"
    }});
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().workUnit.status).toBe("DONE");
    const module = (await app.inject({ method: "GET", url: "/api/modules" })).json().find((item: { id: string }) => item.id === "MOD-AUTH");
    expect(module.status).not.toBe("DONE");
  });
});
