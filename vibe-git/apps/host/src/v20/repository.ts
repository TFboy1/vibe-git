import type { DatabaseSync } from "node:sqlite";
import type {
  AgentJob, AlignmentRun, CollaborationNode, DevelopmentStage, ImpactReviewBatch,
  MarkdownDocument, Notification, RoomEvent, StageTask, VibePullRequest, Workstream, InterfaceContract,
  RequirementVersion, AlignmentDraftVersion, AlignmentReadReceipt, CoordinationChange, IntentDraft, Page
} from "@vibe-git/protocol";
import { afterCommit, transaction } from "../db/database.js";

export interface V20RoomRecord {
  id: string;
  createdAt: string;
}

const parse = <T>(row: { data: string } | undefined): T | undefined => row ? JSON.parse(row.data) as T : undefined;
const historySummary = "json_object('id',json_extract(data,'$.id'),'title',coalesce(json_extract(data,'$.title'),json_extract(data,'$.name'),'历史记录'),'summary',substr(coalesce(json_extract(data,'$.summary'),json_extract(data,'$.summaryMarkdown'),''),1,500),'status',json_extract(data,'$.status'),'sequence',json_extract(data,'$.sequence'),'createdAt',json_extract(data,'$.createdAt'))";
export const historySources: Record<string, { table: string; where?: string; projection?: string }> = {
  requirements: { table: "v20_requirement_versions", projection: "json_remove(data, '$.markdown')" },
  flows: { table: "agile_flows", where: "json_extract(data, '$.status') IN ('PUBLISHED','CANCELLED','REJECTED')", projection: "json_object('id',id,'kind',json_extract(data,'$.kind'),'status',json_extract(data,'$.status'),'createdAt',created_at,'summary',json_extract(data,'$.summary'))" },
  archivedTasks: { table: "v20_stage_tasks", where: "json_extract(data, '$.archived') = 1" },
  completedTasks: { table: "v20_stage_tasks", where: "json_extract(data, '$.status') = 'DONE' AND coalesce(json_extract(data, '$.archived'),0) = 0" },
  reviews: { table: "v20_impact_reviews", projection: historySummary },
  alignments: { table: "v20_alignments", projection: historySummary },
  stages: { table: "v20_stages", projection: historySummary }, workstreams: { table: "v20_workstreams", projection: historySummary }, contracts: { table: "v20_interface_contracts", projection: historySummary },
  intents: { table: "coordination_intents", where: "json_extract(data,'$.publishedStageId') IS NOT NULL", projection: "json_remove(data,'$.content')" },
  changes: { table: "workspace_changes", where: "status IN ('APPLIED','REJECTED')" }
};

export class V20Repository {
  constructor(readonly db: DatabaseSync) {}

  tx<T>(work: () => T): T { return transaction(this.db, work); }
  afterCommit(callback: () => void): void { afterCommit(this.db, callback); }

  activeJobCount(nodeId: string): number {
    return (this.db.prepare("SELECT count(*) AS total FROM v20_agent_jobs WHERE target_node_id = ? AND status IN ('QUEUED','LEASED','RUNNING')").get(nodeId) as { total: number }).total;
  }
  activeJobs(): AgentJob[] {
    return (this.db.prepare("SELECT data FROM v20_agent_jobs WHERE status IN ('QUEUED','LEASED','RUNNING') ORDER BY created_at").all() as { data: string }[]).map(row => JSON.parse(row.data));
  }

  // The allowlist is also used by the paginated history API; SQL identifiers never come from a request.
  historyPage(kind: string, before = Number.MAX_SAFE_INTEGER, limit = 100, ownerNodeId?: string): Page<unknown> {
    const source = historySources[kind];
    if (!source || !Object.hasOwn(historySources, kind)) throw new Error("未知历史类型");
    if (kind === "changes") return this.changeHistory(before, limit);
    const owner = ownerNodeId && ["archivedTasks", "completedTasks"].includes(kind) ? ownerNodeId : null;
    const args = owner ? [before, owner, limit + 1] : [before, limit + 1];
    const rows = this.db.prepare(`SELECT rowid AS cursor, ${source.projection ?? "data"} AS data FROM ${source.table} WHERE rowid < ? AND (${source.where ?? "1"}) ${owner ? "AND assignee_node_id=?" : ""} ORDER BY rowid DESC LIMIT ?`).all(...args) as { cursor: number; data: string }[];
    const page = rows.slice(0, limit);
    return { items: page.map(row => JSON.parse(row.data)), nextCursor: rows.length > limit ? page.at(-1)!.cursor : null };
  }

