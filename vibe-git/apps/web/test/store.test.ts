import { beforeEach, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { InterfaceContract, StageTask, V20BootstrapPayload } from "@vibe-git/protocol";
import { useWorkspace } from "../src/store";

beforeEach(() => setActivePinia(createPinia()));
const task = (id: string, status: StageTask["status"], assigneeNodeId = "member", archived = false) =>
  ({ id, title: id, status, assigneeNodeId, archived, dependencies: [] }) as unknown as StageTask;
function room(tasks: StageTask[], role = "captain") {
  const store = useWorkspace();
  store.data = { room: { id: "room", requirementRevision: 2 }, viewer: { id: role, role }, nodes: [], plans: [], tasks,
    stages: [], contracts: [], pullRequests: [], agile: { enabled: true, flows: [], activeFlow: null } } as unknown as V20BootstrapPayload;
  return store;
}

it("全部有效任务完成后，队长查看交付记录；归档任务不阻止完成", () => {
  const store = room([task("done", "DONE"), task("old", "IN_PROGRESS", "member", true)]);
  expect(store.nextAction).toMatchObject({ title: "本轮任务已全部完成", path: "/projects" });
});
it.each([{ tasks: [] }, { tasks: [task("old", "DONE", "member", true)] }])("没有有效任务时不误报正在开发或全部完成", ({ tasks }) => {
  expect(room(tasks).nextAction.title).toBe("本轮暂无待执行任务");
});
it("未完成任务、待审变更与正在审核的流程保持优先", () => {
  const store = room([task("working", "IN_PROGRESS")]);
  expect(store.nextAction.title).toBe("团队正在按正式需求开发");
  store.data!.tasks = [task("done", "DONE")];
  store.data!.pullRequests = [{ id: "change", stageId: "stage", flow: "agile", status: "QUEUED", createdAt: "now" }] as never;
  expect(store.nextAction.title).toContain("待审核");
  store.data!.agile!.activeFlow = { kind: "review", status: "DECIDING" } as never;
  expect(store.nextAction.title).toBe("有待确认的需求问题");
});
it("成员首页按已发布接口允许并行开发，版本失效时继续等待", () => {
  const upstream = task("api", "IN_PROGRESS", "captain"), consumer = task("web", "PUBLISHED");
  consumer.dependencies = [upstream.id];
  consumer.dependencyEdges = [{ upstreamTaskId: upstream.id, mode: "CONTRACT", contractId: "contract", contractRevision: 2, reason: "按契约并行" }];
  const store = room([upstream, consumer], "member");
  store.data!.contracts = [{ id: "contract", revision: 2, status: "PUBLISHED" }] as InterfaceContract[];
  expect(store.nextAction.body).toContain("复制指令给开发 AI");
  store.data!.contracts[0]!.revision = 3;
  expect(store.nextAction.body).toContain("等待接口更新");
});
it("成员只有归档记录时不会将其显示成本轮完成", () => {
  expect(room([task("old", "DONE", "member", true)], "member").nextAction.title).toContain("等待");
});
