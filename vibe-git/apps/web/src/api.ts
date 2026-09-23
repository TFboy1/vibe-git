import type { MarkdownDocument, V20BootstrapPayload, ProjectModule } from "@vibe-git/protocol";

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
  startAlignment: () => post(`/api/v1/alignments`),
  resolveAlignment: (alignmentId: string, issueId: string, optionId: string, expectedRevision: number) => post(`/api/v1/alignments/${encodeURIComponent(alignmentId)}/resolve`, { issueId, optionId, expectedRevision }),
  assign: (alignmentId: string, taskId: string, assigneeNodeId: string) => post(`/api/v1/alignments/${encodeURIComponent(alignmentId)}/assign`, { taskId, assigneeNodeId }),
  publish: (alignmentId: string) => post(`/api/v1/alignments/${encodeURIComponent(alignmentId)}/publish`),
  contractAck: (alignmentId: string, contractId: string, revision: number, hash: string) => post(`/api/v1/alignments/${encodeURIComponent(alignmentId)}/contracts/${encodeURIComponent(contractId)}/ack`, { revision, hash }),
  publishContracts: (alignmentId: string) => post(`/api/v1/alignments/${encodeURIComponent(alignmentId)}/contracts/publish`),
  downgradeContract: (alignmentId: string, contractId: string, expectedHash: string) => post(`/api/v1/alignments/${encodeURIComponent(alignmentId)}/contracts/${encodeURIComponent(contractId)}/downgrade`, { expectedHash }),
  replanStage: (stageId: string) => post(`/api/v1/stages/${encodeURIComponent(stageId)}/replan`),
  stageContractAck: (stageId: string, contractId: string, revision: number, hash: string) => post(`/api/v1/stages/${encodeURIComponent(stageId)}/contracts/${encodeURIComponent(contractId)}/ack`, { revision, hash }),
  publishStageContracts: (stageId: string) => post(`/api/v1/stages/${encodeURIComponent(stageId)}/contracts/publish`),
  downgradeStageContract: (stageId: string, contractId: string, expectedHash: string) => post(`/api/v1/stages/${encodeURIComponent(stageId)}/contracts/${encodeURIComponent(contractId)}/downgrade`, { expectedHash }),
  workstream: (id: string) => request<{ markdown: string }>(`/api/v1/workstreams/${encodeURIComponent(id)}`),
  taskStart: (id: string) => post(`/api/v1/tasks/${encodeURIComponent(id)}/start`),
  taskSync: (id: string) => post(`/api/v1/tasks/${encodeURIComponent(id)}/sync`),
  taskDone: (id: string) => post(`/api/v1/tasks/${encodeURIComponent(id)}/done`),
  taskIntegrate: (id: string, providerCommits: Record<string, string>, summary: string) => post(`/api/v1/tasks/${encodeURIComponent(id)}/integrate`, { providerCommits, summary }),
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
