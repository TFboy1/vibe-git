import type { DatabaseSync } from "node:sqlite";
import type {
  AgentJob, AlignmentRun, CollaborationNode, DevelopmentStage, ImpactReviewBatch,
  MarkdownDocument, Notification, RoomEvent, StageTask, VibePullRequest, Workstream, InterfaceContract
} from "@vibe-git/protocol";
import { transaction } from "../db/database.js";

export interface V20RoomRecord {
  id: string;
  createdAt: string;
}

const parse = <T>(row: { data: string } | undefined): T | undefined => row ? JSON.parse(row.data) as T : undefined;

export class V20Repository {
  constructor(readonly db: DatabaseSync) {}

  tx<T>(work: () => T): T { return transaction(this.db, work); }

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
  nextQueuedJob(nodeId: string): AgentJob | undefined {
    return parse<AgentJob>(this.db.prepare("SELECT data FROM v20_agent_jobs WHERE target_node_id = ? AND status = 'QUEUED' ORDER BY created_at LIMIT 1").get(nodeId) as { data: string } | undefined);
  }
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
}
