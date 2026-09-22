import { afterEach, describe, expect, it } from "vitest";
import type { CloudflareTunnelStatus } from "@vibe-git/protocol";
import type { CloudflareManager } from "../src/integrations/cloudflare/manager.js";
import { buildApp } from "../src/app.js";

class FakeManager implements CloudflareManager {
  installs = 0;
  starts = 0;
  stops = 0;
  closed = 0;
  private value: CloudflareTunnelStatus = {
    phase: "not_installed", installed: false, running: false, version: null, url: null,
    logs: [], lastError: null, updatedAt: new Date().toISOString()
  };
  async status() { return structuredClone(this.value); }
  async install() {
    this.installs += 1;
    this.value = { ...this.value, phase: "ready", installed: true, version: "cloudflared version test", logs: ["verified"] };
    return this.status();
  }
  async start() {
    if (!this.value.running) this.starts += 1;
    this.value = { ...this.value, phase: "running", installed: true, running: true, version: "cloudflared version test", url: "https://vibe-test.trycloudflare.com" };
    return this.status();
  }
  async stop() {
    if (this.value.running) this.stops += 1;
    this.value = { ...this.value, phase: this.value.installed ? "ready" : "not_installed", running: false, url: null };
    return this.status();
  }
  async close() { this.closed += 1; await this.stop(); }
}

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const localHeaders = (member = "A") => ({
  host: "localhost:8787", origin: "http://localhost:4173", "x-member-id": member, "content-type": "application/json"
});
afterEach(async () => { while (apps.length) await apps.pop()?.close(); });

describe("Cloudflare localhost control", () => {
  it("allows the local captain to install, start once, read the real URL, and stop", async () => {
    const manager = new FakeManager();
    const app = await buildApp({ seedDemo: true, dbPath: ":memory:", cloudflareManager: manager }); apps.push(app);
    const before = await app.inject({ method: "GET", url: "/api/local-control/cloudflare", headers: localHeaders() });
    expect(before.statusCode).toBe(200);
    expect(before.json().installed).toBe(false);
    const install = await app.inject({ method: "POST", url: "/api/local-control/cloudflare/install", headers: localHeaders(), payload: {} });
    expect(install.statusCode).toBe(200);
    expect(install.json().version).toContain("cloudflared version");
    const first = await app.inject({ method: "POST", url: "/api/local-control/cloudflare/start", headers: localHeaders(), payload: {} });
    const second = await app.inject({ method: "POST", url: "/api/local-control/cloudflare/start", headers: localHeaders(), payload: {} });
    expect(first.json().url).toBe("https://vibe-test.trycloudflare.com");
    expect(second.json().url).toBe(first.json().url);
    expect(manager.starts).toBe(1);
    const stop = await app.inject({ method: "POST", url: "/api/local-control/cloudflare/stop", headers: localHeaders(), payload: {} });
    expect(stop.json().running).toBe(false);
    expect(manager.stops).toBe(1);
  });

  it("rejects teammates and forged captain requests arriving through the public tunnel", async () => {
    const manager = new FakeManager();
    const app = await buildApp({ seedDemo: true, dbPath: ":memory:", cloudflareManager: manager }); apps.push(app);
    const teammate = await app.inject({ method: "POST", url: "/api/local-control/cloudflare/install", headers: localHeaders("B"), payload: {} });
    expect(teammate.statusCode).toBe(403);
    const publicTunnel = await app.inject({ method: "POST", url: "/api/local-control/cloudflare/start", headers: {
      host: "vibe-test.trycloudflare.com", origin: "https://vibe-test.trycloudflare.com", "x-member-id": "A", "content-type": "application/json"
    }, payload: {} });
    expect(publicTunnel.statusCode).toBe(403);
    expect(manager.installs).toBe(0);
    expect(manager.starts).toBe(0);
  });

  it("does not accept arbitrary command arguments or tunnel targets", async () => {
    const manager = new FakeManager();
    const app = await buildApp({ seedDemo: true, dbPath: ":memory:", cloudflareManager: manager }); apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/local-control/cloudflare/start", headers: localHeaders(), payload: { command: "powershell", url: "http://example.com" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("BAD_REQUEST");
    expect(manager.starts).toBe(0);
  });
});
