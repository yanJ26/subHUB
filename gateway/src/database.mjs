import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { DEFAULT_EXCHANGE_RATES } from "./exchange-rates.mjs";
import { decryptSecret, encryptSecret } from "./secrets.mjs";
import { sha256 } from "./security.mjs";
import { assertExpectedRevision, assertWorkspaceState } from "./validation.mjs";

const migrations = [{
  version: 1,
  sql: `
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, website TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS catalog_items (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', adoption_status TEXT NOT NULL,
      website TEXT, last_reviewed_at TEXT, use_cases_json TEXT NOT NULL DEFAULT '[]', notes TEXT
    );
    CREATE TABLE IF NOT EXISTS catalog_item_roles (
      item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
      role TEXT NOT NULL, PRIMARY KEY (item_id, role)
    );
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      name TEXT NOT NULL, UNIQUE (provider_id, name)
    );
    CREATE TABLE IF NOT EXISTS catalog_item_models (
      item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, model_id)
    );
    CREATE TABLE IF NOT EXISTS entitlements (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
      label TEXT NOT NULL, billing_mode TEXT NOT NULL, amount REAL, currency TEXT NOT NULL,
      billing_cycle TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', starts_at TEXT,
      renews_at TEXT, expires_at TEXT, resets_at TEXT, auto_renew INTEGER NOT NULL DEFAULT 0,
      channel TEXT, reminder_days INTEGER, credential_label TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS tag_definitions (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, background TEXT,
      color TEXT, sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS entitlement_tags (
      entitlement_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
      tag_name TEXT NOT NULL, PRIMARY KEY (entitlement_id, tag_name)
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      entitlement_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
      status TEXT NOT NULL, number TEXT, url TEXT, issued_at TEXT, due_at TEXT,
      amount REAL, currency TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL,
      provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
      item_id TEXT REFERENCES catalog_items(id) ON DELETE SET NULL,
      description TEXT, domain_name TEXT, registrar TEXT, expires_at TEXT,
      auto_renew INTEGER, device_type TEXT, os TEXT, location TEXT, role_note TEXT,
      last_checked_at TEXT, url TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
      version TEXT, model TEXT, runtime TEXT, install_method TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS access_surfaces (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
      name TEXT NOT NULL, kind TEXT NOT NULL, device TEXT,
      asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
      deployment_id TEXT REFERENCES deployments(id) ON DELETE SET NULL,
      account TEXT, status TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS usage_links (
      id TEXT PRIMARY KEY,
      entitlement_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
      consumer_item_id TEXT REFERENCES catalog_items(id) ON DELETE SET NULL,
      access_surface_id TEXT REFERENCES access_surfaces(id) ON DELETE SET NULL,
      asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
      deployment_id TEXT REFERENCES deployments(id) ON DELETE SET NULL,
      label TEXT NOT NULL, allocation_percent REAL
    );
    CREATE TABLE IF NOT EXISTS quota_policies (
      id TEXT PRIMARY KEY,
      entitlement_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
      label TEXT NOT NULL, metric TEXT NOT NULL, window_type TEXT NOT NULL,
      window_hours REAL, limit_value REAL, reset_timezone TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS usage_snapshots (
      id TEXT PRIMARY KEY,
      entitlement_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
      quota_policy_id TEXT REFERENCES quota_policies(id) ON DELETE SET NULL,
      observed_at TEXT NOT NULL, period_start TEXT, period_end TEXT,
      used_value REAL, remaining_value REAL, utilization_percent REAL,
      source_label TEXT NOT NULL, evidence_name TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
      evaluated_at TEXT NOT NULL, utilization TEXT NOT NULL, output_value TEXT NOT NULL,
      quota_pressure TEXT NOT NULL, trend TEXT NOT NULL, recommendation TEXT NOT NULL,
      confidence TEXT NOT NULL, evidence_count INTEGER NOT NULL DEFAULT 0,
      observation_days INTEGER NOT NULL DEFAULT 0, note TEXT
    );
    CREATE TABLE IF NOT EXISTS work_records (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
      title TEXT NOT NULL, occurred_at TEXT NOT NULL, note TEXT, source_label TEXT
    );
    CREATE TABLE IF NOT EXISTS legacy_refs (
      source_system TEXT NOT NULL, entity_type TEXT NOT NULL, source_id TEXT NOT NULL,
      target_type TEXT NOT NULL, target_id TEXT NOT NULL, source_hash TEXT,
      imported_at TEXT NOT NULL, PRIMARY KEY (source_system, entity_type, source_id)
    );
    CREATE TABLE IF NOT EXISTS exchange_rate_cache (
      id TEXT PRIMARY KEY CHECK (id = 'active'), usd_cny REAL NOT NULL, eur_cny REAL NOT NULL,
      rate_date TEXT NOT NULL, source TEXT NOT NULL, last_attempt_date TEXT,
      last_attempt_at TEXT, last_error TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, actor TEXT NOT NULL,
      action TEXT NOT NULL, summary TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entitlements_item ON entitlements(item_id);
    CREATE INDEX IF NOT EXISTS idx_entitlements_lifecycle ON entitlements(renews_at, expires_at, resets_at);
    CREATE INDEX IF NOT EXISTS idx_assets_kind_status ON assets(kind, status);
    CREATE INDEX IF NOT EXISTS idx_deployments_item_asset ON deployments(item_id, asset_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_entitlement_time ON usage_snapshots(entitlement_id, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_evaluations_item_time ON evaluations(item_id, evaluated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_invoices_entitlement_status ON invoices(entitlement_id, status);
  `,
}, {
  version: 2,
  sql: `
    CREATE TABLE IF NOT EXISTS login_attempts (
      client_key TEXT PRIMARY KEY,
      attempt_count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_attempts_reset ON login_attempts(reset_at);
  `,
}, {
  version: 3,
  sql: `
    CREATE TABLE IF NOT EXISTS intake_drafts (
      id TEXT PRIMARY KEY,
      message_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      expected_revision INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      committed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_intake_drafts_status_expires ON intake_drafts(status, expires_at);
  `,
}, {
  version: 4,
  sql: `
    CREATE TABLE IF NOT EXISTS model_settings (
      id TEXT PRIMARY KEY CHECK (id = 'active'),
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key_ciphertext TEXT NOT NULL,
      api_key_iv TEXT NOT NULL,
      api_key_auth_tag TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,
}];

const tableDeleteOrder = [
  "legacy_refs", "work_records", "evaluations", "usage_snapshots", "quota_policies", "usage_links",
  "access_surfaces", "deployments", "assets", "invoices", "entitlement_tags",
  "tag_definitions", "entitlements", "catalog_item_models", "models",
  "catalog_item_roles", "catalog_items", "providers",
];

function optional(value) {
  return value === undefined || value === "" ? null : value;
}

function parseJson(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || "null");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export class SubHubDatabase {
  constructor(dbPath, { secretsMasterKey = null } = {}) {
    if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
    this.secretsMasterKey = secretsMasterKey;
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.applyMigrations();
    this.seedExchangeRates();
  }

  applyMigrations() {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    let version = Number(this.db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get()?.value || 0);
    for (const migration of migrations) {
      if (migration.version <= version) continue;
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(migration.sql);
        this.db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)").run(String(migration.version));
        this.db.exec("COMMIT");
        version = migration.version;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    this.db.prepare("INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('revision', '0')").run();
  }

  seedExchangeRates() {
    this.db.prepare(`INSERT OR IGNORE INTO exchange_rate_cache
      (id, usd_cny, eur_cny, rate_date, source, updated_at)
      VALUES ('active', ?, ?, ?, ?, ?)`)
      .run(DEFAULT_EXCHANGE_RATES.rates.USD, DEFAULT_EXCHANGE_RATES.rates.EUR,
        DEFAULT_EXCHANGE_RATES.rateDate, DEFAULT_EXCHANGE_RATES.source, new Date().toISOString());
  }

  close() { this.db.close(); }
  countCatalogItems() { return Number(this.db.prepare("SELECT COUNT(*) AS count FROM catalog_items").get().count); }
  getRevision() { return Number(this.db.prepare("SELECT value FROM schema_meta WHERE key = 'revision'").get()?.value || 0); }

  incrementRevision() {
    const revision = this.getRevision() + 1;
    this.db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'revision'").run(String(revision));
    return revision;
  }

  assertRevision(expectedRevision) {
    assertExpectedRevision(expectedRevision);
    if (expectedRevision !== this.getRevision()) {
      throw new Error("revision_conflict");
    }
  }

  audit(actor, action, summary) {
    this.db.prepare("INSERT INTO audit_logs (id, occurred_at, actor, action, summary) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), new Date().toISOString(), actor, action, String(summary).slice(0, 1000));
  }

  runMutation({ expectedRevision, actor = "owner", action, summary }, change) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertRevision(expectedRevision);
      const result = change();
      this.incrementRevision();
      this.audit(actor, action, summary);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  replaceWorkspace(input, { actor = "owner", summary = "Replaced workspace", expectedRevision, intakeDraftId } = {}) {
    const state = assertWorkspaceState(input);
    const insertProvider = this.db.prepare("INSERT INTO providers (id, name, website, notes) VALUES (?, ?, ?, ?)");
    const insertItem = this.db.prepare("INSERT INTO catalog_items (id, provider_id, name, description, adoption_status, website, last_reviewed_at, use_cases_json, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertRole = this.db.prepare("INSERT INTO catalog_item_roles (item_id, role) VALUES (?, ?)");
    const insertModel = this.db.prepare("INSERT OR IGNORE INTO models (id, provider_id, name) VALUES (?, ?, ?)");
    const insertItemModel = this.db.prepare("INSERT INTO catalog_item_models (item_id, model_id) VALUES (?, ?)");
    const insertEntitlement = this.db.prepare("INSERT INTO entitlements (id, item_id, label, billing_mode, amount, currency, billing_cycle, status, starts_at, renews_at, expires_at, resets_at, auto_renew, channel, reminder_days, credential_label, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertTagDefinition = this.db.prepare("INSERT INTO tag_definitions (id, name, background, color, sort_order) VALUES (?, ?, ?, ?, ?)");
    const insertEntitlementTag = this.db.prepare("INSERT INTO entitlement_tags (entitlement_id, tag_name) VALUES (?, ?)");
    const insertInvoice = this.db.prepare("INSERT INTO invoices (id, entitlement_id, status, number, url, issued_at, due_at, amount, currency, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertAsset = this.db.prepare("INSERT INTO assets (id, kind, name, status, provider_id, item_id, description, domain_name, registrar, expires_at, auto_renew, device_type, os, location, role_note, last_checked_at, url, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertDeployment = this.db.prepare("INSERT INTO deployments (id, item_id, asset_id, name, role, status, version, model, runtime, install_method, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertSurface = this.db.prepare("INSERT INTO access_surfaces (id, item_id, name, kind, device, asset_id, deployment_id, account, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertUsageLink = this.db.prepare("INSERT INTO usage_links (id, entitlement_id, consumer_item_id, access_surface_id, asset_id, deployment_id, label, allocation_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const insertQuota = this.db.prepare("INSERT INTO quota_policies (id, entitlement_id, label, metric, window_type, window_hours, limit_value, reset_timezone, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertSnapshot = this.db.prepare("INSERT INTO usage_snapshots (id, entitlement_id, quota_policy_id, observed_at, period_start, period_end, used_value, remaining_value, utilization_percent, source_label, evidence_name, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertEvaluation = this.db.prepare("INSERT INTO evaluations (id, item_id, evaluated_at, utilization, output_value, quota_pressure, trend, recommendation, confidence, evidence_count, observation_days, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertWorkRecord = this.db.prepare("INSERT INTO work_records (id, item_id, title, occurred_at, note, source_label) VALUES (?, ?, ?, ?, ?, ?)");
    const insertLegacyRef = this.db.prepare("INSERT INTO legacy_refs (source_system, entity_type, source_id, target_type, target_id, source_hash, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)");

    this.runMutation({ expectedRevision, actor, action: "workspace.replace", summary }, () => {
      for (const table of tableDeleteOrder) this.db.exec(`DELETE FROM ${table}`);
      for (const provider of state.providers) insertProvider.run(provider.id, provider.name, optional(provider.website), optional(provider.notes));
      for (const item of state.catalog) {
        insertItem.run(item.id, item.providerId, item.name, item.description || "", item.adoptionStatus,
          optional(item.website), optional(item.lastReviewedAt), JSON.stringify(item.useCases || []), optional(item.notes));
        for (const role of new Set(item.roles || [])) insertRole.run(item.id, role);
        for (const modelName of new Set(item.models || [])) {
          const modelId = `model_${sha256(`${item.providerId}\u0000${modelName}`).slice(0, 20)}`;
          insertModel.run(modelId, item.providerId, modelName);
          insertItemModel.run(item.id, modelId);
        }
      }
      for (const row of state.entitlements) {
        insertEntitlement.run(row.id, row.itemId, row.label, row.billingMode, row.amount, row.currency,
          row.billingCycle, row.status || "active", optional(row.startsAt), optional(row.renewsAt),
          optional(row.expiresAt), optional(row.resetsAt), row.autoRenew ? 1 : 0, optional(row.channel),
          row.reminderDays ?? null, optional(row.credentialLabel), optional(row.notes));
        for (const tag of new Set(row.tags || [])) insertEntitlementTag.run(row.id, tag);
      }
      for (const row of state.tagDefinitions) insertTagDefinition.run(row.id, row.name, optional(row.background), optional(row.color), row.sortOrder ?? 0);
      for (const row of state.invoices) insertInvoice.run(row.id, row.entitlementId, row.status, optional(row.number), optional(row.url), optional(row.issuedAt), optional(row.dueAt), row.amount ?? null, optional(row.currency), optional(row.notes));
      for (const row of state.assets) insertAsset.run(row.id, row.kind, row.name, row.status || "unknown", optional(row.providerId), optional(row.itemId), optional(row.description), optional(row.domainName), optional(row.registrar), optional(row.expiresAt), row.autoRenew === undefined ? null : row.autoRenew ? 1 : 0, optional(row.deviceType), optional(row.os), optional(row.location), optional(row.roleNote), optional(row.lastCheckedAt), optional(row.url), optional(row.notes));
      for (const row of state.deployments) insertDeployment.run(row.id, row.itemId, row.assetId, row.name, row.role, row.status, optional(row.version), optional(row.model), optional(row.runtime), optional(row.installMethod), optional(row.notes));
      for (const row of state.accessSurfaces) insertSurface.run(row.id, row.itemId, row.name, row.kind, optional(row.device), optional(row.assetId), optional(row.deploymentId), optional(row.account), optional(row.status), optional(row.notes));
      for (const row of state.usageLinks) insertUsageLink.run(row.id, row.entitlementId, optional(row.consumerItemId), optional(row.accessSurfaceId), optional(row.assetId), optional(row.deploymentId), row.label, row.allocationPercent ?? null);
      for (const row of state.quotaPolicies) insertQuota.run(row.id, row.entitlementId, row.label, row.metric, row.windowType, row.windowHours ?? null, row.limitValue ?? null, optional(row.resetTimezone), optional(row.notes));
      for (const row of state.snapshots) insertSnapshot.run(row.id, row.entitlementId, optional(row.quotaPolicyId), row.observedAt, optional(row.periodStart), optional(row.periodEnd), row.usedValue ?? null, row.remainingValue ?? null, row.utilizationPercent ?? null, row.sourceLabel, optional(row.evidenceName), optional(row.notes));
      for (const row of state.evaluations) insertEvaluation.run(row.id, row.itemId, row.evaluatedAt, row.utilization, row.outputValue, row.quotaPressure, row.trend, row.recommendation, row.confidence, row.evidenceCount ?? 0, row.observationDays ?? 0, optional(row.note));
      for (const row of state.workRecords) insertWorkRecord.run(row.id, row.itemId, row.title, row.occurredAt, optional(row.note), optional(row.sourceLabel));
      for (const row of state.legacyRefs) insertLegacyRef.run(row.sourceSystem, row.entityType, row.sourceId, row.targetType, row.targetId, optional(row.sourceHash), row.importedAt || new Date().toISOString());
      if (intakeDraftId) {
        const result = this.db.prepare("UPDATE intake_drafts SET status = 'committed', committed_at = ? WHERE id = ? AND status = 'pending_confirmation'")
          .run(new Date().toISOString(), intakeDraftId);
        if (result.changes !== 1) throw new Error("intake_draft_not_pending");
      }
    });
    return this.getWorkspace();
  }

  getWorkspace() {
    const providers = this.db.prepare("SELECT id, name, website, notes FROM providers ORDER BY name COLLATE NOCASE").all().map((row) => ({
      id: row.id, name: row.name, ...(row.website ? { website: row.website } : {}), ...(row.notes ? { notes: row.notes } : {}),
    }));
    const roles = this.db.prepare("SELECT item_id, role FROM catalog_item_roles ORDER BY role").all();
    const models = this.db.prepare("SELECT cim.item_id, m.name FROM catalog_item_models cim JOIN models m ON m.id = cim.model_id ORDER BY m.name COLLATE NOCASE").all();
    const catalog = this.db.prepare("SELECT * FROM catalog_items ORDER BY name COLLATE NOCASE").all().map((row) => ({
      id: row.id, providerId: row.provider_id, name: row.name, description: row.description,
      roles: roles.filter((entry) => entry.item_id === row.id).map((entry) => entry.role),
      models: models.filter((entry) => entry.item_id === row.id).map((entry) => entry.name),
      adoptionStatus: row.adoption_status, ...(row.website ? { website: row.website } : {}),
      ...(row.last_reviewed_at ? { lastReviewedAt: row.last_reviewed_at } : {}),
      ...(parseJson(row.use_cases_json).length ? { useCases: parseJson(row.use_cases_json) } : {}),
      ...(row.notes ? { notes: row.notes } : {}),
    }));
    const entitlementTags = this.db.prepare("SELECT entitlement_id, tag_name FROM entitlement_tags ORDER BY tag_name COLLATE NOCASE").all();
    const entitlements = this.db.prepare("SELECT * FROM entitlements ORDER BY label COLLATE NOCASE").all().map((row) => ({
      id: row.id, itemId: row.item_id, label: row.label, billingMode: row.billing_mode, amount: row.amount,
      currency: row.currency, billingCycle: row.billing_cycle, status: row.status,
      ...(row.starts_at ? { startsAt: row.starts_at } : {}), ...(row.renews_at ? { renewsAt: row.renews_at } : {}),
      ...(row.expires_at ? { expiresAt: row.expires_at } : {}), ...(row.resets_at ? { resetsAt: row.resets_at } : {}),
      autoRenew: Boolean(row.auto_renew), ...(row.channel ? { channel: row.channel } : {}),
      ...(row.reminder_days !== null ? { reminderDays: row.reminder_days } : {}),
      tags: entitlementTags.filter((entry) => entry.entitlement_id === row.id).map((entry) => entry.tag_name),
      ...(row.credential_label ? { credentialLabel: row.credential_label } : {}), ...(row.notes ? { notes: row.notes } : {}),
    }));
    const tagDefinitions = this.db.prepare("SELECT * FROM tag_definitions ORDER BY sort_order, name COLLATE NOCASE").all().map((row) => ({
      id: row.id, name: row.name, ...(row.background ? { background: row.background } : {}), ...(row.color ? { color: row.color } : {}), sortOrder: row.sort_order,
    }));
    const invoices = this.db.prepare("SELECT * FROM invoices ORDER BY COALESCE(due_at, issued_at, '9999')").all().map((row) => ({
      id: row.id, entitlementId: row.entitlement_id, status: row.status, ...(row.number ? { number: row.number } : {}),
      ...(row.url ? { url: row.url } : {}), ...(row.issued_at ? { issuedAt: row.issued_at } : {}),
      ...(row.due_at ? { dueAt: row.due_at } : {}), ...(row.amount !== null ? { amount: row.amount } : {}),
      ...(row.currency ? { currency: row.currency } : {}), ...(row.notes ? { notes: row.notes } : {}),
    }));
    const assets = this.db.prepare("SELECT * FROM assets ORDER BY kind, name COLLATE NOCASE").all().map((row) => ({
      id: row.id, kind: row.kind, name: row.name, status: row.status,
      ...(row.provider_id ? { providerId: row.provider_id } : {}), ...(row.item_id ? { itemId: row.item_id } : {}),
      ...(row.description ? { description: row.description } : {}), ...(row.domain_name ? { domainName: row.domain_name } : {}),
      ...(row.registrar ? { registrar: row.registrar } : {}), ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
      ...(row.auto_renew !== null ? { autoRenew: Boolean(row.auto_renew) } : {}), ...(row.device_type ? { deviceType: row.device_type } : {}),
      ...(row.os ? { os: row.os } : {}), ...(row.location ? { location: row.location } : {}),
      ...(row.role_note ? { roleNote: row.role_note } : {}), ...(row.last_checked_at ? { lastCheckedAt: row.last_checked_at } : {}),
      ...(row.url ? { url: row.url } : {}), ...(row.notes ? { notes: row.notes } : {}),
    }));
    const deployments = this.db.prepare("SELECT * FROM deployments ORDER BY name COLLATE NOCASE").all().map((row) => ({
      id: row.id, itemId: row.item_id, assetId: row.asset_id, name: row.name, role: row.role, status: row.status,
      ...(row.version ? { version: row.version } : {}), ...(row.model ? { model: row.model } : {}),
      ...(row.runtime ? { runtime: row.runtime } : {}), ...(row.install_method ? { installMethod: row.install_method } : {}),
      ...(row.notes ? { notes: row.notes } : {}),
    }));
    const accessSurfaces = this.db.prepare("SELECT * FROM access_surfaces ORDER BY name COLLATE NOCASE").all().map((row) => ({
      id: row.id, itemId: row.item_id, name: row.name, kind: row.kind, ...(row.device ? { device: row.device } : {}),
      ...(row.asset_id ? { assetId: row.asset_id } : {}), ...(row.deployment_id ? { deploymentId: row.deployment_id } : {}),
      ...(row.account ? { account: row.account } : {}), ...(row.status ? { status: row.status } : {}), ...(row.notes ? { notes: row.notes } : {}),
    }));
    const usageLinks = this.db.prepare("SELECT * FROM usage_links ORDER BY label COLLATE NOCASE").all().map((row) => ({
      id: row.id, entitlementId: row.entitlement_id, ...(row.consumer_item_id ? { consumerItemId: row.consumer_item_id } : {}),
      ...(row.access_surface_id ? { accessSurfaceId: row.access_surface_id } : {}), ...(row.asset_id ? { assetId: row.asset_id } : {}),
      ...(row.deployment_id ? { deploymentId: row.deployment_id } : {}), label: row.label,
      ...(row.allocation_percent !== null ? { allocationPercent: row.allocation_percent } : {}),
    }));
    const quotaPolicies = this.db.prepare("SELECT * FROM quota_policies ORDER BY label COLLATE NOCASE").all().map((row) => ({
      id: row.id, entitlementId: row.entitlement_id, label: row.label, metric: row.metric, windowType: row.window_type,
      ...(row.window_hours !== null ? { windowHours: row.window_hours } : {}), ...(row.limit_value !== null ? { limitValue: row.limit_value } : {}),
      ...(row.reset_timezone ? { resetTimezone: row.reset_timezone } : {}), ...(row.notes ? { notes: row.notes } : {}),
    }));
    const snapshots = this.db.prepare("SELECT * FROM usage_snapshots ORDER BY observed_at DESC").all().map((row) => ({
      id: row.id, entitlementId: row.entitlement_id, ...(row.quota_policy_id ? { quotaPolicyId: row.quota_policy_id } : {}), observedAt: row.observed_at,
      ...(row.period_start ? { periodStart: row.period_start } : {}), ...(row.period_end ? { periodEnd: row.period_end } : {}),
      ...(row.used_value !== null ? { usedValue: row.used_value } : {}), ...(row.remaining_value !== null ? { remainingValue: row.remaining_value } : {}),
      ...(row.utilization_percent !== null ? { utilizationPercent: row.utilization_percent } : {}), sourceLabel: row.source_label,
      ...(row.evidence_name ? { evidenceName: row.evidence_name } : {}), ...(row.notes ? { notes: row.notes } : {}),
    }));
    const evaluations = this.db.prepare("SELECT * FROM evaluations ORDER BY evaluated_at DESC").all().map((row) => ({
      id: row.id, itemId: row.item_id, evaluatedAt: row.evaluated_at, utilization: row.utilization,
      outputValue: row.output_value, quotaPressure: row.quota_pressure, trend: row.trend,
      recommendation: row.recommendation, confidence: row.confidence, evidenceCount: row.evidence_count,
      observationDays: row.observation_days, ...(row.note ? { note: row.note } : {}),
    }));
    const workRecords = this.db.prepare("SELECT * FROM work_records ORDER BY occurred_at DESC").all().map((row) => ({
      id: row.id, itemId: row.item_id, title: row.title, occurredAt: row.occurred_at,
      ...(row.note ? { note: row.note } : {}), ...(row.source_label ? { sourceLabel: row.source_label } : {}),
    }));
    const legacyRefs = this.db.prepare("SELECT * FROM legacy_refs ORDER BY source_system, entity_type, source_id").all().map((row) => ({
      sourceSystem: row.source_system, entityType: row.entity_type, sourceId: row.source_id,
      targetType: row.target_type, targetId: row.target_id,
      ...(row.source_hash ? { sourceHash: row.source_hash } : {}), importedAt: row.imported_at,
    }));
    return { providers, catalog, entitlements, invoices, tagDefinitions, assets, deployments, accessSurfaces, usageLinks, quotaPolicies, snapshots, evaluations, workRecords, legacyRefs };
  }

  getState() { return { workspace: this.getWorkspace(), revision: this.getRevision(), exchangeRates: this.getExchangeRates() }; }

  updateAdoptionStatus(itemId, adoptionStatus, expectedRevision) {
    this.runMutation({ expectedRevision, action: "catalog.status", summary: `${itemId} -> ${adoptionStatus}` }, () => {
      const result = this.db.prepare("UPDATE catalog_items SET adoption_status = ?, last_reviewed_at = ? WHERE id = ?")
        .run(adoptionStatus, new Date().toISOString().slice(0, 10), itemId);
      if (!result.changes) throw new Error("catalog_item_not_found");
    });
    return this.db.prepare("SELECT id, adoption_status, last_reviewed_at FROM catalog_items WHERE id = ?").get(itemId);
  }

  addSnapshot(snapshot, expectedRevision) {
    const row = { id: snapshot.id || randomUUID(), ...snapshot };
    this.runMutation({ expectedRevision, action: "snapshot.create", summary: `${row.entitlementId} @ ${row.observedAt}` }, () => {
      this.db.prepare("INSERT INTO usage_snapshots (id, entitlement_id, quota_policy_id, observed_at, period_start, period_end, used_value, remaining_value, utilization_percent, source_label, evidence_name, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(row.id, row.entitlementId, optional(row.quotaPolicyId), row.observedAt, optional(row.periodStart), optional(row.periodEnd), row.usedValue ?? null, row.remainingValue ?? null, row.utilizationPercent ?? null, row.sourceLabel, optional(row.evidenceName), optional(row.notes));
    });
    return row;
  }

  addEvaluation(evaluation, expectedRevision) {
    const row = { id: evaluation.id || randomUUID(), evidenceCount: 0, observationDays: 0, ...evaluation };
    this.runMutation({ expectedRevision, action: "evaluation.create", summary: `${row.itemId} -> ${row.recommendation}` }, () => {
      this.db.prepare("INSERT INTO evaluations (id, item_id, evaluated_at, utilization, output_value, quota_pressure, trend, recommendation, confidence, evidence_count, observation_days, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(row.id, row.itemId, row.evaluatedAt, row.utilization, row.outputValue, row.quotaPressure, row.trend, row.recommendation, row.confidence, row.evidenceCount, row.observationDays, optional(row.note));
    });
    return row;
  }

  reserveLoginAttempt(clientKey, { now = Date.now(), windowMs = 15 * 60_000, maxAttempts = 10 } = {}) {
    const key = sha256(String(clientKey)).slice(0, 40);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM login_attempts WHERE reset_at <= ?").run(now);
      const current = this.db.prepare("SELECT attempt_count, reset_at FROM login_attempts WHERE client_key = ?").get(key);
      if (current && current.attempt_count >= maxAttempts) {
        this.db.exec("COMMIT");
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.reset_at - now) / 1000)) };
      }
      const count = Number(current?.attempt_count || 0) + 1;
      const resetAt = Number(current?.reset_at || now + windowMs);
      this.db.prepare(`INSERT INTO login_attempts (client_key, attempt_count, reset_at, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(client_key) DO UPDATE SET attempt_count = excluded.attempt_count, reset_at = excluded.reset_at, updated_at = excluded.updated_at`)
        .run(key, count, resetAt, new Date(now).toISOString());
      this.db.exec("COMMIT");
      return { allowed: true, retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  clearLoginAttempts(clientKey) {
    const key = sha256(String(clientKey)).slice(0, 40);
    this.db.prepare("DELETE FROM login_attempts WHERE client_key = ?").run(key);
  }

  getAuditLogs(limit = 100) {
    return this.db.prepare("SELECT id, occurred_at, actor, action, summary FROM audit_logs ORDER BY occurred_at DESC LIMIT ?")
      .all(Math.min(500, Math.max(1, Number(limit) || 100)))
      .map((row) => ({ id: row.id, occurredAt: row.occurred_at, actor: row.actor, action: row.action, summary: row.summary }));
  }

  createIntakeDraft({ messageHash, payload, summary, expectedRevision, expiresAt }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare("UPDATE intake_drafts SET status = 'expired' WHERE status = 'pending_confirmation' AND expires_at <= ?").run(now);
    this.db.prepare(`INSERT INTO intake_drafts
      (id, message_hash, payload_json, summary, status, expected_revision, expires_at, created_at)
      VALUES (?, ?, ?, ?, 'pending_confirmation', ?, ?, ?)`)
      .run(id, messageHash, JSON.stringify(payload), summary, expectedRevision, expiresAt, now);
    return this.getIntakeDraft(id);
  }

  getIntakeDraft(id) {
    const row = this.db.prepare("SELECT * FROM intake_drafts WHERE id = ?").get(id);
    return row ? {
      id: row.id, messageHash: row.message_hash, payload: parseJson(row.payload_json, {}), summary: row.summary,
      status: row.status, expectedRevision: row.expected_revision, expiresAt: row.expires_at,
      createdAt: row.created_at, committedAt: row.committed_at,
    } : null;
  }

  cancelIntakeDraft(id) {
    return this.db.prepare("UPDATE intake_drafts SET status = 'cancelled' WHERE id = ? AND status = 'pending_confirmation'").run(id).changes === 1;
  }

  getModelSettingsStatus(fallback = {}) {
    const row = this.db.prepare("SELECT base_url, model, created_at, updated_at FROM model_settings WHERE id = 'active'").get();
    if (row) {
      return {
        configured: true,
        source: "byok",
        baseUrl: row.base_url,
        model: row.model,
        keyConfigured: true,
        storageAvailable: Boolean(this.secretsMasterKey),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }
    const fallbackConfigured = Boolean(fallback.modelApiKey && fallback.model);
    return {
      configured: fallbackConfigured,
      source: fallbackConfigured ? "environment" : "unconfigured",
      baseUrl: fallback.modelBaseUrl || "https://api.openai.com/v1",
      model: fallback.model || "",
      keyConfigured: Boolean(fallback.modelApiKey),
      storageAvailable: Boolean(this.secretsMasterKey),
      createdAt: null,
      updatedAt: null,
    };
  }

  getEffectiveModelConfig(fallback = {}) {
    const row = this.db.prepare("SELECT * FROM model_settings WHERE id = 'active'").get();
    if (!row) return fallback;
    const modelApiKey = decryptSecret({
      ciphertext: row.api_key_ciphertext,
      iv: row.api_key_iv,
      authTag: row.api_key_auth_tag,
    }, this.secretsMasterKey);
    return { ...fallback, modelBaseUrl: row.base_url, model: row.model, modelApiKey };
  }

  saveModelSettings({ baseUrl, model, apiKey }, actor = "web:owner") {
    if (!this.secretsMasterKey) throw new Error("secrets_master_key_unavailable");
    const existing = this.db.prepare("SELECT * FROM model_settings WHERE id = 'active'").get();
    if (!existing && !apiKey) throw new Error("api_key_required");
    const encrypted = apiKey ? encryptSecret(apiKey, this.secretsMasterKey) : {
      ciphertext: existing.api_key_ciphertext,
      iv: existing.api_key_iv,
      authTag: existing.api_key_auth_tag,
      keyVersion: existing.key_version,
    };
    const timestamp = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`INSERT INTO model_settings
        (id, base_url, model, api_key_ciphertext, api_key_iv, api_key_auth_tag, key_version, created_at, updated_at)
        VALUES ('active', ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, model = excluded.model,
          api_key_ciphertext = excluded.api_key_ciphertext, api_key_iv = excluded.api_key_iv,
          api_key_auth_tag = excluded.api_key_auth_tag, key_version = excluded.key_version, updated_at = excluded.updated_at`)
        .run(baseUrl, model, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion,
          existing?.created_at || timestamp, timestamp);
      this.audit(actor, existing ? "model_settings.update" : "model_settings.create",
        `${model} at ${baseUrl}; key ${apiKey ? "replaced" : "retained"}`);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getModelSettingsStatus();
  }

  deleteModelSettings(actor = "web:owner") {
    const existing = this.db.prepare("SELECT base_url, model FROM model_settings WHERE id = 'active'").get();
    if (!existing) return false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM model_settings WHERE id = 'active'").run();
      this.audit(actor, "model_settings.delete", `${existing.model} at ${existing.base_url}; encrypted key removed`);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return true;
  }

  getExchangeRates() {
    const row = this.db.prepare("SELECT * FROM exchange_rate_cache WHERE id = 'active'").get();
    return { rates: { CNY: 1, USD: row.usd_cny, EUR: row.eur_cny }, rateDate: row.rate_date,
      source: row.source, lastAttemptDate: row.last_attempt_date, lastAttemptAt: row.last_attempt_at,
      lastError: row.last_error, updatedAt: row.updated_at };
  }

  saveExchangeRates(snapshot, attemptDate) {
    const timestamp = new Date().toISOString();
    this.db.prepare(`UPDATE exchange_rate_cache SET usd_cny = ?, eur_cny = ?, rate_date = ?, source = ?,
      last_attempt_date = ?, last_attempt_at = ?, last_error = NULL, updated_at = ? WHERE id = 'active'`)
      .run(snapshot.rates.USD, snapshot.rates.EUR, snapshot.rateDate, snapshot.source, attemptDate, timestamp, timestamp);
    return this.getExchangeRates();
  }

  markExchangeRateAttemptFailed(errorCode, attemptDate) {
    const timestamp = new Date().toISOString();
    this.db.prepare("UPDATE exchange_rate_cache SET last_attempt_date = ?, last_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = 'active'")
      .run(attemptDate, timestamp, String(errorCode).slice(0, 120), timestamp);
    return this.getExchangeRates();
  }

}
