import type { AlignmentRun, MarkdownDocument, V20BootstrapPayload, ProjectModule, InterfaceContract } from "@vibe-git/protocol";

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init, credentials: "same-origin",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers }
  });
  const text = await response.text();
  let value: unknown = text;
  try { value = text ? JSON.parse(text) : null; } catch { /* markdown/text */ }
  if (!response.ok) {
    const error = value as { error?: string; code?: string } | null;
    throw new ApiError(response.status, error?.error || `请求失败 (${response.status})`, error?.code);
  }
  return value as T;
}

const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "PUT", body: JSON.stringify(body) });

export const api = {
  bootstrap: () => request<V20BootstrapPayload>("/api/v1/bootstrap"),
  planHistory: (limit = 100, offset = 0) => request<{ total: number; items: Array<Omit<MarkdownDocument, "content"> & { current: boolean; withdrawn: boolean }> }>(`/api/v1/plans/history?limit=${limit}&offset=${offset}`),
  uploadPlan: (filename: string, content: string) => post<MarkdownDocument>("/api/v1/plans", { filename, content }),
  updatePlan: (id: string, expectedRevision: number, filename: string, content: string) =>
    put<MarkdownDocument>(`/api/v1/plans/${encodeURIComponent(id)}`, { expectedRevision, filename, content }),
  restorePlan: (id: string, expectedRevision: number) => post<MarkdownDocument>(`/api/v1/plans/${encodeURIComponent(id)}/restore`, { expectedRevision }),
  withdrawPlan: (id: string, expectedRevision: number) => request<{ withdrawn: true }>(`/api/v1/plans/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ expectedRevision }) }),
  setModules: (expectedRevision: number, items: ProjectModule[]) => put<{ revision: number; items: ProjectModule[] }>("/api/v1/modules", { expectedRevision, items }),
  uploadTask: (taskId: string, filename: string, content: string) => post<MarkdownDocument>(`/api/v1/tasks/${encodeURIComponent(taskId)}/detail`, { filename, content }),
  uploadChange: (filename: string, content: string) => post(`/api/v1/pull-requests`, { filename, content }),
  document: (id: string) => request<MarkdownDocument>(`/api/v1/documents/${encodeURIComponent(id)}`),
  taskDetail: (id: string) => request<{ markdown: string }>(`/api/v1/tasks/${encodeURIComponent(id)}/detail`),
  startAlignment: () => post<AlignmentRun>(`/api/v1/alignments`),
  resolveAlignment: (alignmentId: string, issueId: string, optionId: string, expectedRevision: number) => post(`/api/v1/alignments/${encodeURIComponent(alignmentId)}/resolve`, { issueId, optionId, expectedRevision }),
  assign: (alignmentId: string, taskId: string, assigneeNodeId: string) => post(`/api/v1/alignments/${encodeURIComponent(alignmentId)}/assign`, { taskId, assigneeNodeId }),
  publish: (alignmentId: string) => post(`/api/v1/alignments/${encodeURIComponent(alignmentId)}/publish`),
  contractAck: (contract: InterfaceContract) => post(`/api/v1/contracts/${encodeURIComponent(contract.id)}/ack`, { expectedRevision: contract.revision, sha256: contract.sha256 }),
  contractPublish: (contract: InterfaceContract) => post(`/api/v1/contracts/${encodeURIComponent(contract.id)}/publish`, { expectedRevision: contract.revision, sha256: contract.sha256 }),
  downgradeDependency: (alignmentId: string, taskId: string, upstreamTaskId: string) => post(`/api/v1/alignments/${encodeURIComponent(alignmentId)}/downgrade`, { taskId, upstreamTaskId }),
  replanStage: (stageId: string) => post<AlignmentRun>(`/api/v1/stages/${encodeURIComponent(stageId)}/replan`),
  activateReplan: (alignmentId: string) => post(`/api/v1/alignments/${encodeURIComponent(alignmentId)}/activate-replan`),
  workstreamBrief: (id: string) => request<string>(`/api/v1/workstreams/${encodeURIComponent(id)}/brief`),
  taskStart: (id: string) => post(`/api/v1/tasks/${encodeURIComponent(id)}/start`),
  taskIntegrate: (id: string) => post(`/api/v1/tasks/${encodeURIComponent(id)}/integrate`),
  taskSync: (id: string) => post(`/api/v1/tasks/${encodeURIComponent(id)}/sync`),
  taskDone: (id: string) => post(`/api/v1/tasks/${encodeURIComponent(id)}/done`),
  forceReview: () => post(`/api/v1/reviews`, { force: true }),
  applyReview: (id: string) => post(`/api/v1/reviews/${encodeURIComponent(id)}/apply`),
  rejectReview: (id: string) => post(`/api/v1/reviews/${encodeURIComponent(id)}/reject`),
  cancelReview: (id: string) => post(`/api/v1/reviews/${encodeURIComponent(id)}/cancel`),
  invite: () => request<{ joinUrl: string; command: string }>("/api/v1/invite"),
  rotateInvite: () => post<{ joinUrl: string; command: string }>("/api/v1/invite/rotate"),
  revokeNode: (id: string) => post(`/api/v1/nodes/${encodeURIComponent(id)}/revoke`),
  tunnelInstall: () => post(`/api/v1/local/cloudflare/install`),
  tunnelStart: () => post(`/api/v1/local/cloudflare/start`),
  tunnelStop: () => post(`/api/v1/local/cloudflare/stop`)
};

export interface ExecutionDetail { steps: string[]; files: string[]; mockUsage: string; validation: string[]; notes: string }
export async function localCapabilities(): Promise<{ local: boolean; chat: boolean }> {
  try { return await request<{ local: boolean; chat: boolean }>("/api/local/capabilities"); }
  catch { return { local: false, chat: false }; }
}
export const localFinalize = (taskId: string) => post<ExecutionDetail>(`/api/local/chat/${encodeURIComponent(taskId)}/finalize`);
export async function localChat(taskId: string, message: string, onDelta: (value: string) => void): Promise<string> {
  const response = await fetch(`/api/local/chat/${encodeURIComponent(taskId)}`, { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) });
  if (!response.ok || !response.body) throw new Error(`本机 Codex 对话不可用 (${response.status})`);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "", answer = "";
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const pieces = buffer.split("\n\n"); buffer = pieces.pop() ?? "";
    for (const piece of pieces) {
      const line = piece.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as { type: string; value: string };
      if (event.type === "delta") { answer += event.value; onDelta(event.value); }
      if (event.type === "done") answer = event.value;
      if (event.type === "error") throw new Error(event.value);
    }
  }
  return answer;
}
