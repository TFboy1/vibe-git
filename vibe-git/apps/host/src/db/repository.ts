import type { DatabaseSync } from "node:sqlite";
import type {
  AcceptanceRecord, ConsensusRevision, DecisionRecord, DelegationPolicy, DeviceSignal,
  ConflictReview, EvidenceBundle, ExecutionCommand, ExecutionDecision, ExecutionLease, FreezeException, FreezePolicy,
  FunctionalConflict, GitReference, IdeaReview, IssueReport, MemberProposal, Milestone,
  Module, PlanReview, ProjectProfile, RequirementChangeRequest, RequirementItem, RequirementRevision,
  RoomEvent, SubmissionSource, TaskPackage, WorkUnit
} from "@vibe-git/protocol";
import { transaction } from "./database.js";

const TABLES = {
  requirements: "requirements", revisions: "requirement_revisions", tasks: "tasks",
  changes: "change_requests", conflicts: "conflicts", conflictReviews: "conflict_reviews", git: "git_references",
  devices: "devices", leases: "execution_leases", executionCommands: "execution_commands", proposals: "proposals",
  consensus: "consensus_revisions", policies: "delegation_policies", decisions: "decision_records",
  modules: "modules", workUnits: "work_units", planReviews: "plan_reviews", ideaReviews: "idea_reviews",
  issues: "issues", milestones: "milestones", freezePolicies: "freeze_policies",
  freezeExceptions: "freeze_exceptions", executionDecisions: "execution_decisions",
  evidenceBundles: "evidence_bundles", acceptanceRecords: "acceptance_records", workUnitGit: "work_unit_git_references"
} as const;

type Table = keyof typeof TABLES;

export class IdempotencyConflictError extends Error {
  constructor() { super("同一幂等键不能用于不同操作或请求载荷"); }
}

export class Repository {
  constructor(readonly db: DatabaseSync) {}