  workspaceFlows(activeOnly = false): import("@vibe-git/protocol").AgileFlow[] {
    return (this.db.prepare("SELECT json_set(data, '$.draftHistory', json('[]')) AS data FROM agile_flows WHERE json_extract(data, '$.status') NOT IN ('PUBLISHED','CANCELLED','REJECTED')" + (activeOnly ? "" : " OR rowid = (SELECT max(rowid) FROM agile_flows)") + " ORDER BY created_at, rowid").all() as { data: string }[]).map(row => JSON.parse(row.data));
  }
  historyDetail(kind: string, id: string): unknown {
    if (!["stages", "workstreams", "contracts", "intents", "reviews", "alignments", "flows"].includes(kind)) return undefined;
    const source = historySources[kind]!;
    return parse(this.db.prepare(`SELECT data FROM ${source.table} WHERE id=?`).get(id) as { data: string } | undefined);
  }

  latestPlans(): MarkdownDocument[] {
    return (this.db.prepare("SELECT d.data FROM v20_documents d WHERE kind = 'plan' AND entity_id IS NULL AND revision = (SELECT max(revision) FROM v20_documents WHERE kind = 'plan' AND entity_id IS NULL AND owner_node_id = d.owner_node_id)").all() as { data: string }[]).map(row => JSON.parse(row.data));
  }

  workspaceTasks(): StageTask[] {
    return (this.db.prepare(`WITH RECURSIVE relevant(id) AS (
      SELECT id FROM v20_stage_tasks WHERE coalesce(json_extract(data, '$.archived'),0) = 0 AND json_extract(data, '$.status') != 'DONE'
      UNION SELECT id FROM v20_stage_tasks WHERE stage_id = (SELECT id FROM v20_stages ORDER BY sequence DESC LIMIT 1) AND coalesce(json_extract(data,'$.archived'),0) = 0
      UNION SELECT dependency.value FROM v20_stage_tasks task JOIN relevant ON task.id = relevant.id,
        json_each(task.data, '$.dependencies') dependency
    ) SELECT data FROM v20_stage_tasks WHERE id IN (SELECT id FROM relevant) ORDER BY stage_id, id`).all() as { data: string }[]).map(row => JSON.parse(row.data));
  }

  requirementBySource(sourceId: string): RequirementVersion | undefined {
    return parse(this.db.prepare("SELECT data FROM v20_requirement_versions WHERE json_extract(data,'$.sourceId')=? ORDER BY revision DESC LIMIT 1").get(sourceId) as { data: string } | undefined);
  }
  workspaceAlignments(): AlignmentRun[] {
    return (this.db.prepare("SELECT data FROM v20_alignments WHERE json_extract(data,'$.publishedStageId') IS NULL AND json_extract(data,'$.status') NOT IN ('PUBLISHED','CANCELLED') ORDER BY created_at DESC LIMIT 1").all() as { data: string }[]).map(row => JSON.parse(row.data));
  }
  requirementVersion(revision: number): RequirementVersion | undefined {
    return parse(this.db.prepare("SELECT data FROM v20_requirement_versions WHERE revision = ?").get(revision) as { data: string } | undefined);
  }

