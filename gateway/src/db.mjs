import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { decryptSecret, encryptSecret } from "./secrets.mjs";
import { DEFAULT_EXCHANGE_RATES } from "./exchange-rates.mjs";

const FIELD_TO_COLUMN = {
  name: "name",
  provider: "provider",
  plan: "plan",
  price: "price",
  currency: "currency",
  billingCycle: "billing_cycle",
  renewalDate: "renewal_date",
  channel: "channel",
  loginDevice: "login_device",
  tags: "tags_json",
  autoRenew: "auto_renew",
  invoiceStatus: "invoice_status",
  invoiceNumber: "invoice_number",
  invoiceUrl: "invoice_url",
  reminderDays: "reminder_days",
  notes: "notes",
};

function nowIso() {
  return new Date().toISOString();
}

const DEFAULT_TAGS = [
  { id: "tag_primary", name: "主力", bg: "#daf7e8", color: "#17734b", sortOrder: 0 },
  { id: "tag_regular", name: "常用", bg: "#e7efff", color: "#315da8", sortOrder: 1 },
  { id: "tag_retired", name: "弃用", bg: "#f0f1f2", color: "#6e7479", sortOrder: 2 },
];

function encodeValue(field, value) {
  if (field === "tags") return JSON.stringify(value || []);
  if (field === "autoRenew") return value ? 1 : 0;
  return value;
}

function subscriptionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    plan: row.plan,
    price: row.price,
    currency: row.currency,
    billingCycle: row.billing_cycle,
    renewalDate: row.renewal_date,
    channel: row.channel,
    loginDevice: row.login_device,
    tags: JSON.parse(row.tags_json || "[]"),
    autoRenew: Boolean(row.auto_renew),
    invoiceStatus: row.invoice_status,
    invoiceNumber: row.invoice_number,
    invoiceUrl: row.invoice_url,
    reminderDays: row.reminder_days,
    notes: row.notes,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ApiHubDatabase {
  constructor(filename, { secretsMasterKey = null } = {}) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.secretsMasterKey = secretsMasterKey;
    this.initialize();
  }

  initialize() {
    const statements = [
      `CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT,
        plan TEXT,
        price REAL NOT NULL DEFAULT 0 CHECK(price >= 0),
        currency TEXT NOT NULL DEFAULT 'CNY' CHECK(currency IN ('CNY','USD','EUR')),
        billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK(billing_cycle IN ('monthly','yearly')),
        renewal_date TEXT,
        channel TEXT,
        login_device TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        auto_renew INTEGER NOT NULL DEFAULT 0 CHECK(auto_renew IN (0,1)),
        invoice_status TEXT NOT NULL DEFAULT 'pending' CHECK(invoice_status IN ('issued','pending','none')),
        invoice_number TEXT,
        invoice_url TEXT,
        reminder_days INTEGER NOT NULL DEFAULT 7 CHECK(reminder_days BETWEEN 0 AND 365),
        notes TEXT,
        archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tag_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        bg TEXT NOT NULL,
        color TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS agent_inbox (
        id TEXT PRIMARY KEY,
        source_message_id TEXT NOT NULL UNIQUE,
        sender_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        message_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        draft_id TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS ingestion_drafts (
        id TEXT PRIMARY KEY,
        inbox_id TEXT NOT NULL UNIQUE REFERENCES agent_inbox(id),
        intent TEXT NOT NULL,
        target_id TEXT,
        target_name TEXT,
        payload_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        approval_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        committed_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target_id TEXT,
        source_message_id TEXT,
        before_json TEXT,
        after_json TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS model_settings (
        id TEXT PRIMARY KEY CHECK(id = 'active'),
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        api_key_ciphertext TEXT NOT NULL,
        api_key_iv TEXT NOT NULL,
        api_key_auth_tag TEXT NOT NULL,
        key_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS exchange_rate_cache (
        id TEXT PRIMARY KEY CHECK(id = 'active'),
        usd_cny REAL NOT NULL CHECK(usd_cny > 0),
        eur_cny REAL NOT NULL CHECK(eur_cny > 0),
        rate_date TEXT NOT NULL,
        source TEXT NOT NULL,
        last_attempt_date TEXT,
        last_attempt_at TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS idx_subscriptions_name ON subscriptions(name)",
      "CREATE INDEX IF NOT EXISTS idx_subscriptions_renewal_active ON subscriptions(renewal_date) WHERE archived = 0",
      "CREATE INDEX IF NOT EXISTS idx_tag_definitions_sort ON tag_definitions(sort_order, name)",
      "CREATE INDEX IF NOT EXISTS idx_agent_inbox_status ON agent_inbox(status, created_at)",
      "CREATE INDEX IF NOT EXISTS idx_ingestion_drafts_status_expires ON ingestion_drafts(status, expires_at)",
      "CREATE INDEX IF NOT EXISTS idx_audit_logs_target_created ON audit_logs(target_id, created_at)",
    ];
    for (const sql of statements) this.db.prepare(sql).run();
    const subscriptionColumns = new Set(this.db.prepare("PRAGMA table_info(subscriptions)").all().map((column) => column.name));
    if (!subscriptionColumns.has("login_device")) this.db.prepare("ALTER TABLE subscriptions ADD COLUMN login_device TEXT").run();
    const renewalCol = this.db.prepare("PRAGMA table_info(subscriptions)").all().find((c) => c.name === "renewal_date");
    if (renewalCol && renewalCol.notnull === 1) {
      this.db.exec("CREATE TABLE IF NOT EXISTS subscriptions_new (id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT, plan TEXT, price REAL NOT NULL DEFAULT 0 CHECK(price >= 0), currency TEXT NOT NULL DEFAULT 'CNY' CHECK(currency IN ('CNY','USD','EUR')), billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK(billing_cycle IN ('monthly','yearly')), renewal_date TEXT, channel TEXT, login_device TEXT, tags_json TEXT NOT NULL DEFAULT '[]', auto_renew INTEGER NOT NULL DEFAULT 0 CHECK(auto_renew IN (0,1)), invoice_status TEXT NOT NULL DEFAULT 'pending' CHECK(invoice_status IN ('issued','pending','none')), invoice_number TEXT, invoice_url TEXT, reminder_days INTEGER NOT NULL DEFAULT 7 CHECK(reminder_days BETWEEN 0 AND 365), notes TEXT, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
      this.db.exec("INSERT INTO subscriptions_new SELECT * FROM subscriptions");
      this.db.exec("DROP TABLE subscriptions");
      this.db.exec("ALTER TABLE subscriptions_new RENAME TO subscriptions");
    }
    this.db.prepare(`INSERT OR IGNORE INTO exchange_rate_cache
      (id, usd_cny, eur_cny, rate_date, source, updated_at) VALUES ('active', ?, ?, ?, ?, ?)`)
      .run(DEFAULT_EXCHANGE_RATES.rates.USD, DEFAULT_EXCHANGE_RATES.rates.EUR,
        DEFAULT_EXCHANGE_RATES.rateDate, DEFAULT_EXCHANGE_RATES.source, nowIso());
    const tagCount = this.db.prepare("SELECT COUNT(*) AS count FROM tag_definitions").get().count;
    if (tagCount === 0) {
      const timestamp = nowIso();
      const insert = this.db.prepare(`INSERT INTO tag_definitions
        (id, name, bg, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const tag of DEFAULT_TAGS) insert.run(tag.id, tag.name, tag.bg, tag.color, tag.sortOrder, timestamp, timestamp);
    }
    this.db.exec("PRAGMA optimize");
  }

  close() {
    this.db.close();
  }

  findInboxBySourceMessageId(sourceMessageId) {
    return this.db.prepare("SELECT * FROM agent_inbox WHERE source_message_id = ?").get(sourceMessageId) || null;
  }

  getInbox(id) {
    return this.db.prepare("SELECT * FROM agent_inbox WHERE id = ?").get(id) || null;
  }

  createInbox({ sourceMessageId, senderId, channel, messageHash, status = "received", errorCode = null }) {
    const id = randomUUID();
    const timestamp = nowIso();
    this.db.prepare(`INSERT INTO agent_inbox
      (id, source_message_id, sender_id, channel, message_hash, status, error_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, sourceMessageId, senderId, channel, messageHash, status, errorCode, timestamp, timestamp);
    return this.db.prepare("SELECT * FROM agent_inbox WHERE id = ?").get(id);
  }

  updateInbox(id, { status, draftId = null, errorCode = null }) {
    this.db.prepare("UPDATE agent_inbox SET status = ?, draft_id = ?, error_code = ?, updated_at = ? WHERE id = ?")
      .run(status, draftId, errorCode, nowIso(), id);
  }

  getDraft(id) {
    const row = this.db.prepare("SELECT * FROM ingestion_drafts WHERE id = ?").get(id);
    if (!row) return null;
    return { ...row, payload: JSON.parse(row.payload_json) };
  }

  getDraftByInboxId(inboxId) {
    const row = this.db.prepare("SELECT * FROM ingestion_drafts WHERE inbox_id = ?").get(inboxId);
    return row ? { ...row, payload: JSON.parse(row.payload_json) } : null;
  }

  createDraft({ id = randomUUID(), inboxId, intent, targetId, targetName, payload, summary, approvalHash, expiresAt }) {
    this.db.prepare(`INSERT INTO ingestion_drafts
      (id, inbox_id, intent, target_id, target_name, payload_json, summary, approval_hash, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_confirmation', ?, ?)`)
      .run(id, inboxId, intent, targetId || null, targetName || null, JSON.stringify(payload), summary, approvalHash, expiresAt, nowIso());
    return this.getDraft(id);
  }

  cancelDraft(id) {
    const result = this.db.prepare("UPDATE ingestion_drafts SET status = 'cancelled' WHERE id = ? AND status = 'pending_confirmation'").run(id);
    return result.changes === 1;
  }

  searchSubscriptions(query, includeArchived = false) {
    const term = `%${String(query || "").trim()}%`;
    const rows = this.db.prepare(`SELECT * FROM subscriptions
      WHERE (name LIKE ? COLLATE NOCASE OR provider LIKE ? COLLATE NOCASE)
      ${includeArchived ? "" : "AND archived = 0"}
      ORDER BY name LIMIT 20`).all(term, term);
    return rows.map(subscriptionFromRow);
  }

  findExactActiveSubscriptions(name) {
    return this.db.prepare("SELECT * FROM subscriptions WHERE name = ? COLLATE NOCASE AND archived = 0 ORDER BY updated_at DESC")
      .all(name).map(subscriptionFromRow);
  }

  getSubscription(id) {
    return subscriptionFromRow(this.db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id));
  }

  listSubscriptions(includeArchived = true) {
    const rows = this.db.prepare(`SELECT * FROM subscriptions ${includeArchived ? "" : "WHERE archived = 0"}
      ORDER BY archived ASC, renewal_date ASC, name ASC`).all();
    return rows.map(subscriptionFromRow);
  }

  listTags() {
    return this.db.prepare(`SELECT id, name, bg, color, sort_order AS sortOrder
      FROM tag_definitions ORDER BY sort_order, name`).all();
  }

  listTagNames() {
    return this.listTags().map((tag) => tag.name);
  }

  getExchangeRates() {
    const row = this.db.prepare("SELECT * FROM exchange_rate_cache WHERE id = 'active'").get();
    return {
      rates: { CNY: 1, USD: row.usd_cny, EUR: row.eur_cny },
      rateDate: row.rate_date,
      source: row.source,
      lastAttemptDate: row.last_attempt_date,
      lastAttemptAt: row.last_attempt_at,
      lastError: row.last_error,
      updatedAt: row.updated_at,
    };
  }

  saveExchangeRates(snapshot, attemptDate) {
    const timestamp = nowIso();
    this.db.prepare(`UPDATE exchange_rate_cache SET usd_cny = ?, eur_cny = ?, rate_date = ?, source = ?,
      last_attempt_date = ?, last_attempt_at = ?, last_error = NULL, updated_at = ? WHERE id = 'active'`)
      .run(snapshot.rates.USD, snapshot.rates.EUR, snapshot.rateDate, snapshot.source,
        attemptDate, timestamp, timestamp);
    return this.getExchangeRates();
  }

  markExchangeRateAttemptFailed(errorCode, attemptDate) {
    const timestamp = nowIso();
    this.db.prepare(`UPDATE exchange_rate_cache SET last_attempt_date = ?, last_attempt_at = ?,
      last_error = ?, updated_at = ? WHERE id = 'active'`)
      .run(attemptDate, timestamp, String(errorCode).slice(0, 120), timestamp);
    return this.getExchangeRates();
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
    const timestamp = nowIso();
    this.db.prepare(`INSERT INTO model_settings
      (id, base_url, model, api_key_ciphertext, api_key_iv, api_key_auth_tag, key_version, created_at, updated_at)
      VALUES ('active', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, model = excluded.model,
        api_key_ciphertext = excluded.api_key_ciphertext, api_key_iv = excluded.api_key_iv,
        api_key_auth_tag = excluded.api_key_auth_tag, key_version = excluded.key_version, updated_at = excluded.updated_at`)
      .run(baseUrl, model, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion,
        existing?.created_at || timestamp, timestamp);
    this.writeAudit({
      actor,
      action: existing ? "update_model_settings" : "create_model_settings",
      before: existing ? { baseUrl: existing.base_url, model: existing.model, keyConfigured: true } : null,
      after: { baseUrl, model, keyConfigured: true, keyReplaced: Boolean(apiKey) },
    });
    return this.getModelSettingsStatus();
  }

  deleteModelSettings(actor = "web:owner") {
    const existing = this.db.prepare("SELECT base_url, model FROM model_settings WHERE id = 'active'").get();
    if (!existing) return false;
    this.db.prepare("DELETE FROM model_settings WHERE id = 'active'").run();
    this.writeAudit({
      actor,
      action: "delete_model_settings",
      before: { baseUrl: existing.base_url, model: existing.model, keyConfigured: true },
      after: { keyConfigured: false },
    });
    return true;
  }

  createSubscription(value, actor = "web:owner", sourceMessageId = null) {
    const id = value.id || randomUUID();
    const timestamp = nowIso();
    this.db.prepare(`INSERT INTO subscriptions
      (id, name, provider, plan, price, currency, billing_cycle, renewal_date, channel, login_device, tags_json, auto_renew,
       invoice_status, invoice_number, invoice_url, reminder_days, notes, archived, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, value.name, value.provider || null, value.plan || null, value.price ?? 0,
        value.currency || "CNY", value.billingCycle || "monthly", value.renewalDate, value.channel || null,
        value.loginDevice || null, JSON.stringify(value.tags || []), value.autoRenew ? 1 : 0, value.invoiceStatus || "pending",
        value.invoiceNumber || null, value.invoiceUrl || null, value.reminderDays ?? 7, value.notes || null,
        value.archived ? 1 : 0, timestamp, timestamp);
    const after = this.getSubscription(id);
    this.writeAudit({ actor, action: "create_subscription", targetId: id, sourceMessageId, after });
    return after;
  }

  updateSubscription(id, value, actor = "web:owner", sourceMessageId = null) {
    const before = this.getSubscription(id);
    if (!before) return null;
    this.db.prepare(`UPDATE subscriptions SET
      name = ?, provider = ?, plan = ?, price = ?, currency = ?, billing_cycle = ?, renewal_date = ?, channel = ?, login_device = ?,
      tags_json = ?, auto_renew = ?, invoice_status = ?, invoice_number = ?, invoice_url = ?, reminder_days = ?,
      notes = ?, archived = ?, updated_at = ? WHERE id = ?`)
      .run(value.name, value.provider || null, value.plan || null, value.price ?? 0,
        value.currency || "CNY", value.billingCycle || "monthly", value.renewalDate, value.channel || null,
        value.loginDevice || null, JSON.stringify(value.tags || []), value.autoRenew ? 1 : 0, value.invoiceStatus || "pending",
        value.invoiceNumber || null, value.invoiceUrl || null, value.reminderDays ?? 7, value.notes || null,
        value.archived ? 1 : 0, nowIso(), id);
    const after = this.getSubscription(id);
    this.writeAudit({ actor, action: "update_subscription", targetId: id, sourceMessageId, before, after });
    return after;
  }

  deleteSubscription(id, actor = "web:owner", sourceMessageId = null) {
    const before = this.getSubscription(id);
    if (!before) return false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM subscriptions WHERE id = ?").run(id);
      this.writeAudit({ actor, action: "delete_subscription", targetId: id, sourceMessageId, before });
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  replaceTags(tags, actor = "web:owner") {
    const previous = this.listTags();
    const nextById = new Map(tags.map((tag) => [tag.id, tag.name]));
    const timestamp = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const subscriptions = this.listSubscriptions(true);
      for (const subscription of subscriptions) {
        const mappedTags = subscription.tags.flatMap((name) => {
          const old = previous.find((tag) => tag.name === name);
          if (!old) return tags.some((tag) => tag.name === name) ? [name] : [];
          const nextName = nextById.get(old.id);
          return nextName ? [nextName] : [];
        });
        this.db.prepare("UPDATE subscriptions SET tags_json = ?, updated_at = ? WHERE id = ?")
          .run(JSON.stringify([...new Set(mappedTags)]), timestamp, subscription.id);
      }
      this.db.prepare("DELETE FROM tag_definitions").run();
      const insert = this.db.prepare(`INSERT INTO tag_definitions
        (id, name, bg, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      tags.forEach((tag, index) => insert.run(tag.id, tag.name, tag.bg, tag.color, index, timestamp, timestamp));
      this.writeAudit({
        actor,
        action: "replace_tags",
        before: previous,
        after: tags.map((tag, index) => ({ ...tag, sortOrder: index })),
      });
      this.db.exec("COMMIT");
      return this.listTags();
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  replaceAllData(subscriptions, tags, actor = "web:owner") {
    const before = { subscriptions: this.listSubscriptions(true), tags: this.listTags() };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM subscriptions").run();
      this.db.prepare("DELETE FROM tag_definitions").run();
      const timestamp = nowIso();
      const insertTag = this.db.prepare(`INSERT INTO tag_definitions
        (id, name, bg, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      tags.forEach((tag, index) => insertTag.run(tag.id, tag.name, tag.bg, tag.color, index, timestamp, timestamp));
      const insertSubscription = this.db.prepare(`INSERT INTO subscriptions
        (id, name, provider, plan, price, currency, billing_cycle, renewal_date, channel, login_device, tags_json, auto_renew,
         invoice_status, invoice_number, invoice_url, reminder_days, notes, archived, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const value of subscriptions) {
        insertSubscription.run(value.id || randomUUID(), value.name, value.provider || null, value.plan || null,
          value.price ?? 0, value.currency || "CNY", value.billingCycle || "monthly", value.renewalDate,
          value.channel || null, value.loginDevice || null, JSON.stringify(value.tags || []), value.autoRenew ? 1 : 0,
          value.invoiceStatus || "pending", value.invoiceNumber || null, value.invoiceUrl || null,
          value.reminderDays ?? 7, value.notes || null, value.archived ? 1 : 0,
          value.createdAt || timestamp, timestamp);
      }
      this.writeAudit({ actor, action: "replace_all_data", before, after: { subscriptionCount: subscriptions.length, tags } });
      this.db.exec("COMMIT");
      return { subscriptions: this.listSubscriptions(true), tags: this.listTags() };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  writeAudit({ actor, action, targetId = null, sourceMessageId = null, before = null, after = null }) {
    this.db.prepare(`INSERT INTO audit_logs
      (id, actor, action, target_id, source_message_id, before_json, after_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), actor, action, targetId, sourceMessageId,
        before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, nowIso());
  }

  listUpcoming(days = 30) {
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    return this.db.prepare(`SELECT * FROM subscriptions
      WHERE archived = 0 AND renewal_date BETWEEN ? AND ?
      ORDER BY renewal_date LIMIT 100`).all(start, end).map(subscriptionFromRow);
  }

  commitDraft(draft, actor, sourceMessageId) {
    if (draft.status !== "pending_confirmation") throw new Error("draft_not_pending");
    if (Date.parse(draft.expires_at) <= Date.now()) throw new Error("draft_expired");

    this.db.exec("BEGIN IMMEDIATE");
    try {
      let targetId = draft.target_id;
      let before = targetId ? this.getSubscription(targetId) : null;
      let after;

      if (draft.intent === "create_subscription") {
        targetId = randomUUID();
        const value = draft.payload.subscription;
        const timestamp = nowIso();
        this.db.prepare(`INSERT INTO subscriptions
          (id, name, provider, plan, price, currency, billing_cycle, renewal_date, channel, login_device, tags_json, auto_renew,
           invoice_status, invoice_number, invoice_url, reminder_days, notes, archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
          .run(targetId, value.name, value.provider || null, value.plan || null, value.price ?? 0,
            value.currency || "CNY", value.billingCycle || "monthly", value.renewalDate || null, value.channel || null,
            value.loginDevice || null, JSON.stringify(value.tags || []), value.autoRenew ? 1 : 0, value.invoiceStatus || "pending",
            value.invoiceNumber || null, value.invoiceUrl || null, value.reminderDays ?? 7, value.notes || null,
            timestamp, timestamp);
      } else if (["update_subscription", "update_invoice"].includes(draft.intent)) {
        if (!targetId || !before) throw new Error("target_not_found");
        const changes = draft.payload.changes;
        const entries = Object.entries(changes).filter(([field]) => FIELD_TO_COLUMN[field]);
        if (!entries.length) throw new Error("no_changes");
        const setters = entries.map(([field]) => `${FIELD_TO_COLUMN[field]} = ?`);
        const values = entries.map(([field, value]) => encodeValue(field, value));
        this.db.prepare(`UPDATE subscriptions SET ${setters.join(", ")}, updated_at = ? WHERE id = ?`)
          .run(...values, nowIso(), targetId);
      } else if (draft.intent === "archive_subscription") {
        if (!targetId || !before) throw new Error("target_not_found");
        this.db.prepare("UPDATE subscriptions SET archived = 1, updated_at = ? WHERE id = ?").run(nowIso(), targetId);
      } else {
        throw new Error("intent_not_committable");
      }

      after = this.getSubscription(targetId);
      const auditId = randomUUID();
      this.db.prepare(`INSERT INTO audit_logs
        (id, actor, action, target_id, source_message_id, before_json, after_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(auditId, actor, draft.intent, targetId, sourceMessageId, before ? JSON.stringify(before) : null, JSON.stringify(after), nowIso());
      this.db.prepare("UPDATE ingestion_drafts SET status = 'committed', committed_at = ? WHERE id = ?")
        .run(nowIso(), draft.id);
      this.db.prepare("UPDATE agent_inbox SET status = 'committed', updated_at = ? WHERE id = ?")
        .run(nowIso(), draft.inbox_id);
      this.db.exec("COMMIT");
      return { subscription: after, auditId };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
