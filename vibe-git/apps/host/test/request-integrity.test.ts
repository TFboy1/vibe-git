import { afterEach, describe, expect, it } from "vitest";
import type { BootstrapPayload, GitReference, MemberId, WorkUnit } from "@vibe-git/protocol";
import { buildApp } from "../src/app.js";
import { requestHash } from "../src/domain/base-service.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
type App = typeof apps[number];
const headers = (member: MemberId) => ({ "content-type": "application/json", "x-member-id": member });
async function create() { const app = await buildApp({ seedDemo: true, dbPath: ":memory:" }); apps.push(app); return app; }
async function state(app: App) { return (await app.inject({ method: "GET", url: "/api/bootstrap" })).json<BootstrapPayload>(); }
function post(app: App, member: MemberId, url: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url, headers: headers(member), payload });
}
function heartbeat(app: App, member: MemberId, requestId: string, gitReference?: GitReference) {
  return post(app, member, "/api/relays/heartbeat", {
    requestId, device: { memberId: member, deviceId: "device-" + member, relay: "available", codex: "unverified", git: "available", detail: "test fixture, not live verification", observedAt: "2026-09-22T00:00:00.000Z" },
    ...(gitReference ? { gitReference } : {})
  });
}
function reference(memberId: MemberId, taskId: string, headSha: string, workUnitId?: string): GitReference {
  return { memberId, taskId, ...(workUnitId === undefined ? {} : { workUnitId }), branch: "member/" + memberId, baseSha: headSha, headSha, dirty: false, observedAt: "2026-09-22T00:00:00.000Z" };
}
afterEach(async () => { while (apps.length) await apps.pop()?.close(); });

describe("请求身份与幂等一致性", () => {
  it("规范化嵌套对象的字段顺序，但不忽略数组顺序和内容", () => {
    expect(requestHash({ b: [{ z: 1, a: 2 }], a: 3 })).toBe(requestHash({ a: 3, b: [{ a: 2, z: 1 }] }));
    expect(requestHash({ list: [1, 2] })).not.toBe(requestHash({ list: [2, 1] }));
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: "1" }));
  });

  it.each([
    ["旧 Task", "/api/tasks/TASK-B/status", "expectedTaskRevision"],
    ["WorkUnit", "/api/work-units/WU-B-AUTH/status", "expectedWorkUnitRevision"]
  ])("%s 重试同稿只写一次，异稿和跨成员复用被拒绝", async (_label, url, revisionKey) => {
    const app = await create();
    const payload = { requestId: "status-retry", [revisionKey]: 1, status: "BLOCKED", note: "等待依赖", source: "manual" };
    const first = await post(app, "B", url, payload);
    expect(first.statusCode).toBe(200);
    const after = await state(app);
    const reordered = Object.fromEntries(Object.entries(payload).reverse());
    const repeat = await post(app, "B", url, reordered);
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json()).toEqual(first.json());
    for (const [member, body] of [["B", { ...payload, note: "不同内容" }], ["C", payload]] as const) {
      const conflict = await post(app, member, url, body);
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().code).toBe("IDEMPOTENCY_CONFLICT");
    }
    expect(await state(app)).toEqual(after);
    const unauthorized = await post(app, "C", url, { ...payload, requestId: "unauthorized" });
    expect(unauthorized.statusCode).toBe(403);
  });

  it("同一 requestId 不能跨业务操作复用", async () => {
    const app = await create();
    const payload = { requestId: "cross-operation", expectedTaskRevision: 1, status: "BLOCKED", note: "等待" };
    expect((await post(app, "B", "/api/tasks/TASK-B/status", payload)).statusCode).toBe(200);
    const conflict = await post(app, "B", "/api/work-units/WU-B-AUTH/status", { ...payload, expectedWorkUnitRevision: 1 });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("启动租约同稿重试只签发一次，更换设备或成员不返回旧租约", async () => {
    const app = await create();
    // This is synthetic protocol data for a state-machine test, not a real Agent run.
    const review = await post(app, "B", "/api/work-units/WU-B-AUTH/plans", {
      requestId: "plan", expectedWorkUnitRevision: 1, planHash: "test-plan", result: "PASS", findings: [],
      agentRun: { runId: "synthetic-test", promptVersion: "plan-review.v1", inputHash: "input", outputHash: "output", mode: "real", capability: "available", createdAt: "2026-09-22T00:00:00.000Z" }
    });
    expect(review.statusCode).toBe(200);
    const ready = await post(app, "B", "/api/work-units/WU-B-AUTH/ready", { requestId: "ready", expectedWorkUnitRevision: review.json().workUnit.revision });
    expect(ready.statusCode).toBe(200);
    expect((await post(app, "B", "/api/relays/heartbeat", { requestId: "device", device: { memberId: "B", deviceId: "device-B", relay: "available", codex: "available", git: "available", detail: "synthetic test", observedAt: "2026-09-22T00:00:00.000Z" } })).statusCode).toBe(200);
    const payload = { requestId: "start", expectedWorkUnitRevision: ready.json().revision, deviceId: "device-B" };
    const url = "/api/work-units/WU-B-AUTH/start";
    const first = await post(app, "B", url, payload);
    expect(first.statusCode).toBe(200);
    expect((await post(app, "B", url, payload)).json()).toEqual(first.json());
    for (const [member, body] of [["B", { ...payload, deviceId: "other" }], ["C", payload]] as const) {
      const conflict = await post(app, member, url, body);
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().code).toBe("IDEMPOTENCY_CONFLICT");
    }
    expect((await state(app)).leases).toHaveLength(1);
  });
});