  getProject(): ProjectProfile | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'project_profile'").get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) as ProjectProfile : undefined;
  }

  putProject(project: ProjectProfile) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('project_profile', ?)").run(JSON.stringify(project));
  }

  hasDemoData(): boolean {
    return Boolean(this.db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get());
  }

  tx<T>(work: () => T): T { return transaction(this.db, work); }

  private listJson<T>(table: Table): T[] {
    const order = table === "revisions" ? "revision" : table === "git" ? "task_id" : table === "workUnitGit" ? "work_unit_id" : table === "devices" ? "member_id" : "id";
    return (this.db.prepare(`SELECT data FROM ${TABLES[table]} ORDER BY ${order}`).all() as { data: string }[]).map((row) => JSON.parse(row.data) as T);
  }

  private getJson<T>(table: Table, id: string | number): T | undefined {
    const column = table === "revisions" ? "revision" : table === "git" ? "task_id" : table === "workUnitGit" ? "work_unit_id" : table === "devices" ? "member_id" : "id";
    const row = this.db.prepare(`SELECT data FROM ${TABLES[table]} WHERE ${column} = ?`).get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as T : undefined;
  }

  private putJson(table: Table, id: string | number, value: unknown): void {
    const column = table === "revisions" ? "revision" : table === "git" ? "task_id" : table === "workUnitGit" ? "work_unit_id" : table === "devices" ? "member_id" : "id";
    if (table === "leases") throw new Error("Use putLease for leases");
    this.db.prepare(`INSERT INTO ${TABLES[table]} (${column}, data) VALUES (?, ?) ON CONFLICT(${column}) DO UPDATE SET data = excluded.data`).run(id, JSON.stringify(value));
  }

  listRequirements() { return this.listJson<RequirementItem>("requirements"); }
  getRequirement(id: string) { return this.getJson<RequirementItem>("requirements", id); }
  putRequirement(item: RequirementItem) { this.putJson("requirements", item.id, item); }
  listRevisions() { return this.listJson<RequirementRevision>("revisions"); }
  putRevision(item: RequirementRevision) { this.putJson("revisions", item.revision, item); }
  listTasks() { return this.listJson<TaskPackage>("tasks"); }
  getTask(id: string) { return this.getJson<TaskPackage>("tasks", id); }
  putTask(item: TaskPackage) { this.putJson("tasks", item.id, item); }
  listChanges() { return this.listJson<RequirementChangeRequest>("changes"); }
  getChange(id: string) { return this.getJson<RequirementChangeRequest>("changes", id); }
  putChange(item: RequirementChangeRequest) { this.putJson("changes", item.id, item); }
  listConflicts() { return this.listJson<FunctionalConflict>("conflicts"); }
  getConflict(id: string) { return this.getJson<FunctionalConflict>("conflicts", id); }
  putConflict(item: FunctionalConflict) { this.putJson("conflicts", item.id, item); }
  listConflictReviews() { return this.listJson<ConflictReview>("conflictReviews"); }
  getConflictReview(id: string) { return this.getJson<ConflictReview>("conflictReviews", id); }
  putConflictReview(item: ConflictReview) { this.putJson("conflictReviews", item.id, item); }
  listGitReferences() { return [...this.listJson<GitReference>("git"), ...this.listJson<GitReference>("workUnitGit")]; }
  putGitReference(item: GitReference) {
    if (item.workUnitId) this.putJson("workUnitGit", item.workUnitId, item);
    else this.putJson("git", item.taskId, item);
  }
  listDevices() { return this.listJson<DeviceSignal>("devices"); }
  getDevice(memberId: string) { return this.getJson<DeviceSignal>("devices", memberId); }
  putDevice(item: DeviceSignal) { this.putJson("devices", item.memberId, item); }
  listLeases() { return this.listJson<ExecutionLease>("leases"); }
  getLease(id: string) { return this.getJson<ExecutionLease>("leases", id); }
  listExecutionCommands() { return this.listJson<ExecutionCommand>("executionCommands"); }
  getExecutionCommand(id: string) { return this.getJson<ExecutionCommand>("executionCommands", id); }
  putExecutionCommand(item: ExecutionCommand) { this.putJson("executionCommands", item.id, item); }
  listProposals() { return this.listJson<MemberProposal>("proposals"); }
  getProposal(id: string) { return this.getJson<MemberProposal>("proposals", id); }
  putProposal(item: MemberProposal) { this.putJson("proposals", item.id, item); }
  listConsensusRevisions() { return this.listJson<ConsensusRevision>("consensus"); }
  getConsensusRevision(id: string) { return this.getJson<ConsensusRevision>("consensus", id); }
  putConsensusRevision(item: ConsensusRevision) { this.putJson("consensus", item.id, item); }
  listDelegationPolicies() { return this.listJson<DelegationPolicy>("policies"); }
  getDelegationPolicy(id: string) { return this.getJson<DelegationPolicy>("policies", id); }
  putDelegationPolicy(item: DelegationPolicy) { this.putJson("policies", item.id, item); }
  listDecisionRecords() { return this.listJson<DecisionRecord>("decisions"); }
  putDecisionRecord(item: DecisionRecord) { this.putJson("decisions", item.id, item); }
  listModules() { return this.listJson<Module>("modules"); }
  getModule(id: string) { return this.getJson<Module>("modules", id); }
  putModule(item: Module) { this.putJson("modules", item.id, item); }
  listWorkUnits() { return this.listJson<WorkUnit>("workUnits"); }
  getWorkUnit(id: string) { return this.getJson<WorkUnit>("workUnits", id); }
  putWorkUnit(item: WorkUnit) { this.putJson("workUnits", item.id, item); }
  listPlanReviews() { return this.listJson<PlanReview>("planReviews"); }
  getPlanReview(id: string) { return this.getJson<PlanReview>("planReviews", id); }
  putPlanReview(item: PlanReview) { this.putJson("planReviews", item.id, item); }
  listIdeaReviews() { return this.listJson<IdeaReview>("ideaReviews"); }
  getIdeaReview(id: string) { return this.getJson<IdeaReview>("ideaReviews", id); }
  putIdeaReview(item: IdeaReview) { this.putJson("ideaReviews", item.id, item); }
  listIssues() { return this.listJson<IssueReport>("issues"); }
  putIssue(item: IssueReport) { this.putJson("issues", item.id, item); }
  listMilestones() { return this.listJson<Milestone>("milestones"); }
  getMilestone(id: string) { return this.getJson<Milestone>("milestones", id); }
  putMilestone(item: Milestone) { this.putJson("milestones", item.id, item); }
  listFreezePolicies() { return this.listJson<FreezePolicy>("freezePolicies"); }
  getFreezePolicy(id: string) { return this.getJson<FreezePolicy>("freezePolicies", id); }
  putFreezePolicy(item: FreezePolicy) { this.putJson("freezePolicies", item.id, item); }
  listFreezeExceptions() { return this.listJson<FreezeException>("freezeExceptions"); }
  getFreezeException(id: string) { return this.getJson<FreezeException>("freezeExceptions", id); }
  putFreezeException(item: FreezeException) { this.putJson("freezeExceptions", item.id, item); }
  listExecutionDecisions() { return this.listJson<ExecutionDecision>("executionDecisions"); }
  getExecutionDecision(id: string) { return this.getJson<ExecutionDecision>("executionDecisions", id); }
  putExecutionDecision(item: ExecutionDecision) { this.putJson("executionDecisions", item.id, item); }
  listEvidenceBundles() { return this.listJson<EvidenceBundle>("evidenceBundles"); }
  getEvidenceBundle(id: string) { return this.getJson<EvidenceBundle>("evidenceBundles", id); }
  putEvidenceBundle(item: EvidenceBundle) { this.putJson("evidenceBundles", item.id, item); }
  listAcceptanceRecords() { return this.listJson<AcceptanceRecord>("acceptanceRecords"); }
  putAcceptanceRecord(item: AcceptanceRecord) { this.putJson("acceptanceRecords", item.id, item); }

  putLease(item: ExecutionLease): void {
    this.db.prepare("INSERT INTO execution_leases (id, idempotency_key, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(item.id, item.idempotencyKey, JSON.stringify(item));
  }

  getLeaseByKey(key: string): ExecutionLease | undefined {
    const row = this.db.prepare("SELECT data FROM execution_leases WHERE idempotency_key = ?").get(key) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as ExecutionLease : undefined;
  }

  requirementRevision(): number {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'requirement_revision'").get() as { value: string };
    return Number(row.value);
  }

  setRequirementRevision(revision: number) {
    this.db.prepare("UPDATE meta SET value = ? WHERE key = 'requirement_revision'").run(String(revision));
  }

  lastSeq(): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events").get() as { seq: number };
    return Number(row.seq);
  }

  appendEvent(input: Omit<RoomEvent, "seq" | "createdAt">): RoomEvent {
    const createdAt = new Date().toISOString();
    const result = this.db.prepare("INSERT INTO events (type, actor_id, source, entity_type, entity_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(input.type, input.actorId, input.source, input.entityType, input.entityId, JSON.stringify(input.payload), createdAt);
    return { ...input, seq: Number(result.lastInsertRowid), createdAt };
  }

  eventsSince(since = 0, limit = 100): RoomEvent[] {
    const rows = this.db.prepare("SELECT * FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?").all(since, limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      seq: Number(row.seq), type: String(row.type), actorId: String(row.actor_id) as RoomEvent["actorId"],
      source: String(row.source) as SubmissionSource, entityType: String(row.entity_type), entityId: String(row.entity_id),
      payload: JSON.parse(String(row.payload)) as unknown, createdAt: String(row.created_at)
    }));
  }

  getIdempotent<T>(requestId: string, operation: string): T | undefined {
    const row = this.db.prepare("SELECT operation, response FROM idempotency WHERE request_id = ?").get(requestId) as { operation: string; response: string } | undefined;
    if (!row) return undefined;
    if (row.operation !== operation) throw new IdempotencyConflictError();
    return JSON.parse(row.response) as T;
  }

  saveIdempotent(requestId: string, operation: string, response: unknown): void {
    this.db.prepare("INSERT INTO idempotency (request_id, operation, response, created_at) VALUES (?, ?, ?, ?)")
      .run(requestId, operation, JSON.stringify(response), new Date().toISOString());
  }
}
