import { afterEach, describe, expect, it } from "vitest";
import type { CodexConnectStatus, ConflictReviewFinding } from "@vibe-git/protocol";
import { buildApp } from "../src/app.js";
import type { ConflictReviewer, ConflictReviewerResult, ConflictReviewSnapshot } from "../src/integrations/codex/connect-reviewer.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const headers = (member: string) => ({ "content-type": "application/json", "x-member-id": member });
const agentRun = {
  runId: "connect-real-test", promptVersion: "conflict-review.v1" as const,
  inputHash: "snapshot", outputHash: "output", mode: "real" as const,
  capability: "available" as const, createdAt: "2026-09-22T00:00:00.000Z"
};

class FakeReviewer implements ConflictReviewer {
  snapshots: ConflictReviewSnapshot[] = [];
  status(): CodexConnectStatus {
    return { state: "available", provider: "codex-cli", mode: "read-only", detail: "测试只读 Connect", checkedAt: "2026-09-22T00:00:00.000Z" };
  }
  async review(snapshot: ConflictReviewSnapshot): Promise<ConflictReviewerResult> {
    this.snapshots.push(snapshot);
    const findings: ConflictReviewFinding[] = [{
      id: "FINDING-1", classification: "contradiction", severity: "high",
      statement: "候选同时要求立即放行与验证后放行。", evidence: ["立即建立完整会话", "验证后解锁完整权限"],
      affectedRequirementIds: ["REQ-AUTH"],
      resolutionOptions: [{
        id: "OPTION-1-1", title: "分级会话", description: "注册后仅建立受限会话，验证后提升权限。",
        tradeoffs: ["增加会话状态"], requirementChanges: [{ requirementId: "REQ-AUTH", proposedContent: "注册后建立受限会话，验证后解锁完整权限。" }], recommended: true
      }]
    }];
    return { summary: "发现一处权限时序冲突。", findings, agentRun };
  }
  async close(): Promise<void> {}
}

async function create(reviewer = new FakeReviewer()) {
  const app = await buildApp({ seedDemo: true, dbPath: ":memory:", conflictReviewer: reviewer });
  apps.push(app);
  return { app, reviewer };
}

async function waitForReview(app: Awaited<ReturnType<typeof buildApp>>, id: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = (await app.inject({ method: "GET", url: "/api/bootstrap" })).json();
    const review = state.conflictReviews.find((item: { id: string }) => item.id === id);
    if (review?.status === "COMPLETED" || review?.status === "FAILED") return { state, review };
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  }
  throw new Error("Connect review did not finish");
}

afterEach(async () => { while (apps.length) await apps.pop()?.close(); });

