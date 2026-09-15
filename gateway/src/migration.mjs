import { sha256 } from "./security.mjs";

function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function identifier(prefix, ...parts) {
  return `${prefix}_${sha256(parts.map((part) => text(String(part)).toLocaleLowerCase()).join("\u0000")).slice(0, 16)}`;
}

function adoptionFromAgent(status) {
  return ({ primary: "active", active: "active", testing: "trial", standby: "paused", retired: "retired" })[status] || "considering";
}

function billingMode(value) {
  return ({ usage: "pay_as_you_go", subscription: "subscription", self_hosted: "self_hosted", hybrid: "hybrid", free: "free", unknown: "free" })[value] || "free";
}

function accessKind(value) {
  return ({ native: "mobile", message: "message", web: "web", desktop: "desktop", cli: "cli", remote: "workflow", api: "api", bot: "bot" })[value] || "web";
}

function providerKey(name) {
  return text(name, "未知厂商").toLocaleLowerCase();
}

function itemKey(provider, name) {
  return `${providerKey(provider)}\u0000${text(name).toLocaleLowerCase()}`;
}

function blankWorkspace() {
  return {
    providers: [], catalog: [], entitlements: [], invoices: [], tagDefinitions: [], assets: [],
    deployments: [], accessSurfaces: [], usageLinks: [], quotaPolicies: [], snapshots: [],
    evaluations: [], workRecords: [], legacyRefs: [],
  };
}

function apiRoles(subscription) {
  const haystack = [subscription.name, subscription.provider, subscription.plan, subscription.notes].map((value) => text(value).toLocaleLowerCase()).join(" ");
  const roles = new Set(["api"]);
  if (/模型|model|gpt|claude|gemini|glm|minimax|kimi/.test(haystack)) roles.add("model");
  if (/agent|codex|code|workbuddy/.test(haystack)) roles.add("agent");
  roles.add("platform");
  return [...roles];
}

function normalizeTagDefinition(tag, index) {
  const name = text(tag?.name || tag);
  if (!name) return null;
  return {
    id: text(tag?.id, identifier("tag", name)), name,
    ...(text(tag?.bg || tag?.background) ? { background: text(tag.bg || tag.background) } : {}),
    ...(text(tag?.color) ? { color: text(tag.color) } : {}), sortOrder: Number.isInteger(tag?.sortOrder) ? tag.sortOrder : index,
  };
}