  listAgileFlows(): import("@vibe-git/protocol").AgileFlow[] {
    return (this.db.prepare("SELECT data FROM agile_flows ORDER BY created_at, rowid").all() as { data: string }[]).map(row => JSON.parse(row.data));
  }
  getAgileFlow(id: string): import("@vibe-git/protocol").AgileFlow | undefined {
    return parse(this.db.prepare("SELECT data FROM agile_flows WHERE id = ?").get(id) as { data: string } | undefined);
  }
  putAgileFlow(value: import("@vibe-git/protocol").AgileFlow): void {
    this.db.prepare("INSERT INTO agile_flows (id, created_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").run(value.id, value.createdAt, JSON.stringify(value));
  }
  allTasks(): StageTask[] {
    return (this.db.prepare("SELECT data FROM v20_stage_tasks ORDER BY stage_id, id").all() as { data: string }[]).map(row => JSON.parse(row.data));
  }

  listCoordinationChanges(): CoordinationChange[] {
    return (this.db.prepare("SELECT data FROM coordination_changes ORDER BY created_at, rowid").all() as { data: string }[]).map(row => JSON.parse(row.data));
  }
  getCoordinationChange(id: string): CoordinationChange | undefined {
    return parse(this.db.prepare("SELECT data FROM coordination_changes WHERE id=?").get(id) as { data: string } | undefined);
  }
  putCoordinationChange(value: CoordinationChange): void {
    this.db.prepare("INSERT INTO coordination_changes (id,stage_id,status,created_at,data) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET stage_id=excluded.stage_id,status=excluded.status,data=excluded.data").run(value.id,value.stageId,value.status,value.createdAt,JSON.stringify(value));
  }
  listCoordinationIntents(): IntentDraft[] {
    return (this.db.prepare("SELECT data FROM coordination_intents ORDER BY rowid").all() as { data: string }[]).map(row => JSON.parse(row.data));
  }
  getCoordinationIntent(id: string): IntentDraft | undefined { return parse(this.db.prepare("SELECT data FROM coordination_intents WHERE id=?").get(id) as { data: string } | undefined); }
  putCoordinationIntent(value: IntentDraft): void { this.db.prepare("INSERT INTO coordination_intents VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(value.id,JSON.stringify(value)); }
  workspaceIntents(): IntentDraft[] {
    return (this.db.prepare("SELECT data FROM coordination_intents WHERE json_extract(data,'$.publishedStageId') IS NULL").all() as { data: string }[]).map(row => JSON.parse(row.data));
  }
  workspaceCoordinationChanges(): CoordinationChange[] {
    return (this.db.prepare("SELECT json_set(data,'$.content','') AS data FROM coordination_changes WHERE status IN ('PENDING','IN_REVIEW') ORDER BY created_at").all() as { data: string }[]).map(row => JSON.parse(row.data));
  }
  workspacePullRequests(): VibePullRequest[] {
    return (this.db.prepare("SELECT data FROM v20_pull_requests WHERE json_extract(data,'$.status') IN ('QUEUED','IN_REVIEW') ORDER BY created_at").all() as { data: string }[]).map(row => JSON.parse(row.data));
  }
  workspaceStages(): DevelopmentStage[] {
    return (this.db.prepare("SELECT data FROM (SELECT sequence,data FROM v20_stages WHERE json_extract(data,'$.status') != 'COMPLETED' UNION SELECT sequence,data FROM v20_stages WHERE sequence=(SELECT max(sequence) FROM v20_stages)) ORDER BY sequence").all() as { data: string }[]).map(row => JSON.parse(row.data));
  }
  workspaceContracts(tasks: StageTask[], stages: DevelopmentStage[]): InterfaceContract[] {
    const ids = [...new Set(tasks.flatMap(task => task.dependencyEdges?.flatMap(edge => edge.contractId ? [edge.contractId] : []) ?? []))];
    const stageIds = [...new Set([...stages.map(stage => stage.id), ...tasks.map(task => task.stageId)])];
    const taskIds = JSON.stringify(tasks.map(task => task.id));
    return (this.db.prepare(`SELECT data FROM v20_interface_contracts WHERE id IN (SELECT value FROM json_each(?)) OR
      (stage_id IN (SELECT value FROM json_each(?)) AND json_extract(data,'$.status') != 'SUPERSEDED' AND
      (json_extract(data,'$.providerTaskId') IN (SELECT value FROM json_each(?)) OR EXISTS
      (SELECT 1 FROM json_each(data,'$.consumerTaskIds') WHERE value IN (SELECT value FROM json_each(?))))) ORDER BY id`)
      .all(JSON.stringify(ids),JSON.stringify(stageIds),taskIds,taskIds) as { data: string }[]).map(row => JSON.parse(row.data));
  }
  workspaceWorkstreams(stages: DevelopmentStage[]): Workstream[] {
    return (this.db.prepare("SELECT data FROM v20_workstreams WHERE stage_id IN (SELECT value FROM json_each(?)) AND json_extract(data,'$.status') != 'SUPERSEDED' ORDER BY id").all(JSON.stringify(stages.map(stage => stage.id))) as { data: string }[]).map(row => JSON.parse(row.data));
  }
  changeHistory(before: number, limit: number): Page<unknown> {
    const prs = this.db.prepare("SELECT rowid*2 AS cursor, 'pr' AS source, data FROM v20_pull_requests WHERE rowid <= ? AND json_extract(data,'$.status') IN ('APPLIED','REJECTED') ORDER BY rowid DESC LIMIT ?").all(Math.floor((before-1)/2),limit+1);
    const changes = this.db.prepare("SELECT rowid*2+1 AS cursor, 'change' AS source, json_set(data,'$.content','') AS data FROM coordination_changes WHERE rowid <= ? AND status IN ('APPLIED','REJECTED') ORDER BY rowid DESC LIMIT ?").all(Math.floor((before-2)/2),limit+1);
    const rows = ([...prs, ...changes] as { cursor: number; source: string; data: string }[]).sort((a,b) => b.cursor-a.cursor);
    return { items: rows.slice(0,limit).map(row => ({ source: row.source, record: JSON.parse(row.data) })), nextCursor: rows.length > limit ? rows[limit-1]!.cursor : null };
  }

  getMeta(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  room(): V20RoomRecord | undefined {
    const raw = this.getMeta("v20_room");
    return raw ? JSON.parse(raw) as V20RoomRecord : undefined;
  }

  putRoom(room: V20RoomRecord): void { this.setMeta("v20_room", JSON.stringify(room)); }
  inviteHash(): string | undefined { return this.getMeta("v20_invite_hash"); }
  setInviteHash(value: string): void { this.setMeta("v20_invite_hash", value); }
  requirementRevision(): number { return Number(this.getMeta("v20_requirement_revision") ?? "0"); }
  setRequirementRevision(value: number): void { this.setMeta("v20_requirement_revision", String(value)); }
  requirementMarkdown(): string { return this.getMeta("v20_requirement_markdown") ?? ""; }
  setRequirementMarkdown(value: string): void { this.setMeta("v20_requirement_markdown", value); }
  listRequirementVersions(): RequirementVersion[] {
    return (this.db.prepare("SELECT data FROM v20_requirement_versions ORDER BY revision").all() as { data: string }[]).map(row => JSON.parse(row.data) as RequirementVersion);
  }
  putRequirementVersion(value: RequirementVersion): void {
    this.db.prepare("INSERT INTO v20_requirement_versions (revision, data) VALUES (?, ?)").run(value.revision, JSON.stringify(value));
  }
  listAlignmentDraftVersions(alignmentId?: string): AlignmentDraftVersion[] {
    const rows = alignmentId
      ? this.db.prepare("SELECT data FROM v20_alignment_draft_versions WHERE alignment_id = ? ORDER BY revision").all(alignmentId)
      : this.db.prepare("SELECT data FROM v20_alignment_draft_versions ORDER BY alignment_id, revision").all();
    return (rows as { data: string }[]).map(row => JSON.parse(row.data) as AlignmentDraftVersion);
  }
  putAlignmentDraftVersion(value: AlignmentDraftVersion): void {
    this.db.prepare("INSERT INTO v20_alignment_draft_versions (alignment_id, revision, data) VALUES (?, ?, ?)").run(value.alignmentId, value.revision, JSON.stringify(value));
  }
  listAlignmentReads(): AlignmentReadReceipt[] {
    return (this.db.prepare("SELECT data FROM v20_alignment_reads ORDER BY alignment_id, node_id, revision").all() as { data: string }[]).map(row => JSON.parse(row.data) as AlignmentReadReceipt);
  }
  putAlignmentRead(value: AlignmentReadReceipt): void {
    this.db.prepare("INSERT INTO v20_alignment_reads (alignment_id, node_id, revision, data) VALUES (?, ?, ?, ?) ON CONFLICT(alignment_id, node_id, revision) DO NOTHING")
      .run(value.alignmentId, value.nodeId, value.revision, JSON.stringify(value));
  }

  listNodes(): CollaborationNode[] {
    return (this.db.prepare("SELECT data FROM v20_nodes ORDER BY role, id").all() as { data: string }[]).map((row) => JSON.parse(row.data) as CollaborationNode);
  }
  getNode(id: string): CollaborationNode | undefined { return parse<CollaborationNode>(this.db.prepare("SELECT data FROM v20_nodes WHERE id = ?").get(id) as { data: string } | undefined); }
  getNodeByCredentialHash(hash: string): CollaborationNode | undefined { return parse<CollaborationNode>(this.db.prepare("SELECT data FROM v20_nodes WHERE credential_hash = ?").get(hash) as { data: string } | undefined); }
  putNode(node: CollaborationNode, credentialHash?: string): void {
    if (credentialHash) {
      this.db.prepare("INSERT INTO v20_nodes (id, credential_hash, role, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET credential_hash = excluded.credential_hash, role = excluded.role, data = excluded.data")
        .run(node.id, credentialHash, node.role, JSON.stringify(node));
      return;
    }
    this.db.prepare("UPDATE v20_nodes SET role = ?, data = ? WHERE id = ?").run(node.role, JSON.stringify(node), node.id);
  }
  credentialHashForNode(id: string): string | undefined {
    return (this.db.prepare("SELECT credential_hash FROM v20_nodes WHERE id = ?").get(id) as { credential_hash: string } | undefined)?.credential_hash;
  }

  listDocuments(kind?: string): MarkdownDocument[] {
    const rows = kind
      ? this.db.prepare("SELECT data FROM v20_documents WHERE kind = ? ORDER BY owner_node_id, revision DESC").all(kind)
      : this.db.prepare("SELECT data FROM v20_documents ORDER BY kind, owner_node_id, revision DESC").all();
    return (rows as { data: string }[]).map((row) => JSON.parse(row.data) as MarkdownDocument);
  }
  getDocument(id: string): MarkdownDocument | undefined { return parse<MarkdownDocument>(this.db.prepare("SELECT data FROM v20_documents WHERE id = ?").get(id) as { data: string } | undefined); }
  latestDocument(ownerNodeId: string, kind: string, entityId?: string | null): MarkdownDocument | undefined {
    const row = entityId === undefined
      ? this.db.prepare("SELECT data FROM v20_documents WHERE owner_node_id = ? AND kind = ? ORDER BY revision DESC LIMIT 1").get(ownerNodeId, kind)
      : entityId === null
        ? this.db.prepare("SELECT data FROM v20_documents WHERE owner_node_id = ? AND kind = ? AND entity_id IS NULL ORDER BY revision DESC LIMIT 1").get(ownerNodeId, kind)
        : this.db.prepare("SELECT data FROM v20_documents WHERE owner_node_id = ? AND kind = ? AND entity_id = ? ORDER BY revision DESC LIMIT 1").get(ownerNodeId, kind, entityId);
    return parse<MarkdownDocument>(row as { data: string } | undefined);
  }
  putDocument(value: MarkdownDocument): void {
    this.db.prepare("INSERT INTO v20_documents (id, kind, owner_node_id, entity_id, revision, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run(value.id, value.kind, value.ownerNodeId, value.entityId, value.revision, JSON.stringify(value));
  }

  listAlignments(): AlignmentRun[] { return (this.db.prepare("SELECT data FROM v20_alignments ORDER BY created_at").all() as { data: string }[]).map((row) => JSON.parse(row.data) as AlignmentRun); }
  getAlignment(id: string): AlignmentRun | undefined { return parse<AlignmentRun>(this.db.prepare("SELECT data FROM v20_alignments WHERE id = ?").get(id) as { data: string } | undefined); }
  putAlignment(value: AlignmentRun): void {
    this.db.prepare("INSERT INTO v20_alignments (id, created_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(value.id, value.createdAt, JSON.stringify(value));
  }

  listWorkstreams(alignmentId?: string): Workstream[] {
    const rows = alignmentId
      ? this.db.prepare("SELECT data FROM v20_workstreams WHERE alignment_id = ? ORDER BY id").all(alignmentId)
      : this.db.prepare("SELECT data FROM v20_workstreams ORDER BY id").all();
    return (rows as { data: string }[]).map((row) => JSON.parse(row.data) as Workstream);
  }
  getWorkstream(id: string): Workstream | undefined { return parse<Workstream>(this.db.prepare("SELECT data FROM v20_workstreams WHERE id = ?").get(id) as { data: string } | undefined); }
  putWorkstream(value: Workstream): void {
    this.db.prepare("INSERT INTO v20_workstreams (id, alignment_id, stage_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET stage_id = excluded.stage_id, data = excluded.data")
      .run(value.id, value.alignmentId, value.stageId, JSON.stringify(value));
  }
  listContracts(alignmentId?: string): InterfaceContract[] {
    const rows = alignmentId
      ? this.db.prepare("SELECT data FROM v20_interface_contracts WHERE alignment_id = ? ORDER BY id").all(alignmentId)
      : this.db.prepare("SELECT data FROM v20_interface_contracts ORDER BY id").all();
    return (rows as { data: string }[]).map((row) => JSON.parse(row.data) as InterfaceContract);
  }
  getContract(id: string): InterfaceContract | undefined { return parse<InterfaceContract>(this.db.prepare("SELECT data FROM v20_interface_contracts WHERE id = ?").get(id) as { data: string } | undefined); }
  contractsForTask(task: StageTask): InterfaceContract[] {
    return (this.db.prepare("SELECT data FROM v20_interface_contracts WHERE stage_id=? AND json_extract(data,'$.status') != 'SUPERSEDED' AND (json_extract(data,'$.providerTaskId')=? OR EXISTS(SELECT 1 FROM json_each(data,'$.consumerTaskIds') WHERE value=?))").all(task.stageId,task.id,task.id) as { data: string }[]).map(row => JSON.parse(row.data));
  }
  hasPendingCoordinationChange(stageId: string): boolean { return !!this.db.prepare("SELECT 1 FROM coordination_changes WHERE stage_id=? AND status='PENDING' LIMIT 1").get(stageId); }
  putContract(value: InterfaceContract): void {
    this.db.prepare("INSERT INTO v20_interface_contracts (id, alignment_id, stage_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET stage_id = excluded.stage_id, data = excluded.data")
      .run(value.id, value.alignmentId, value.stageId, JSON.stringify(value));
  }

  listStages(): DevelopmentStage[] { return (this.db.prepare("SELECT data FROM v20_stages ORDER BY sequence").all() as { data: string }[]).map((row) => JSON.parse(row.data) as DevelopmentStage); }
  getStage(id: string): DevelopmentStage | undefined { return parse<DevelopmentStage>(this.db.prepare("SELECT data FROM v20_stages WHERE id = ?").get(id) as { data: string } | undefined); }
  currentStage(): DevelopmentStage | undefined { return parse<DevelopmentStage>(this.db.prepare("SELECT data FROM v20_stages WHERE json_extract(data, '$.status') IN ('ACTIVE','REVIEWING','AWAITING_APPLY') ORDER BY sequence DESC LIMIT 1").get() as { data: string } | undefined); }
  putStage(value: DevelopmentStage): void {
    this.db.prepare("INSERT INTO v20_stages (id, sequence, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET sequence = excluded.sequence, data = excluded.data")
      .run(value.id, value.sequence, JSON.stringify(value));
  }

  listTasks(stageId?: string): StageTask[] {
    const rows = stageId
      ? this.db.prepare("SELECT data FROM v20_stage_tasks WHERE stage_id = ? ORDER BY id").all(stageId)
      : this.db.prepare("SELECT data FROM v20_stage_tasks ORDER BY stage_id, id").all();
    return (rows as { data: string }[]).map((row) => JSON.parse(row.data) as StageTask).filter((item) => !item.archived);
  }
  getTask(id: string): StageTask | undefined { return parse<StageTask>(this.db.prepare("SELECT data FROM v20_stage_tasks WHERE id = ?").get(id) as { data: string } | undefined); }
  putTask(value: StageTask): void {
    this.db.prepare("INSERT INTO v20_stage_tasks (id, stage_id, assignee_node_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET stage_id = excluded.stage_id, assignee_node_id = excluded.assignee_node_id, data = excluded.data")
      .run(value.id, value.stageId, value.assigneeNodeId, JSON.stringify(value));
  }

  listPullRequests(): VibePullRequest[] { return (this.db.prepare("SELECT data FROM v20_pull_requests ORDER BY created_at").all() as { data: string }[]).map((row) => JSON.parse(row.data) as VibePullRequest); }
  getPullRequest(id: string): VibePullRequest | undefined { return parse<VibePullRequest>(this.db.prepare("SELECT data FROM v20_pull_requests WHERE id = ?").get(id) as { data: string } | undefined); }
  putPullRequest(value: VibePullRequest): void {
    this.db.prepare("INSERT INTO v20_pull_requests (id, stage_id, created_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET stage_id = excluded.stage_id, data = excluded.data")
      .run(value.id, value.stageId, value.createdAt, JSON.stringify(value));
  }

  listReviews(): ImpactReviewBatch[] { return (this.db.prepare("SELECT data FROM v20_impact_reviews ORDER BY created_at").all() as { data: string }[]).map((row) => JSON.parse(row.data) as ImpactReviewBatch); }
  getReview(id: string): ImpactReviewBatch | undefined { return parse<ImpactReviewBatch>(this.db.prepare("SELECT data FROM v20_impact_reviews WHERE id = ?").get(id) as { data: string } | undefined); }
  putReview(value: ImpactReviewBatch): void {
    this.db.prepare("INSERT INTO v20_impact_reviews (id, stage_id, created_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET stage_id = excluded.stage_id, data = excluded.data")
      .run(value.id, value.stageId, value.createdAt, JSON.stringify(value));
  }

  listJobs(): AgentJob[] { return (this.db.prepare("SELECT data FROM v20_agent_jobs ORDER BY created_at").all() as { data: string }[]).map((row) => JSON.parse(row.data) as AgentJob); }
  getJob(id: string): AgentJob | undefined { return parse<AgentJob>(this.db.prepare("SELECT data FROM v20_agent_jobs WHERE id = ?").get(id) as { data: string } | undefined); }
  putJob(value: AgentJob): void {
    this.db.prepare("INSERT INTO v20_agent_jobs (id, target_node_id, status, created_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET target_node_id = excluded.target_node_id, status = excluded.status, data = excluded.data")
      .run(value.id, value.targetNodeId, value.status, value.createdAt, JSON.stringify(value));
  }

  listNotifications(nodeId?: string): Notification[] {
    const rows = nodeId
      ? this.db.prepare("SELECT data FROM v20_notifications WHERE recipient_node_id = ? ORDER BY created_at DESC LIMIT 100").all(nodeId)
      : this.db.prepare("SELECT data FROM v20_notifications ORDER BY created_at DESC LIMIT 300").all();
    return (rows as { data: string }[]).map((row) => JSON.parse(row.data) as Notification);
  }
  getNotification(id: string): Notification | null {
    const row = this.db.prepare("SELECT data FROM v20_notifications WHERE id = ?").get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as Notification : null;
  }
  putNotification(value: Notification): void {
    this.db.prepare("INSERT INTO v20_notifications (id, recipient_node_id, created_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(value.id, value.recipientNodeId, value.createdAt, JSON.stringify(value));
  }

  putBrowserTicket(hash: string, nodeId: string, expiresAt: string): void {
    this.db.prepare("INSERT INTO v20_browser_tickets (token_hash, node_id, expires_at, used_at) VALUES (?, ?, ?, NULL)").run(hash, nodeId, expiresAt);
  }
  consumeBrowserTicket(hash: string, now: string): string | undefined {
    const row = this.db.prepare("SELECT node_id, expires_at, used_at FROM v20_browser_tickets WHERE token_hash = ?").get(hash) as { node_id: string; expires_at: string; used_at: string | null } | undefined;
    if (!row || row.used_at || row.expires_at <= now) return undefined;
    this.db.prepare("UPDATE v20_browser_tickets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL").run(now, hash);
    return row.node_id;
  }
  putBrowserSession(hash: string, nodeId: string, expiresAt: string): void {
    this.db.prepare("INSERT INTO v20_browser_sessions (token_hash, node_id, expires_at) VALUES (?, ?, ?) ON CONFLICT(token_hash) DO UPDATE SET node_id = excluded.node_id, expires_at = excluded.expires_at").run(hash, nodeId, expiresAt);
  }
  nodeIdForBrowserSession(hash: string, now: string): string | undefined {
    return (this.db.prepare("SELECT node_id FROM v20_browser_sessions WHERE token_hash = ? AND expires_at > ?").get(hash, now) as { node_id: string } | undefined)?.node_id;
  }

  appendEvent(type: string, actorId: string, entityType: string, entityId: string, payload: unknown): RoomEvent {
    const createdAt = new Date().toISOString();
    const result = this.db.prepare("INSERT INTO events (type, actor_id, source, entity_type, entity_id, payload, created_at) VALUES (?, ?, 'system', ?, ?, ?, ?)")
      .run(type, actorId, entityType, entityId, JSON.stringify(payload), createdAt);
    return { seq: Number(result.lastInsertRowid), type, actorId: actorId as RoomEvent["actorId"], source: "system", entityType, entityId, payload, createdAt };
  }
  eventsSince(since = 0, limit = 100): RoomEvent[] {
    return (this.db.prepare("SELECT * FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?").all(since, limit) as Record<string, unknown>[]).map((row) => ({
      seq: Number(row.seq), type: String(row.type), actorId: String(row.actor_id) as RoomEvent["actorId"], source: "system",
      entityType: String(row.entity_type), entityId: String(row.entity_id), payload: JSON.parse(String(row.payload)), createdAt: String(row.created_at)
    }));
  }
  lastSeq(): number { return Number((this.db.prepare("SELECT COALESCE(MAX(seq), 0) seq FROM events").get() as { seq: number }).seq); }

  activityExists(jobId: string, activityId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM events WHERE type='job.progress' AND entity_id=? AND json_extract(payload,'$.activityId')=? LIMIT 1").get(jobId, activityId));
  }
  flowActivity(flowId: string, before: number, limit = 100): { events: RoomEvent[]; hasMore: boolean } {
    const rows = this.db.prepare("SELECT * FROM events WHERE seq < ? AND ((entity_type='agile' AND entity_id=?) OR (entity_type='agent_job' AND json_extract(payload,'$.flowId')=?)) ORDER BY seq DESC LIMIT ?")
      .all(before, flowId, flowId, limit + 1) as Record<string, unknown>[];
    return { hasMore: rows.length > limit, events: rows.slice(0, limit).reverse().map(row => ({
      seq: Number(row.seq), type: String(row.type), actorId: String(row.actor_id) as RoomEvent["actorId"], source: "system",
      entityType: String(row.entity_type), entityId: String(row.entity_id), payload: JSON.parse(String(row.payload)), createdAt: String(row.created_at)
    })) };
  }
}
