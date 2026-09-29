import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { workspaceChanges } from "@vibe-git/protocol";
import type { AgileFlow, LocalComputeStatus, LocalCodexStatus, RoomEvent, V20BootstrapPayload } from "@vibe-git/protocol";
import { request } from "./api";

export const useWorkspace = defineStore("workspace", () => {
  const data = ref<V20BootstrapPayload | null>(null), ready = ref(false), local = ref(false), connected = ref(false);
  const error = ref(""), notice = ref(""), pending = ref(0);
  const compute = ref<LocalComputeStatus | null>(null), computeError = ref(""), codex = ref<LocalCodexStatus | null>(null);
  const captain = computed(() => data.value?.viewer.role === "captain");
  const canManage = computed(() => captain.value && local.value);
  const agileEnabled = computed(() => data.value?.agile?.enabled === true);
  const batchReviewEnabled = computed(() => agileEnabled.value || data.value?.agile?.batchReviewEnabled === true);
  const flow = computed(() => data.value?.agile?.activeFlow ?? null);
  const changes = computed(() => data.value ? workspaceChanges(data.value) : []);
  const pendingChanges = computed(() => changes.value.filter(change => ["PENDING", "QUEUED"].includes(change.status)));
  const reviewStage = computed(() => [...(data.value?.stages ?? [])].reverse().find(stage => stage.status !== "COMPLETED") ?? data.value?.stages.at(-1));
  const pendingPRs = computed(() => pendingChanges.value.filter(change => change.stageId === reviewStage.value?.id && !change.reviewId));
  const busy = computed(() => pending.value > 0);
  const provider = computed(() => captain.value && local.value && compute.value ? compute.value.provider : data.value?.agile?.compute.provider ?? "codex");
  const computeLabel = computed(() => {
    if (captain.value && local.value && computeError.value) return "连接状态读取失败";
    if (provider.value === "codex") return (data.value?.auditPool.available ?? 0) > 0 ? "Codex 已连接 · " + data.value!.auditPool.available + " 个可用节点" : "Codex 尚未就绪";
    if (!captain.value || !local.value) return data.value?.nodes.some(node => node.role === "captain" && node.connected && node.apiReady) ? "API 已配置 · 队长本机在线" : "API 等待队长本机连接";
    if (!compute.value?.ready) return "API 配置待补全";
    if (compute.value.connection?.status === "passed") return "API 连接测试通过";
    if (compute.value.connection?.status === "failed") return "API 连接测试失败";
    return "API 已配置 · 待测试连接";
  });
  const computeAvailable = computed(() => provider.value === "codex" ? (data.value?.auditPool.available ?? 0) > 0 :
    captain.value && local.value ? compute.value?.ready && compute.value.connection?.status === "passed" : data.value?.nodes.some(node => node.role === "captain" && node.connected && node.apiReady));
  let events: EventSource | null = null, refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshPromise: Promise<void> | null = null, refreshAgain = false;
  async function refresh(): Promise<void> {
    if (refreshPromise) { refreshAgain = true; return refreshPromise; }
    refreshPromise = (async () => {
      do {
        refreshAgain = false;
        data.value = await request<V20BootstrapPayload>("/api/v1/bootstrap");
        if (local.value && captain.value) await refreshCompute();
      } while (refreshAgain);
    })();
    try { await refreshPromise; } finally { refreshPromise = null; }
  }
  async function start() {
    try {
      await refresh();
      try { local.value = (await request<{ local: boolean }>("/api/local/capabilities")).local; } catch { local.value = false; }
      if (local.value && captain.value) await refreshCompute();
      ready.value = true;
      events = new EventSource("/api/v1/events?since=" + data.value!.room.seq);
      events.onopen = () => { connected.value = true; void refresh().catch(() => undefined); };
      events.onerror = () => { connected.value = false; };
      events.onmessage = event => {
        try {
          const value = JSON.parse(event.data) as RoomEvent;
          if (data.value) data.value.room.seq = value.seq;
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => void refresh().catch(e => { error.value = message(e); }), 100);
        } catch { /* reconnect will restore a full snapshot */ }
      };
    } catch (e) { error.value = message(e); ready.value = true; }
  }
  async function refreshCompute(includeCodex = false) {
    try { compute.value = await request<LocalComputeStatus>("/api/local/compute"); computeError.value = ""; }
    catch (e) { computeError.value = message(e); }
    if (includeCodex) {
      try { codex.value = await request<LocalCodexStatus>("/api/local/codex"); }
      catch (e) { computeError.value = message(e); }
    }
  }
  function stop() { events?.close(); events = null; clearTimeout(refreshTimer); }
  function message(e: unknown) { return e instanceof Error ? e.message : String(e); }
  async function perform<T>(work: () => Promise<T>, success = ""): Promise<T | null> {
    pending.value++; error.value = "";
    try {
      const result = await work();
      await refresh();
      if (success) notice.value = success;
      return result;
    } catch (e) { error.value = message(e); return null; }
    finally { pending.value--; }
  }
  const mutate = <T = AgileFlow>(path: string, body: unknown, success = "", method = "POST") =>
    perform(() => request<T>(path, body, method), success);
  function name(id: string) { return data.value?.nodes.find(n => n.id === id)?.label ?? id.slice(-6); }
  return { data, ready, local, connected, error, notice, captain, canManage, agileEnabled, batchReviewEnabled, reviewStage, flow, changes, pendingChanges, pendingPRs, busy,
    compute, codex, computeError, provider, computeLabel, computeAvailable, refreshCompute, start, stop, refresh, perform, mutate, name };
});