export function previewLegacyMigration({ apiHub, agentHub, buddyHub } = {}) {
  const workspace = blankWorkspace();
  const warnings = [];
  const conflicts = [];
  const providerByKey = new Map();
  const itemByKey = new Map();
  const entitlementByItem = new Map();
  const itemBySourceId = new Map();
  const assetBySourceId = new Map();
  const deploymentBySourceId = new Map();
  const importedAt = new Date().toISOString();

  function addRef(sourceSystem, entityType, sourceId, targetType, targetId, value) {
    if (!sourceId) return;
    workspace.legacyRefs.push({
      sourceSystem, entityType, sourceId: String(sourceId), targetType, targetId,
      sourceHash: sha256(JSON.stringify(value ?? null)), importedAt,
    });
  }

  function ensureProvider(name, sourceSystem, sourceId, raw) {
    const label = text(name, "未知厂商");
    const key = providerKey(label);
    if (!providerByKey.has(key)) {
      const provider = { id: identifier("provider", label), name: label };
      providerByKey.set(key, provider);
      workspace.providers.push(provider);
    }
    const provider = providerByKey.get(key);
    addRef(sourceSystem, "provider", sourceId, "provider", provider.id, raw);
    return provider;
  }

  function ensureItem({ providerName, name, description = "", roles, adoptionStatus, website, useCases, notes, sourceSystem, sourceId, raw }) {
    const provider = ensureProvider(providerName || name, sourceSystem, `${sourceId || name}:provider`, raw);
    const key = itemKey(provider.name, name);
    let item = itemByKey.get(key);
    if (item) {
      item.roles = [...new Set([...item.roles, ...roles])];
      item.models = [...new Set([...(item.models || []), ...((raw?.models || []).filter((entry) => typeof entry === "string"))])];
      item.description ||= description;
      item.website ||= website;
      item.useCases = [...new Set([...(item.useCases || []), ...(useCases || [])])];
      item.notes ||= notes;
      if (item.adoptionStatus === "unused" && adoptionStatus !== "unused") item.adoptionStatus = adoptionStatus;
      warnings.push({ code: "catalog_item_merged", message: `${provider.name} / ${name} 来自多个旧项目，已合并角色并保留来源。`, itemId: item.id });
    } else {
      item = {
        id: identifier("item", provider.name, name), providerId: provider.id, name,
        description, roles: [...new Set(roles)], models: [...new Set(raw?.models || [])].filter((entry) => typeof entry === "string"),
        adoptionStatus, ...(website ? { website } : {}), ...(useCases?.length ? { useCases } : {}),
        ...(notes ? { notes } : {}), lastReviewedAt: new Date().toISOString().slice(0, 10),
      };
      itemByKey.set(key, item);
      workspace.catalog.push(item);
    }
    if (sourceId) itemBySourceId.set(`${sourceSystem}:${sourceId}`, item);
    addRef(sourceSystem, "catalog_item", sourceId, "catalog_item", item.id, raw);
    return item;
  }

  function addEntitlement(item, entitlement, sourceSystem, sourceId, raw, { preferExisting = false } = {}) {
    const existing = entitlementByItem.get(item.id);
    if (existing && preferExisting) {
      const hasCommercialDetails = entitlement.billingMode !== "free" || entitlement.amount !== null || entitlement.label;
      if (hasCommercialDetails) conflicts.push({
        code: "duplicate_entitlement", severity: "blocking", itemId: item.id,
        message: `${item.name} 在多个旧项目中都有费用信息；已暂时保留 apiHUB 权益，提交前需人工选择。`,
        sources: [existing._source || "unknown", sourceSystem],
      });
      addRef(sourceSystem, "entitlement", sourceId, "entitlement", existing.id, raw);
      return existing;
    }
    const row = { ...entitlement, _source: sourceSystem };
    workspace.entitlements.push(row);
    if (!existing) entitlementByItem.set(item.id, row);
    addRef(sourceSystem, "entitlement", sourceId, "entitlement", row.id, raw);
    return row;
  }

  if (apiHub !== undefined) {
    if (!apiHub || !Array.isArray(apiHub.subscriptions)) throw new Error("invalid_apihub_export");
    (Array.isArray(apiHub.tags) ? apiHub.tags : []).map(normalizeTagDefinition).filter(Boolean).forEach((tag) => {
      if (!workspace.tagDefinitions.some((entry) => entry.name.toLocaleLowerCase() === tag.name.toLocaleLowerCase())) workspace.tagDefinitions.push(tag);
    });
    for (const subscription of apiHub.subscriptions) {
      const name = text(subscription.name, "未命名订阅");
      const item = ensureItem({
        providerName: text(subscription.provider, name), name,
        description: text(subscription.notes, `${name} 的数字服务或 API 权益`),
        roles: apiRoles(subscription), adoptionStatus: subscription.archived ? "retired" : "active",
        sourceSystem: "apiHUB", sourceId: subscription.id || name, raw: subscription,
      });
      const entitlement = addEntitlement(item, {
        id: identifier("ent", "apihub", subscription.id || name), itemId: item.id,
        label: text(subscription.plan, name), billingMode: "subscription",
        amount: Number.isFinite(subscription.price) ? subscription.price : null,
        currency: ["CNY", "USD", "EUR", "HKD", "GBP", "JPY"].includes(subscription.currency) ? subscription.currency : "CNY",
        billingCycle: subscription.billingCycle === "yearly" ? "yearly" : "monthly",
        status: subscription.archived ? "cancelled" : "active",
        ...(text(subscription.renewalDate) ? { renewsAt: text(subscription.renewalDate) } : {}),
        autoRenew: Boolean(subscription.autoRenew), ...(text(subscription.channel) ? { channel: text(subscription.channel) } : {}),
        ...(Number.isFinite(subscription.reminderDays) ? { reminderDays: subscription.reminderDays } : {}),
        tags: Array.isArray(subscription.tags) ? subscription.tags.map((tag) => text(tag)).filter(Boolean) : [],
        ...(text(subscription.notes) ? { notes: text(subscription.notes) } : {}),
      }, "apiHUB", subscription.id || name, subscription);
      if (subscription.invoiceStatus || subscription.invoiceNumber || subscription.invoiceUrl) {
        const invoice = {
          id: identifier("invoice", "apihub", subscription.id || name), entitlementId: entitlement.id,
          status: ["issued", "pending", "none", "paid", "reimbursed"].includes(subscription.invoiceStatus) ? subscription.invoiceStatus : "pending",
          ...(text(subscription.invoiceNumber) ? { number: text(subscription.invoiceNumber) } : {}),
          ...(text(subscription.invoiceUrl) ? { url: text(subscription.invoiceUrl) } : {}),
        };
        workspace.invoices.push(invoice);
        addRef("apiHUB", "invoice", subscription.id || name, "invoice", invoice.id, subscription);
      }
      if (text(subscription.loginDevice)) {
        const asset = {
          id: identifier("asset", "apihub-device", subscription.loginDevice), kind: "device",
          name: text(subscription.loginDevice), status: "unknown", deviceType: "unknown",
        };
        if (!workspace.assets.some((entry) => entry.id === asset.id)) workspace.assets.push(asset);
        const surface = { id: identifier("surface", "apihub", subscription.id || name), itemId: item.id, name: text(subscription.loginDevice), kind: "desktop", assetId: asset.id, device: asset.name };
        workspace.accessSurfaces.push(surface);
        workspace.usageLinks.push({ id: identifier("link", entitlement.id, surface.id), entitlementId: entitlement.id, accessSurfaceId: surface.id, assetId: asset.id, label: `通过 ${surface.name} 使用` });
      }
    }
  }

  if (agentHub !== undefined) {
    if (!agentHub || !Array.isArray(agentHub.agents) || !Array.isArray(agentHub.devices) || !Array.isArray(agentHub.deployments) || !Array.isArray(agentHub.accessRoutes)) {
      throw new Error("invalid_agenthub_export");
    }
    for (const device of agentHub.devices) {
      const asset = {
        id: identifier("asset", "agenthub", device.id || device.name),
        kind: ["vps", "nas", "cloud"].includes(device.type) ? "server" : "device",
        name: text(device.name, "未命名设备"),
        status: ({ online: "active", attention: "attention", offline: "offline", unknown: "unknown" })[device.status] || "unknown",
        ...(text(device.type) ? { deviceType: text(device.type) } : {}), ...(text(device.os) ? { os: text(device.os) } : {}),
        ...(text(device.location) ? { location: text(device.location) } : {}), ...(text(device.roleNote) ? { roleNote: text(device.roleNote) } : {}),
        ...(text(device.lastChecked) ? { lastCheckedAt: text(device.lastChecked) } : {}), ...(text(device.notes) ? { notes: text(device.notes) } : {}),
      };
      workspace.assets.push(asset);
      assetBySourceId.set(`agentHUB:${device.id}`, asset);
      addRef("agentHUB", "device", device.id || device.name, "asset", asset.id, device);
    }
    for (const agent of agentHub.agents) {
      const name = text(agent.name, "未命名 Agent");
      const item = ensureItem({
        providerName: text(agent.provider, name), name, description: text(agent.description, `${name} Agent`),
        roles: ["agent", "app"], adoptionStatus: adoptionFromAgent(agent.status), website: text(agent.website),
        useCases: Array.isArray(agent.useCases) ? agent.useCases.map((value) => text(value)).filter(Boolean) : [],
        notes: text(agent.notes), sourceSystem: "agentHUB", sourceId: agent.id || name, raw: agent,
      });
      const subscription = agent.subscription && typeof agent.subscription === "object" ? agent.subscription : null;
      const hasExplicitEntitlement = Boolean(subscription && (
        ["subscription", "usage", "self_hosted", "hybrid", "trial"].includes(subscription.mode)
        || text(subscription.plan) || Number.isFinite(subscription.amount) || text(subscription.renewalDate)
        || Boolean(subscription.autoRenew) || text(subscription.channel) || text(subscription.notes)
      ));
      let entitlement = entitlementByItem.get(item.id);
      if (hasExplicitEntitlement) {
        entitlement = addEntitlement(item, {
          id: identifier("ent", "agenthub", agent.id || name), itemId: item.id,
          label: text(subscription.plan, subscription.mode === "self_hosted" ? "自托管成本" : `${name} 使用权`),
          billingMode: billingMode(subscription.mode), amount: Number.isFinite(subscription.amount) ? subscription.amount : null,
          currency: ["CNY", "USD", "EUR", "HKD", "GBP", "JPY"].includes(subscription.currency) ? subscription.currency : "CNY",
          billingCycle: ["monthly", "yearly"].includes(subscription.billingCycle) ? subscription.billingCycle : "none",
          status: agent.status === "retired" ? "cancelled" : agent.status === "testing" ? "trial" : "active",
          ...(text(subscription.renewalDate) ? { renewsAt: text(subscription.renewalDate) } : {}),
          autoRenew: Boolean(subscription.autoRenew), ...(text(subscription.channel) ? { channel: text(subscription.channel) } : {}),
          ...(text(subscription.notes) ? { notes: text(subscription.notes) } : {}),
        }, "agentHUB", agent.id || name, subscription, { preferExisting: true });
      }
      for (const task of Array.isArray(agent.importantTasks) ? agent.importantTasks : []) {
        if (!text(task.title) || !text(task.date)) continue;
        const row = { id: identifier("work", "agenthub", task.id || `${agent.id}:${task.date}:${task.title}`), itemId: item.id, title: text(task.title), occurredAt: text(task.date), ...(text(task.note) ? { note: text(task.note) } : {}), sourceLabel: "agentHUB" };
        workspace.workRecords.push(row);
        addRef("agentHUB", "important_task", task.id || row.id, "work_record", row.id, task);
      }
      for (const activity of Array.isArray(agent.activity) ? agent.activity : []) {
        const level = Number(activity.level);
        if (!Number.isInteger(level) || level < 0 || level > 3 || !/^\d{4}-\d{2}$/.test(text(activity.period))) continue;
        if (entitlement) {
          const row = {
            id: identifier("snapshot", "agenthub", agent.id || name, activity.period), entitlementId: entitlement.id,
            observedAt: `${activity.period}-28T12:00:00.000Z`, utilizationPercent: [0, 25, 60, 90][level],
            sourceLabel: "agentHUB 月度活跃档位", ...(text(activity.note) ? { notes: text(activity.note) } : {}),
          };
          workspace.snapshots.push(row);
          addRef("agentHUB", "activity", `${agent.id}:${activity.period}`, "usage_snapshot", row.id, activity);
        } else {
          const row = {
            id: identifier("work", "agenthub-activity", agent.id || name, activity.period), itemId: item.id,
            title: `${activity.period} 月度活跃度 ${level}/3`, occurredAt: `${activity.period}-28`,
            ...(text(activity.note) ? { note: text(activity.note) } : {}), sourceLabel: "agentHUB",
          };
          workspace.workRecords.push(row);
          addRef("agentHUB", "activity", `${agent.id}:${activity.period}`, "work_record", row.id, activity);
        }
      }
    }
    for (const deployment of agentHub.deployments) {
      const item = itemBySourceId.get(`agentHUB:${deployment.agentId}`);
      const asset = assetBySourceId.get(`agentHUB:${deployment.deviceId}`);
      if (!item || !asset) {
        warnings.push({ code: "orphan_deployment", message: `部署 ${text(deployment.name, deployment.id)} 找不到对应 Agent 或设备，已跳过。` });
        continue;
      }
      const row = {
        id: identifier("deployment", "agenthub", deployment.id), itemId: item.id, assetId: asset.id,
        name: text(deployment.name, "未命名部署"), role: ["primary", "secondary", "testing"].includes(deployment.role) ? deployment.role : "secondary",
        status: ["online", "degraded", "offline"].includes(deployment.status) ? deployment.status : "unknown",
        ...(text(deployment.version) ? { version: text(deployment.version) } : {}), ...(text(deployment.model) ? { model: text(deployment.model) } : {}),
        ...(text(deployment.runtime) ? { runtime: text(deployment.runtime) } : {}), ...(text(deployment.installMethod) ? { installMethod: text(deployment.installMethod) } : {}),
        ...(text(deployment.notes) ? { notes: text(deployment.notes) } : {}),
      };
      workspace.deployments.push(row);
      deploymentBySourceId.set(`agentHUB:${deployment.id}`, row);
      addRef("agentHUB", "deployment", deployment.id, "deployment", row.id, deployment);
      const surface = {
        id: identifier("surface", "agenthub-deployment", deployment.id), itemId: item.id,
        name: row.name, kind: asset.kind === "server" ? "workflow" : "desktop",
        assetId: asset.id, deploymentId: row.id, device: asset.name, status: row.status === "online" ? "available" : row.status === "degraded" ? "limited" : "offline",
      };
      workspace.accessSurfaces.push(surface);
      const entitlement = entitlementByItem.get(item.id);
      if (entitlement) workspace.usageLinks.push({
        id: identifier("link", entitlement.id, row.id), entitlementId: entitlement.id,
        accessSurfaceId: surface.id, assetId: asset.id, deploymentId: row.id,
        label: `${row.role} · ${row.status}`,
      });
    }
    for (const route of agentHub.accessRoutes) {
      const item = itemBySourceId.get(`agentHUB:${route.agentId}`);
      if (!item) {
        warnings.push({ code: "orphan_access_route", message: `入口 ${text(route.app, route.id)} 找不到对应 Agent，已跳过。` });
        continue;
      }
      const asset = assetBySourceId.get(`agentHUB:${route.clientDeviceId}`);
      const deployment = deploymentBySourceId.get(`agentHUB:${route.deploymentId}`);
      const surface = {
        id: identifier("surface", "agenthub", route.id), itemId: item.id, name: text(route.app, "未命名入口"), kind: accessKind(route.kind),
        ...(asset ? { assetId: asset.id, device: asset.name } : {}), ...(deployment ? { deploymentId: deployment.id } : {}),
        ...(text(route.account) ? { account: text(route.account) } : {}),
        status: ["available", "limited", "offline"].includes(route.status) ? route.status : "available",
        ...(text(route.notes) ? { notes: text(route.notes) } : {}),
      };
      workspace.accessSurfaces.push(surface);
      const entitlement = entitlementByItem.get(item.id);
      if (entitlement) workspace.usageLinks.push({
        id: identifier("link", entitlement.id, surface.id), entitlementId: entitlement.id, accessSurfaceId: surface.id,
        ...(asset ? { assetId: asset.id } : {}), ...(deployment ? { deploymentId: deployment.id } : {}),
        label: deployment ? `${surface.name} → ${deployment.name}` : `${surface.name} 使用入口`,
      });
      addRef("agentHUB", "access_route", route.id, "access_surface", surface.id, route);
    }
  }

  if (buddyHub !== undefined) {
    const source = buddyHub?.workspace && typeof buddyHub.workspace === "object" ? buddyHub.workspace : buddyHub;
    if (!source || !Array.isArray(source.providers) || !Array.isArray(source.catalog) || !Array.isArray(source.entitlements)) throw new Error("invalid_buddyhub_export");
    const buddyProviderMap = new Map(source.providers.map((provider) => [provider.id, provider]));
    const buddyItemMap = new Map();
    const buddyEntitlementMap = new Map();
    const buddyAssetMap = new Map();
    const buddyDeploymentMap = new Map();
    const buddySurfaceMap = new Map();
    const buddyQuotaMap = new Map();

    source.providers.forEach((oldProvider) => {
      if (oldProvider?.id) ensureProvider(oldProvider.name, "buddyHUB", oldProvider.id, oldProvider);
    });
    (Array.isArray(source.tagDefinitions) ? source.tagDefinitions : Array.isArray(source.tags) ? source.tags : [])
      .map(normalizeTagDefinition).filter(Boolean).forEach((tag) => {
        const existing = workspace.tagDefinitions.find((entry) => entry.name.toLocaleLowerCase() === tag.name.toLocaleLowerCase());
        if (!existing) workspace.tagDefinitions.push(tag);
        addRef("buddyHUB", "tag_definition", tag.id || tag.name, "tag_definition", (existing || tag).id, tag);
      });
    for (const oldItem of source.catalog) {
      const oldProvider = buddyProviderMap.get(oldItem.providerId);
      const item = ensureItem({ providerName: oldProvider?.name || oldItem.name, name: text(oldItem.name, "未命名项目"), description: text(oldItem.description), roles: Array.isArray(oldItem.roles) ? oldItem.roles : ["other"], adoptionStatus: oldItem.adoptionStatus || "considering", website: text(oldItem.website), useCases: oldItem.useCases || [], notes: text(oldItem.notes), sourceSystem: "buddyHUB", sourceId: oldItem.id, raw: oldItem });
      buddyItemMap.set(oldItem.id, item);
    }
    for (const oldEntitlement of source.entitlements) {
      const item = buddyItemMap.get(oldEntitlement.itemId);
      if (!item) {
        warnings.push({ code: "buddy_orphan_entitlement", message: `buddyHUB 权益 ${text(oldEntitlement.label, oldEntitlement.id)} 找不到对应目录项，已跳过。` });
        continue;
      }
      const normalized = {
        id: identifier("ent", "buddyhub", oldEntitlement.id || `${oldEntitlement.itemId}:${oldEntitlement.label}`), itemId: item.id,
        label: text(oldEntitlement.label, `${item.name} 使用权`),
        billingMode: ["subscription", "token_pack", "pay_as_you_go", "free", "trial", "self_hosted", "hybrid", "bundled", "one_time"].includes(oldEntitlement.billingMode) ? oldEntitlement.billingMode : "free",
        amount: Number.isFinite(oldEntitlement.amount) ? oldEntitlement.amount : null,
        currency: ["CNY", "USD", "EUR", "HKD", "GBP", "JPY"].includes(oldEntitlement.currency) ? oldEntitlement.currency : "CNY",
        billingCycle: ["monthly", "yearly", "none"].includes(oldEntitlement.billingCycle) ? oldEntitlement.billingCycle : "none",
        status: ["active", "trial", "paused", "expired", "cancelled"].includes(oldEntitlement.status) ? oldEntitlement.status : "active",
        ...(text(oldEntitlement.startsAt) ? { startsAt: text(oldEntitlement.startsAt) } : {}),
        ...(text(oldEntitlement.renewsAt) ? { renewsAt: text(oldEntitlement.renewsAt) } : {}),
        ...(text(oldEntitlement.expiresAt) ? { expiresAt: text(oldEntitlement.expiresAt) } : {}),
        ...(text(oldEntitlement.resetsAt) ? { resetsAt: text(oldEntitlement.resetsAt) } : {}),
        autoRenew: Boolean(oldEntitlement.autoRenew),
        ...(text(oldEntitlement.channel) ? { channel: text(oldEntitlement.channel) } : {}),
        ...(Number.isFinite(oldEntitlement.reminderDays) ? { reminderDays: oldEntitlement.reminderDays } : {}),
        tags: Array.isArray(oldEntitlement.tags) ? oldEntitlement.tags.map((tag) => text(tag)).filter(Boolean) : [],
        ...(text(oldEntitlement.credentialLabel) ? { credentialLabel: text(oldEntitlement.credentialLabel) } : {}),
        ...(text(oldEntitlement.notes) ? { notes: text(oldEntitlement.notes) } : {}),
      };
      const candidates = workspace.entitlements.filter((entry) => entry.itemId === item.id);
      const duplicate = candidates.find((entry) => text(entry.label).toLocaleLowerCase() === normalized.label.toLocaleLowerCase())
        || candidates.find((entry) => entry.amount === normalized.amount && entry.currency === normalized.currency && entry.billingCycle === normalized.billingCycle && (entry.amount !== null || normalized.amount !== null));
      let target;
      if (duplicate) {
        warnings.push({ code: "buddy_entitlement_skipped", message: `${item.name} / ${oldEntitlement.label} 已由旧源迁入，跳过 buddyHUB 重复权益。`, itemId: item.id });
        addRef("buddyHUB", "entitlement", oldEntitlement.id, "entitlement", duplicate.id, oldEntitlement);
        target = duplicate;
      } else {
        target = addEntitlement(item, normalized, "buddyHUB", oldEntitlement.id, oldEntitlement);
      }
      if (oldEntitlement.id) buddyEntitlementMap.set(oldEntitlement.id, target);
    }

    for (const oldInvoice of Array.isArray(source.invoices) ? source.invoices : []) {
      const entitlement = buddyEntitlementMap.get(oldInvoice.entitlementId);
      if (!entitlement) {
        warnings.push({ code: "buddy_orphan_invoice", message: `buddyHUB 发票 ${text(oldInvoice.number, oldInvoice.id)} 找不到对应权益，已跳过。` });
        continue;
      }
      const duplicate = workspace.invoices.find((entry) => entry.entitlementId === entitlement.id && ((oldInvoice.number && entry.number === oldInvoice.number) || (oldInvoice.url && entry.url === oldInvoice.url)));
      const row = duplicate || {
        id: identifier("invoice", "buddyhub", oldInvoice.id || `${oldInvoice.entitlementId}:${oldInvoice.number || oldInvoice.url || oldInvoice.status}`),
        entitlementId: entitlement.id,
        status: ["issued", "pending", "none", "paid", "reimbursed"].includes(oldInvoice.status) ? oldInvoice.status : "pending",
        ...(text(oldInvoice.number) ? { number: text(oldInvoice.number) } : {}), ...(text(oldInvoice.url) ? { url: text(oldInvoice.url) } : {}),
        ...(text(oldInvoice.issuedAt) ? { issuedAt: text(oldInvoice.issuedAt) } : {}), ...(text(oldInvoice.dueAt) ? { dueAt: text(oldInvoice.dueAt) } : {}),
        ...(Number.isFinite(oldInvoice.amount) ? { amount: oldInvoice.amount } : {}),
        ...(["CNY", "USD", "EUR", "HKD", "GBP", "JPY"].includes(oldInvoice.currency) ? { currency: oldInvoice.currency } : {}),
        ...(text(oldInvoice.notes) ? { notes: text(oldInvoice.notes) } : {}),
      };
      if (!duplicate) workspace.invoices.push(row);
      addRef("buddyHUB", "invoice", oldInvoice.id || row.id, "invoice", row.id, oldInvoice);
    }

    for (const oldAsset of Array.isArray(source.assets) ? source.assets : []) {
      const oldProvider = buddyProviderMap.get(oldAsset.providerId);
      const provider = oldProvider ? ensureProvider(oldProvider.name, "buddyHUB", oldProvider.id, oldProvider) : null;
      const item = buddyItemMap.get(oldAsset.itemId);
      const kind = ["domain", "device", "server", "account", "repository", "website", "workflow", "other"].includes(oldAsset.kind) ? oldAsset.kind : "other";
      const name = text(oldAsset.name, "未命名资产");
      const duplicate = workspace.assets.find((entry) => entry.kind === kind && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      const row = duplicate || {
        id: identifier("asset", "buddyhub", oldAsset.id || `${kind}:${name}`), kind, name,
        status: ["active", "attention", "offline", "expired", "retired", "unknown"].includes(oldAsset.status) ? oldAsset.status : "unknown",
        ...(provider ? { providerId: provider.id } : {}), ...(item ? { itemId: item.id } : {}),
        ...(text(oldAsset.description) ? { description: text(oldAsset.description) } : {}), ...(text(oldAsset.domainName) ? { domainName: text(oldAsset.domainName) } : {}),
        ...(text(oldAsset.registrar) ? { registrar: text(oldAsset.registrar) } : {}), ...(text(oldAsset.expiresAt) ? { expiresAt: text(oldAsset.expiresAt) } : {}),
        ...(oldAsset.autoRenew !== undefined ? { autoRenew: Boolean(oldAsset.autoRenew) } : {}), ...(text(oldAsset.deviceType) ? { deviceType: text(oldAsset.deviceType) } : {}),
        ...(text(oldAsset.os) ? { os: text(oldAsset.os) } : {}), ...(text(oldAsset.location) ? { location: text(oldAsset.location) } : {}),
        ...(text(oldAsset.roleNote) ? { roleNote: text(oldAsset.roleNote) } : {}), ...(text(oldAsset.lastCheckedAt) ? { lastCheckedAt: text(oldAsset.lastCheckedAt) } : {}),
        ...(text(oldAsset.url) ? { url: text(oldAsset.url) } : {}), ...(text(oldAsset.notes) ? { notes: text(oldAsset.notes) } : {}),
      };
      if (!duplicate) workspace.assets.push(row);
      if (oldAsset.id) buddyAssetMap.set(oldAsset.id, row);
      addRef("buddyHUB", "asset", oldAsset.id || row.id, "asset", row.id, oldAsset);
    }

    for (const oldDeployment of Array.isArray(source.deployments) ? source.deployments : []) {
      const item = buddyItemMap.get(oldDeployment.itemId);
      const asset = buddyAssetMap.get(oldDeployment.assetId);
      if (!item || !asset) {
        warnings.push({ code: "buddy_orphan_deployment", message: `buddyHUB 部署 ${text(oldDeployment.name, oldDeployment.id)} 找不到对应项目或资产，已跳过。` });
        continue;
      }
      const name = text(oldDeployment.name, "未命名部署");
      const duplicate = workspace.deployments.find((entry) => entry.itemId === item.id && entry.assetId === asset.id && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      const row = duplicate || {
        id: identifier("deployment", "buddyhub", oldDeployment.id || `${oldDeployment.itemId}:${oldDeployment.assetId}:${name}`), itemId: item.id, assetId: asset.id, name,
        role: ["primary", "secondary", "testing"].includes(oldDeployment.role) ? oldDeployment.role : "secondary",
        status: ["online", "degraded", "offline", "unknown"].includes(oldDeployment.status) ? oldDeployment.status : "unknown",
        ...(text(oldDeployment.version) ? { version: text(oldDeployment.version) } : {}), ...(text(oldDeployment.model) ? { model: text(oldDeployment.model) } : {}),
        ...(text(oldDeployment.runtime) ? { runtime: text(oldDeployment.runtime) } : {}), ...(text(oldDeployment.installMethod) ? { installMethod: text(oldDeployment.installMethod) } : {}),
        ...(text(oldDeployment.notes) ? { notes: text(oldDeployment.notes) } : {}),
      };
      if (!duplicate) workspace.deployments.push(row);
      if (oldDeployment.id) buddyDeploymentMap.set(oldDeployment.id, row);
      addRef("buddyHUB", "deployment", oldDeployment.id || row.id, "deployment", row.id, oldDeployment);
    }

    for (const oldSurface of Array.isArray(source.accessSurfaces) ? source.accessSurfaces : []) {
      const item = buddyItemMap.get(oldSurface.itemId);
      if (!item) continue;
      const asset = buddyAssetMap.get(oldSurface.assetId);
      const deployment = buddyDeploymentMap.get(oldSurface.deploymentId);
      const name = text(oldSurface.name, "未命名入口");
      const kind = ["web", "mobile", "desktop", "cli", "api", "bot", "message", "workflow"].includes(oldSurface.kind) ? oldSurface.kind : "web";
      const duplicate = workspace.accessSurfaces.find((entry) => entry.itemId === item.id && entry.kind === kind && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      const row = duplicate || {
        id: identifier("surface", "buddyhub", oldSurface.id || `${oldSurface.itemId}:${kind}:${name}`), itemId: item.id, name, kind,
        ...(text(oldSurface.device) ? { device: text(oldSurface.device) } : {}), ...(asset ? { assetId: asset.id } : {}),
        ...(deployment ? { deploymentId: deployment.id } : {}), ...(text(oldSurface.account) ? { account: text(oldSurface.account) } : {}),
        ...(["available", "limited", "offline"].includes(oldSurface.status) ? { status: oldSurface.status } : {}),
        ...(text(oldSurface.notes) ? { notes: text(oldSurface.notes) } : {}),
      };
      if (!duplicate) workspace.accessSurfaces.push(row);
      if (oldSurface.id) buddySurfaceMap.set(oldSurface.id, row);
      addRef("buddyHUB", "access_surface", oldSurface.id || row.id, "access_surface", row.id, oldSurface);
    }

    for (const oldLink of Array.isArray(source.usageLinks) ? source.usageLinks : []) {
      const entitlement = buddyEntitlementMap.get(oldLink.entitlementId);
      if (!entitlement) continue;
      const consumerItem = buddyItemMap.get(oldLink.consumerItemId);
      const surface = buddySurfaceMap.get(oldLink.accessSurfaceId);
      const asset = buddyAssetMap.get(oldLink.assetId);
      const deployment = buddyDeploymentMap.get(oldLink.deploymentId);
      const label = text(oldLink.label, "buddyHUB 使用关系");
      const duplicate = workspace.usageLinks.find((entry) => entry.entitlementId === entitlement.id && entry.label === label && entry.accessSurfaceId === surface?.id);
      const row = duplicate || {
        id: identifier("link", "buddyhub", oldLink.id || `${oldLink.entitlementId}:${oldLink.accessSurfaceId}:${label}`), entitlementId: entitlement.id,
        ...(consumerItem ? { consumerItemId: consumerItem.id } : {}), ...(surface ? { accessSurfaceId: surface.id } : {}),
        ...(asset ? { assetId: asset.id } : {}), ...(deployment ? { deploymentId: deployment.id } : {}), label,
        ...(Number.isFinite(oldLink.allocationPercent) ? { allocationPercent: oldLink.allocationPercent } : {}),
      };
      if (!duplicate) workspace.usageLinks.push(row);
      addRef("buddyHUB", "usage_link", oldLink.id || row.id, "usage_link", row.id, oldLink);
    }

    for (const oldQuota of Array.isArray(source.quotaPolicies) ? source.quotaPolicies : []) {
      const entitlement = buddyEntitlementMap.get(oldQuota.entitlementId);
      if (!entitlement) continue;
      const label = text(oldQuota.label, "未命名额度规则");
      const duplicate = workspace.quotaPolicies.find((entry) => entry.entitlementId === entitlement.id && entry.label.toLocaleLowerCase() === label.toLocaleLowerCase());
      const row = duplicate || {
        id: identifier("quota", "buddyhub", oldQuota.id || `${oldQuota.entitlementId}:${label}`), entitlementId: entitlement.id, label,
        metric: ["tokens", "credits", "calls", "currency", "percentage", "time", "unknown"].includes(oldQuota.metric) ? oldQuota.metric : "unknown",
        windowType: ["calendar_month", "billing_cycle", "fixed_window", "rolling_window", "balance", "lifetime", "metered"].includes(oldQuota.windowType) ? oldQuota.windowType : "metered",
        ...(Number.isFinite(oldQuota.windowHours) ? { windowHours: oldQuota.windowHours } : {}), ...(Number.isFinite(oldQuota.limitValue) ? { limitValue: oldQuota.limitValue } : {}),
        ...(text(oldQuota.resetTimezone) ? { resetTimezone: text(oldQuota.resetTimezone) } : {}), ...(text(oldQuota.notes) ? { notes: text(oldQuota.notes) } : {}),
      };
      if (!duplicate) workspace.quotaPolicies.push(row);
      if (oldQuota.id) buddyQuotaMap.set(oldQuota.id, row);
      addRef("buddyHUB", "quota_policy", oldQuota.id || row.id, "quota_policy", row.id, oldQuota);
    }

    for (const oldSnapshot of Array.isArray(source.snapshots) ? source.snapshots : []) {
      const entitlement = buddyEntitlementMap.get(oldSnapshot.entitlementId);
      if (!entitlement || !text(oldSnapshot.observedAt)) {
        warnings.push({ code: "buddy_orphan_snapshot", message: `buddyHUB 快照 ${text(oldSnapshot.id, "unknown")} 找不到对应权益或观测时间，已跳过。` });
        continue;
      }
      const quota = buddyQuotaMap.get(oldSnapshot.quotaPolicyId);
      const duplicate = workspace.snapshots.find((entry) => entry.entitlementId === entitlement.id && entry.observedAt === oldSnapshot.observedAt && entry.sourceLabel === oldSnapshot.sourceLabel);
      const row = duplicate || {
        id: identifier("snapshot", "buddyhub", oldSnapshot.id || `${oldSnapshot.entitlementId}:${oldSnapshot.observedAt}`), entitlementId: entitlement.id,
        ...(quota ? { quotaPolicyId: quota.id } : {}), observedAt: text(oldSnapshot.observedAt),
        ...(text(oldSnapshot.periodStart) ? { periodStart: text(oldSnapshot.periodStart) } : {}), ...(text(oldSnapshot.periodEnd) ? { periodEnd: text(oldSnapshot.periodEnd) } : {}),
        ...(Number.isFinite(oldSnapshot.usedValue) ? { usedValue: oldSnapshot.usedValue } : {}), ...(Number.isFinite(oldSnapshot.remainingValue) ? { remainingValue: oldSnapshot.remainingValue } : {}),
        ...(Number.isFinite(oldSnapshot.utilizationPercent) ? { utilizationPercent: oldSnapshot.utilizationPercent } : {}),
        sourceLabel: text(oldSnapshot.sourceLabel, "buddyHUB"), ...(text(oldSnapshot.evidenceName) ? { evidenceName: text(oldSnapshot.evidenceName) } : {}),
        ...(text(oldSnapshot.notes) ? { notes: text(oldSnapshot.notes) } : {}),
      };
      if (!duplicate) workspace.snapshots.push(row);
      addRef("buddyHUB", "usage_snapshot", oldSnapshot.id || row.id, "usage_snapshot", row.id, oldSnapshot);
    }

    for (const oldEvaluation of Array.isArray(source.evaluations) ? source.evaluations : []) {
      const item = buddyItemMap.get(oldEvaluation.itemId);
      if (!item || !text(oldEvaluation.evaluatedAt)) continue;
      const duplicate = workspace.evaluations.find((entry) => entry.itemId === item.id && entry.evaluatedAt === oldEvaluation.evaluatedAt);
      const row = duplicate || {
        id: identifier("evaluation", "buddyhub", oldEvaluation.id || `${oldEvaluation.itemId}:${oldEvaluation.evaluatedAt}`), itemId: item.id,
        evaluatedAt: text(oldEvaluation.evaluatedAt), utilization: oldEvaluation.utilization || "none", outputValue: oldEvaluation.outputValue || "unknown",
        quotaPressure: oldEvaluation.quotaPressure || "none", trend: oldEvaluation.trend || "unknown", recommendation: oldEvaluation.recommendation || "observe",
        confidence: oldEvaluation.confidence || "low", evidenceCount: Number.isInteger(oldEvaluation.evidenceCount) ? oldEvaluation.evidenceCount : 0,
        observationDays: Number.isInteger(oldEvaluation.observationDays) ? oldEvaluation.observationDays : 0,
        ...(text(oldEvaluation.note) ? { note: text(oldEvaluation.note) } : {}),
      };
      if (!duplicate) workspace.evaluations.push(row);
      addRef("buddyHUB", "evaluation", oldEvaluation.id || row.id, "evaluation", row.id, oldEvaluation);
    }

    for (const oldRecord of Array.isArray(source.workRecords) ? source.workRecords : []) {
      const item = buddyItemMap.get(oldRecord.itemId);
      if (!item || !text(oldRecord.title) || !text(oldRecord.occurredAt)) continue;
      const duplicate = workspace.workRecords.find((entry) => entry.itemId === item.id && entry.title === oldRecord.title && entry.occurredAt === oldRecord.occurredAt);
      const row = duplicate || {
        id: identifier("work", "buddyhub", oldRecord.id || `${oldRecord.itemId}:${oldRecord.occurredAt}:${oldRecord.title}`), itemId: item.id,
        title: text(oldRecord.title), occurredAt: text(oldRecord.occurredAt), ...(text(oldRecord.note) ? { note: text(oldRecord.note) } : {}),
        sourceLabel: text(oldRecord.sourceLabel, "buddyHUB"),
      };
      if (!duplicate) workspace.workRecords.push(row);
      addRef("buddyHUB", "work_record", oldRecord.id || row.id, "work_record", row.id, oldRecord);
    }
  }

  for (const entitlement of workspace.entitlements) delete entitlement._source;
  const blockingConflicts = conflicts.filter((entry) => entry.severity === "blocking");
  return {
    workspace, warnings, conflicts,
    stats: {
      providers: workspace.providers.length, catalogItems: workspace.catalog.length,
      entitlements: workspace.entitlements.length, invoices: workspace.invoices.length,
      assets: workspace.assets.length, deployments: workspace.deployments.length,
      accessSurfaces: workspace.accessSurfaces.length, usageLinks: workspace.usageLinks.length,
      quotaPolicies: workspace.quotaPolicies.length, snapshots: workspace.snapshots.length,
      evaluations: workspace.evaluations.length, workRecords: workspace.workRecords.length,
      legacyRefs: workspace.legacyRefs.length,
    },
    canCommit: blockingConflicts.length === 0,
  };
}
