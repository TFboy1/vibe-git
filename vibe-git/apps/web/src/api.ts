import type { MarkdownDocument, V20BootstrapPayload } from "@vibe-git/protocol";

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

export const api = {
  bootstrap: () => request<V20BootstrapPayload>("/api/v1/bootstrap"),
  uploadPlan: (content: string) => post<MarkdownDocument>("/api/v1/plans", { filename: "plan.md", content }),
  uploadTask: (taskId: string, content: string) => post<MarkdownDocument>(`/api/v1/tasks/${encodeURIComponent(taskId)}/detail`, { filename: "task.md", content }),
  uploadChange: (content: string) => post(`/api/v1/pull-requests`, { filename: "change.md", content }),
  document: (id: string) => request<MarkdownDocument>(`/api/v1/documents/${encodeURIComponent(id)}`),
  taskDetail: (id: string) => request<{ markdown: string }>(`/api/v1/tasks/${encodeURIComponent(id)}/detail`),
  startAlignment: () => post(`/api/v1/alignments`),
  assign: (alignmentId: string, taskId: string, assigneeNodeId: string) => post(`/api/v1/alignments/${encodeURIComponent(alignmentId)}/assign`, { taskId, assigneeNodeId }),
  publish: (alignmentId: string) => post(`/api/v1/alignments/${encodeURIComponent(alignmentId)}/publish`),
  taskStart: (id: string) => post(`/api/v1/tasks/${encodeURIComponent(id)}/start`),
  taskSync: (id: string) => post(`/api/v1/tasks/${encodeURIComponent(id)}/sync`),
  taskDone: (id: string) => post(`/api/v1/tasks/${encodeURIComponent(id)}/done`),
  forceReview: () => post(`/api/v1/reviews`, { force: true }),
  applyReview: (id: string) => post(`/api/v1/reviews/${encodeURIComponent(id)}/apply`),
  rejectReview: (id: string) => post(`/api/v1/reviews/${encodeURIComponent(id)}/reject`),
  invite: () => request<{ joinUrl: string; command: string }>("/api/v1/invite"),
  rotateInvite: () => post<{ joinUrl: string; command: string }>("/api/v1/invite/rotate"),
  revokeNode: (id: string) => post(`/api/v1/nodes/${encodeURIComponent(id)}/revoke`),
  tunnelInstall: () => post(`/api/v1/local/cloudflare/install`),
  tunnelStart: () => post(`/api/v1/local/cloudflare/start`),
  tunnelStop: () => post(`/api/v1/local/cloudflare/stop`)
};

