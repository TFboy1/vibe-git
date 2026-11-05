export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS coordination_intents (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS coordination_changes (
  id TEXT PRIMARY KEY, stage_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS coordination_changes_stage_status ON coordination_changes(stage_id, status);
CREATE TABLE IF NOT EXISTS v20_nodes (
  id TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v20_documents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  owner_node_id TEXT NOT NULL,
  entity_id TEXT,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS v20_documents_owner_kind ON v20_documents(owner_node_id, kind, revision DESC);
CREATE TABLE IF NOT EXISTS v20_alignments (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v20_requirement_versions (revision INTEGER PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v20_alignment_draft_versions (alignment_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (alignment_id, revision));
CREATE TABLE IF NOT EXISTS v20_alignment_reads (alignment_id TEXT NOT NULL, node_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (alignment_id, node_id, revision));
CREATE TABLE IF NOT EXISTS v20_workstreams (id TEXT PRIMARY KEY, alignment_id TEXT NOT NULL, stage_id TEXT, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS v20_workstreams_alignment ON v20_workstreams(alignment_id);
CREATE TABLE IF NOT EXISTS v20_interface_contracts (id TEXT PRIMARY KEY, alignment_id TEXT NOT NULL, stage_id TEXT, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS v20_contracts_alignment ON v20_interface_contracts(alignment_id);
CREATE TABLE IF NOT EXISTS v20_stages (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL UNIQUE,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v20_stage_tasks (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL,
  assignee_node_id TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS v20_tasks_stage ON v20_stage_tasks(stage_id);
CREATE INDEX IF NOT EXISTS v20_tasks_assignee ON v20_stage_tasks(assignee_node_id);
CREATE TABLE IF NOT EXISTS v20_pull_requests (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v20_impact_reviews (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v20_agent_jobs (
  id TEXT PRIMARY KEY,
  target_node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS v20_jobs_target_status ON v20_agent_jobs(target_node_id, status, created_at);
CREATE TABLE IF NOT EXISTS v20_notifications (
  id TEXT PRIMARY KEY,
  recipient_node_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS v20_notifications_recipient ON v20_notifications(recipient_node_id, created_at DESC);
CREATE TABLE IF NOT EXISTS v20_browser_tickets (
  token_hash TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS v20_browser_sessions (
  token_hash TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  source TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agile_flows (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS coordination_changes_status ON coordination_changes(status,created_at);
CREATE INDEX IF NOT EXISTS coordination_open_intents ON coordination_intents(id) WHERE json_extract(data,'$.publishedStageId') IS NULL;
CREATE INDEX IF NOT EXISTS v20_workstreams_stage ON v20_workstreams(stage_id);
CREATE INDEX IF NOT EXISTS v20_contracts_stage ON v20_interface_contracts(stage_id);
CREATE INDEX IF NOT EXISTS v20_active_stages ON v20_stages(sequence) WHERE json_extract(data,'$.status') != 'COMPLETED';
CREATE INDEX IF NOT EXISTS v20_active_tasks ON v20_stage_tasks(stage_id,id) WHERE coalesce(json_extract(data, '$.archived'),0) = 0 AND json_extract(data, '$.status') != 'DONE';
CREATE INDEX IF NOT EXISTS v20_open_changes ON v20_pull_requests(created_at) WHERE json_extract(data,'$.status') IN ('QUEUED','IN_REVIEW');
CREATE INDEX IF NOT EXISTS agile_active_flows ON agile_flows(created_at) WHERE json_extract(data, '$.status') NOT IN ('PUBLISHED','CANCELLED','REJECTED');
CREATE INDEX IF NOT EXISTS v20_active_alignments ON v20_alignments(created_at) WHERE json_extract(data,'$.publishedStageId') IS NULL AND json_extract(data,'$.status') NOT IN ('PUBLISHED','CANCELLED');
`;
