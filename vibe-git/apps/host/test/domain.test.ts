import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
async function create() { const app = await buildApp({ seedDemo: true, dbPath: ":memory:" }); apps.push(app); return app; }
const headers = (member: string) => ({ "content-type": "application/json", "x-member-id": member });
afterEach(async () => { while (apps.length) await apps.pop()?.close(); });

describe("Vibe-Git 业务约束", () => {
  it("拒绝过期任务版本，且相同请求 ID 幂等", async () => {
    const app = await create();
    const body = { requestId: "same-status", expectedTaskRevision: 1, status: "BLOCKED", note: "等待接口", source: "manual" };
    const first = await app.inject({ method: "POST", url: "/api/tasks/TASK-B/status", headers: headers("B"), payload: body });
    expect(first.statusCode).toBe(200);
    const repeated = await app.inject({ method: "POST", url: "/api/tasks/TASK-B/status", headers: headers("B"), payload: body });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().revision).toBe(first.json().revision);
    const stale = await app.inject({ method: "POST", url: "/api/tasks/TASK-B/status", headers: headers("B"), payload: { ...body, requestId: "stale", status: "PLANNING" } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("REVISION_CONFLICT");
  });

  it("拒绝非责任人修改任务", async () => {
    const app = await create();
    const response = await app.inject({ method: "POST", url: "/api/tasks/TASK-B/status", headers: headers("C"), payload: { requestId: "forbidden", expectedTaskRevision: 1, status: "BLOCKED", note: "越权", source: "manual" } });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("FORBIDDEN");
  });

  it("旧的任意需求变更入口已关闭，普通创意必须走 PM 审查治理接口", async () => {
    const app = await create();
    const response = await app.inject({ method: "POST", url: "/api/requirements/change-requests", headers: headers("B"), payload: {
      requestId: "legacy-change", requirementId: "REQ-AUTH", expectedRequirementRevision: 1,
      proposedContent: "绕过 PM 审查", reason: "旧入口", affectedTaskIds: ["TASK-B"], impact: "high", source: "manual"
    }});
    expect(response.statusCode).toBe(404);
  });

  it("Codex 未验证时不签发开工租约", async () => {
    const app = await create();
    await app.inject({ method: "POST", url: "/api/relays/heartbeat", headers: headers("B"), payload: { requestId: "hb-1", device: { memberId: "B", deviceId: "device-b", relay: "available", codex: "unverified", git: "available", detail: "仅发现 CLI", observedAt: new Date().toISOString() } } });
    const ready = await app.inject({ method: "POST", url: "/api/tasks/TASK-B/ready", headers: headers("B"), payload: { requestId: "ready-1", expectedTaskRevision: 1, acknowledgeRequirementRevision: 1, source: "manual" } });
    expect(ready.statusCode).toBe(200);
    const start = await app.inject({ method: "POST", url: "/api/tasks/TASK-B/start", headers: headers("B"), payload: { requestId: "start-1", expectedTaskRevision: 2, deviceId: "device-b", source: "manual" } });
    expect(start.statusCode).toBe(409);
    expect(start.json().code).toBe("CAPABILITY_UNAVAILABLE");
  });

  it("同一幂等键只签发一个开工租约", async () => {
    const app = await create();
    await app.inject({ method: "POST", url: "/api/relays/heartbeat", headers: headers("C"), payload: { requestId: "hb-c", device: { memberId: "C", deviceId: "device-c", relay: "available", codex: "available", git: "available", detail: "测试适配器已完成握手", observedAt: new Date().toISOString() } } });
    const ready = await app.inject({ method: "POST", url: "/api/tasks/TASK-C/ready", headers: headers("C"), payload: { requestId: "ready-c", expectedTaskRevision: 1, acknowledgeRequirementRevision: 1, source: "manual" } });
    expect(ready.statusCode).toBe(200);
    const payload = { requestId: "start-c", expectedTaskRevision: 2, deviceId: "device-c", source: "manual" };
    const first = await app.inject({ method: "POST", url: "/api/tasks/TASK-C/start", headers: headers("C"), payload });
    const repeated = await app.inject({ method: "POST", url: "/api/tasks/TASK-C/start", headers: headers("C"), payload });
    expect(first.statusCode).toBe(200);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().id).toBe(first.json().id);
    const state = await app.inject({ method: "GET", url: "/api/bootstrap" });
    expect(state.json().leases).toHaveLength(1);
  });
});
