export const duration = 30_000

export const scenes = [
  { id: 'plans', label: '个人计划', start: 0, poster: 4_200, description: '每个人的计划，都成为共同需求的依据。' },
  { id: 'decision', label: 'AI 分析与裁决', start: 6_000, poster: 9_300, description: 'AI 找出分歧，人来决定方向。' },
  { id: 'requirement', label: '共同需求', start: 12_000, poster: 15_000, description: '队长直接编辑需求，所有人遵循同一份原文。' },
  { id: 'allocation', label: '审核与派发', start: 18_000, poster: 22_300, description: 'AI 生成分工，队长确认后统一派发。' },
  { id: 'execution', label: 'Agent 协同开发', start: 24_000, poster: 29_200, description: '各自的 Agent 同步任务、执行开发，再携带证据汇报。' },
] as const

export const members = [
  { id: 'lin', name: '林悦', role: '队长', agent: 'Codex' },
  { id: 'chen', name: '陈晨', role: '成员', agent: 'Claude Code' },
  { id: 'zhou', name: '周宁', role: '成员', agent: 'Cursor' },
] as const

export const tasks = [
  { id: 'contract', code: 'VG-101', title: '定义待办 API 契约', owner: 'lin', goal: '明确 /todos 的请求、响应与错误格式。', boundary: '维护共享接口契约，不修改业务界面。', acceptance: '新增、查询和完成状态的字段与示例齐全。', path: 'api/openapi.yaml', dependencies: [], evidence: '接口契约已提交；请求与响应示例核对通过。' },
  { id: 'frontend', code: 'VG-102', title: '实现 Vue 待办界面', owner: 'chen', goal: '支持新增待办、切换完成状态与筛选。', boundary: '只修改 web/，按共同 API 契约实现。', acceptance: '新增与筛选可用；npm run build 通过。', path: 'web/src/', dependencies: ['contract'], evidence: 'npm run build：生产构建通过；完成状态与筛选已验证。' },
  { id: 'backend', code: 'VG-103', title: '实现 FastAPI 接口', owner: 'zhou', goal: '实现待办查询、新增与状态更新接口。', boundary: '只修改 api/，不改变已确认的接口字段。', acceptance: '接口与契约一致；uv run pytest 通过。', path: 'api/app/', dependencies: ['contract'], evidence: 'uv run pytest：接口用例通过；响应字段符合契约。' },
] as const

export const options = [
  { letter: 'A', title: '首版包含实时通知', impact: '扩展通知接口与订阅逻辑，增加第一轮范围。' },
  { letter: 'B', title: '先完成待办核心，通知留到下一轮', impact: '保留扩展边界，让首轮验收聚焦新增、完成与筛选。' },
  { letter: 'C', title: '先交付通知原型，再实现核心功能', impact: '优先验证通知体验，调整首轮开发顺序。' },
] as const

export type DemoBeat = { at: number; target?: string; click?: boolean }
export const beats: DemoBeat[] = [
  { at: 0, target: 'plan-editor' }, { at: 800, target: 'plan-editor' },
  { at: 1_600, target: 'submit-plan' }, { at: 2_200, target: 'submit-plan', click: true },
  { at: 2_500 }, { at: 3_400 }, { at: 4_000 }, { at: 4_700, target: 'integrate' },
  { at: 5_400, target: 'integrate', click: true }, { at: 6_000 }, { at: 6_800 },
  { at: 8_000, target: 'choice-b' }, { at: 8_600, target: 'choice-b', click: true },
  { at: 9_300 }, { at: 10_000, target: 'confirm-decision' },
  { at: 10_700, target: 'confirm-decision', click: true }, { at: 11_400 },
  { at: 12_000 }, { at: 13_000, target: 'acceptance' }, { at: 13_800, target: 'acceptance' },
  { at: 15_000 }, { at: 16_100, target: 'generate' }, { at: 16_900, target: 'generate', click: true },
  { at: 17_400 }, { at: 18_000 }, { at: 19_000, target: 'owner' },
  { at: 19_600, target: 'owner', click: true }, { at: 20_200 },
  { at: 20_600, target: 'save-allocation' }, { at: 21_200, target: 'save-allocation', click: true },
  { at: 21_700 }, { at: 22_100, target: 'publish' }, { at: 22_800, target: 'publish', click: true },
  { at: 23_400 }, { at: 24_000 }, { at: 24_400 }, { at: 25_100 },
  { at: 25_500 }, { at: 26_400 }, { at: 27_200 }, { at: 28_300 }, { at: 29_200 },
]

export function sceneAt(time: number) {
  return scenes.reduce((index, scene, i) => time >= scene.start ? i : index, 0)
}

export function beatAt(time: number) {
  return beats.reduce((current, beat) => time >= beat.at ? beat : current, beats[0])
}

export function taskState(id: string, time: number): 'todo' | 'doing' | 'blocked' | 'done' {
  if (id === 'contract') return time >= 25_100 ? 'done' : time >= 24_400 ? 'doing' : 'todo'
  if (time < 25_500) return 'todo'
  return time >= (id === 'backend' ? 27_200 : 28_300) ? 'done' : 'doing'
}
