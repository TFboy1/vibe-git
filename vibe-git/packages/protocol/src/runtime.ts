export interface JobActivityInput {
  id: string;
  kind: "status" | "summary" | "tool" | "output";
  message: string;
  detail?: string | undefined;
  model?: string | undefined;
}
export interface CodexModelSettings {
  selectedModel: string | null;
  effectiveModel: string | null;
  source: "vibe-git" | "codex";
  error?: string;
}
export interface ProjectConnection {
  path: string; name: string; roomId: string; role: "captain" | "member"; current: boolean;
}
export interface LocalProjects {
  current: ProjectConnection;
  projects: ProjectConnection[];
}
export interface AssignTasksInput {
  taskIds: string[];
  assigneeNodeId: string;
  expectedTaskRevisions: Record<string, number>;
}

export function safeActivityText(value: string, secrets: string[] = []): string {
  for (const secret of secrets.filter(Boolean)) value = value.split(secret).join("[已隐藏]");
  value = value.replace(/Bearer\s+[^\s"']+/gi, "Bearer [已隐藏]")
    .replace(/((?:api[_-]?key|nodeToken|leaseToken|authorization|password)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[已隐藏]")
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}/g, "[已隐藏]");
  return value.length > 4000 ? value.slice(0, 4000) + "\n[内容过长，已截断]" : value;
}