describe("Codex Connect 与真实执行命令", () => {
  it("Connect 审核共识候选并保存结构化冲突与解决方案，但不自动解决", async () => {
    const { app, reviewer } = await create();
    const initial = (await app.inject({ method: "GET", url: "/api/bootstrap" })).json();
    const consensus = initial.consensusRevisions[0];
    const response = await app.inject({
      method: "POST", url: `/api/consensus/${consensus.id}/connect-review`, headers: headers("A"),
      payload: { requestId: "connect-consensus-1", source: "manual" }
    });
    expect(response.statusCode).toBe(200);
    const { state, review } = await waitForReview(app, response.json().id);
    expect(review.status).toBe("COMPLETED");
    expect(review.agentRun.promptVersion).toBe("conflict-review.v1");
    expect(review.findings[0].resolutionOptions[0].recommended).toBe(true);
    const created = state.conflicts.find((item: { reviewId?: string }) => item.reviewId === review.id);
    expect(created.status).toBe("OPEN");
    expect(created.resolution).toBeNull();
    expect(created.resolutionOptions[0].title).toBe("分级会话");
    expect(reviewer.snapshots[0]?.targetType).toBe("consensus");
  });

  it("开工只排队，Relay 领取并收到 Codex 回执后才进入运行；Codex 完成不等于验收 DONE", async () => {
    const { app } = await create();
    const review = await app.inject({
      method: "POST", url: "/api/work-units/WU-B-AUTH/plans", headers: headers("B"),
      payload: {
        requestId: "execution-plan", expectedWorkUnitRevision: 1, planHash: "plan-real", result: "PASS", findings: [],
        agentRun: { ...agentRun, runId: "plan-real", promptVersion: "plan-review.v1" }
      }
    });
    const ready = await app.inject({
      method: "POST", url: "/api/work-units/WU-B-AUTH/ready", headers: headers("B"),
      payload: { requestId: "execution-ready", expectedWorkUnitRevision: review.json().workUnit.revision }
    });
    await app.inject({
      method: "POST", url: "/api/relays/heartbeat", headers: headers("B"),
      payload: {
        requestId: "execution-device", device: {
          memberId: "B", deviceId: "device-B", relay: "available", codex: "available", git: "available",
          executionTransports: { appServer: "available", cli: "available", preferred: "app-server" },
          detail: "真实适配器可用", observedAt: "2026-09-22T00:00:00.000Z"
        }
      }
    });
    const start = await app.inject({
      method: "POST", url: "/api/work-units/WU-B-AUTH/start", headers: headers("B"),
      payload: { requestId: "execution-start", expectedWorkUnitRevision: ready.json().revision, deviceId: "device-B", transport: "app-server" }
    });
    expect(start.statusCode).toBe(200);
    let state = (await app.inject({ method: "GET", url: "/api/bootstrap" })).json();
    expect(state.workUnits.find((item: { id: string }) => item.id === "WU-B-AUTH").executionStatus).toBe("STARTING");
    expect(state.executionCommands).toHaveLength(1);
    expect(state.executionCommands[0].status).toBe("QUEUED");

    const claimed = await app.inject({
      method: "POST", url: "/api/relay/commands/next", headers: headers("B"),
      payload: { deviceId: "device-B", waitMs: 0 }
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().kind).toBe("START_WORK_UNIT");
    expect(claimed.json().prompt).toContain("WU-B-AUTH");

    const started = await app.inject({
      method: "POST", url: `/api/relay/commands/${claimed.json().id}/status`, headers: headers("B"),
      payload: { requestId: "command-started", deviceId: "device-B", status: "STARTED", transportUsed: "app-server", runtimeId: "thr_test:turn_test", detail: "turn/start 已确认" }
    });
    expect(started.statusCode).toBe(200);
    state = (await app.inject({ method: "GET", url: "/api/bootstrap" })).json();
    const runningUnit = state.workUnits.find((item: { id: string }) => item.id === "WU-B-AUTH");
    expect(runningUnit.executionStatus).toBe("RUNNING");
    expect(runningUnit.status).toBe("IN_PROGRESS");
    await app.inject({
      method: "POST", url: `/api/relay/commands/${claimed.json().id}/status`, headers: headers("B"),
      payload: { requestId: "command-started-again", deviceId: "device-B", status: "STARTED", transportUsed: "app-server", runtimeId: "thr_test:turn_test", detail: "重复启动回执" }
    });
    state = (await app.inject({ method: "GET", url: "/api/bootstrap" })).json();
    expect(state.workUnits.find((item: { id: string }) => item.id === "WU-B-AUTH").revision).toBe(runningUnit.revision);

    const completed = await app.inject({
      method: "POST", url: `/api/relay/commands/${claimed.json().id}/status`, headers: headers("B"),
      payload: { requestId: "command-completed", deviceId: "device-B", status: "COMPLETED", transportUsed: "app-server", runtimeId: "thr_test:turn_test", detail: "turn/completed", outputSummary: "代码与测试已完成" }
    });
    expect(completed.statusCode).toBe(200);
    state = (await app.inject({ method: "GET", url: "/api/bootstrap" })).json();
    const unit = state.workUnits.find((item: { id: string }) => item.id === "WU-B-AUTH");
    expect(unit.executionStatus).toBe("FINISHED");
    expect(unit.status).toBe("IN_PROGRESS");
    expect(unit.status).not.toBe("DONE");
    expect(state.leases[0].status).toBe("COMPLETED");
  });
});