describe("WorkUnit Ready 门槛", () => {
  it("普通状态更新不能跳过 PlanReview 直接 Ready", async () => {
    const app = await create();
    const before = await state(app);
    const result = await post(app, "B", "/api/work-units/WU-B-AUTH/status", {
      requestId: "bypass-ready", expectedWorkUnitRevision: 1, status: "READY", note: "尝试绕过"
    });
    expect(result.statusCode).toBe(409);
    expect(result.json().code).toBe("INVALID_STATE");
    expect(await state(app)).toEqual(before);
  });
});

describe("WorkUnit Git 隔离与证据绑定", () => {
  it("同一 TaskPackage 下不同成员的 WorkUnit Git 记录不会互相覆盖", async () => {
    const app = await create();
    const module = (await state(app)).modules.find(item => item.id === "MOD-AUTH")!;
    const claim = await post(app, "A", "/api/modules/MOD-AUTH/claims", {
      requestId: "claim-a", expectedModuleRevision: module.revision, title: "集成切片", deliverySlice: "完成集成脚本", boundary: "仅集成", acceptanceIds: ["AC-GIT-EVIDENCE"], resources: [], dependencies: []
    });
    expect(claim.statusCode).toBe(200);
    const unit = claim.json<WorkUnit>();
    expect(unit.taskId).toBe("TASK-B");
    expect((await heartbeat(app, "B", "git-b", reference("B", "TASK-B", "b".repeat(40), "WU-B-AUTH"))).statusCode).toBe(200);
    expect((await heartbeat(app, "A", "git-a", reference("A", "TASK-B", "a".repeat(40), unit.id))).statusCode).toBe(200);
    expect((await heartbeat(app, "A", "git-a-next", reference("A", "TASK-B", "c".repeat(40), unit.id))).statusCode).toBe(200);
    const refs = (await state(app)).gitReferences.filter(item => item.taskId === "TASK-B" && item.workUnitId);
    expect(refs).toHaveLength(2);
    expect(refs.find(item => item.workUnitId === "WU-B-AUTH")?.headSha).toBe("b".repeat(40));
    expect(refs.find(item => item.workUnitId === unit.id)?.headSha).toBe("c".repeat(40));
  });

  it.each([
    ["他人单元", "TASK-C", "WU-C-AUTH", 403],
    ["错误任务", "TASK-C", "WU-B-AUTH", 400],
    ["不存在单元", "TASK-B", "WU-MISSING", 404],
    ["空单元 ID", "TASK-B", "", 404],
    ["他人旧任务", "TASK-C", undefined, 403],
    ["不存在旧任务", "TASK-MISSING", undefined, 404]
  ] as const)("拒绝%s并回滚整个心跳写入", async (_label, taskId, workUnitId, expectedStatus) => {
    const app = await create();
    const before = await state(app);
    const result = await heartbeat(app, "B", "invalid-reference", reference("B", taskId, "b".repeat(40), workUnitId));
    expect(result.statusCode).toBe(expectedStatus);
    expect(await state(app)).toEqual(before);
  });

  it("旧 Task Git 不能替代 WorkUnit 证据，精确 WorkUnit SHA 才能提交", async () => {
    const app = await create();
    const oldSha = "a".repeat(40), unitSha = "b".repeat(40);
    expect((await heartbeat(app, "B", "legacy-git", reference("B", "TASK-B", oldSha))).statusCode).toBe(200);
    const body = {
      requestId: "evidence", expectedWorkUnitRevision: 1, contractRevision: 1, requirementRevision: 1, codeSha: oldSha, environment: "synthetic test",
      items: ["AC-AUTH-SESSION", "AC-GIT-EVIDENCE"].map(acceptanceId => ({ acceptanceId, verificationType: "TEST", commandOrSteps: "test", expectedResult: "pass", actualResult: "pass", passed: true, artifactRef: null }))
    };
    const url = "/api/work-units/WU-B-AUTH/evidence";
    expect((await post(app, "B", url, body)).statusCode).toBe(409);
    expect((await heartbeat(app, "B", "unit-git", reference("B", "TASK-B", unitSha, "WU-B-AUTH"))).statusCode).toBe(200);
    expect((await post(app, "B", url, body)).statusCode).toBe(409);
    // Failed transactions must not reserve requestId or increment the WorkUnit revision.
    const accepted = await post(app, "B", url, { ...body, codeSha: unitSha });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().evidence.codeSha).toBe(unitSha);
    expect((await state(app)).evidenceBundles).toHaveLength(1);
  });
});
