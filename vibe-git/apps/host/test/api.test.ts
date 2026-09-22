import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => { while (apps.length) await apps.pop()?.close(); });

describe("Host API", () => {
  it("返回完整 bootstrap 与健康状态", async () => {
    const app = await buildApp({ seedDemo: true, dbPath: ":memory:" }); apps.push(app);
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(true);
    const response = await app.inject({ method: "GET", url: "/api/bootstrap", headers: { "x-member-id": "A" } });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.members).toHaveLength(3);
    expect(data.requirements.length).toBeGreaterThanOrEqual(4);
    expect(data.conflicts[0].classification).toBe("contradiction");
  });
});
