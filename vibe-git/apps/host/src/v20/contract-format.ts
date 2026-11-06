import type { DependencyEdge, InterfaceContract, StageTask, TaskBrief, Workstream } from "@vibe-git/protocol";

const lines = (title: string, values: string[]) => `## ${title}\n${values.length ? values.map((value) => `- ${value}`).join("\n") : "- 无"}`;
export function validBrief(value: TaskBrief | undefined): value is TaskBrief {
  if (!value || typeof value !== "object") return false;
  const arrays = [value.deliverables, value.ownedPaths, value.excludedPaths, value.requirementRefs,
    value.interfaceNotes, value.integrationSteps, value.verificationCommands];
  return arrays.every((item) => Array.isArray(item) && item.length > 0 && item.every((entry) => typeof entry === "string" && Boolean(entry.trim())))
    && typeof value.mockStrategy === "string" && Boolean(value.mockStrategy.trim())
    && typeof value.handoff === "string" && Boolean(value.handoff.trim());
}

export function taskMarkdown(task: StageTask, edges: DependencyEdge[] = task.dependencyEdges ?? [], contracts: InterfaceContract[] = []): string {
  const brief = task.brief;
  return [
    `# ${task.title}`, `任务 ${task.id} · 负责人 ${task.assigneeNodeId}`,
    lines("正式目标", [task.goal]), lines("边界与禁改范围", [task.boundary, ...(brief?.excludedPaths ?? [])]),
    lines("交付物", brief?.deliverables ?? []), lines("负责路径", brief?.ownedPaths ?? []),
    lines("关联需求", brief?.requirementRefs ?? []), lines("接口约束", brief?.interfaceNotes ?? []),
    lines("依赖与放行条件", edges.length ? edges.map((edge) => {
      const contract = contracts.find((item) => item.id === edge.contractId);
      return `${edge.upstreamTaskId} · ${edge.mode === "HARD" ? "硬依赖：上游 DONE" : `契约可并行：${contract?.name ?? edge.contractId} r${edge.contractRevision}`} · ${edge.reason}`;
    }) : task.dependencies.map((item) => `${item} · 硬依赖：上游 DONE`)),
    ...contracts.filter((contract) => edges.some((edge) => edge.contractId === contract.id)).map((contract) => [
      `## 接口契约 ${contract.id} · r${contract.revision} · sha256:${contract.sha256}`,
      `- 提供方：${contract.providerTaskId}`,
      `- 消费方：${contract.consumerTaskIds.join("、")}`,
      `- 类型：${contract.kind}`,
      `- 签名 / 协议：${contract.signature}`,
      ...contract.behavior.map((item) => `- 行为：${item}`),
      ...contract.examples.map((item) => `- 成功样例：${item}`),
      ...contract.errors.map((item) => `- 错误样例：${item}`),
      `- 契约测试：${contract.testCommand}`,
      `- 交接产物：${contract.handoff}`
    ].join("\n")),
    lines("Mock 接法", brief ? [brief.mockStrategy] : []),
    lines("真实集成步骤", brief?.integrationSteps ?? []),
    lines("验证命令", brief?.verificationCommands ?? []),
    lines("交接产物", brief ? [brief.handoff] : []),
    lines("验收", task.acceptance)
  ].join("\n\n");
}

export function workstreamMarkdown(workstream: Workstream, tasks: StageTask[], contracts: InterfaceContract[]): string {
  return [`# ${workstream.mission}`, `工作主线 ${workstream.id} · 负责人 ${workstream.ownerNodeId}`,
    lines("职责边界", [workstream.boundary]),
    ...tasks.filter((task) => workstream.taskIds.includes(task.id)).map((task, index) =>
      `\n---\n\n# 切片 ${index + 1}/${workstream.taskIds.length}\n\n${taskMarkdown(task, task.dependencyEdges, contracts)}`)
  ].join("\n\n");
}
