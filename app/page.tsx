"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type BillingCycle = "monthly" | "yearly";
type InvoiceStatus = "issued" | "pending" | "none";
type Section = "overview" | "subscriptions" | "invoices" | "archived" | "settings";

type TagDefinition = {
  id: string;
  name: string;
  bg: string;
  color: string;
};

type Subscription = {
  id: string;
  name: string;
  provider: string;
  plan: string;
  price: number;
  currency: "CNY" | "USD" | "EUR";
  billingCycle: BillingCycle;
  renewalDate: string;
  channel: string;
  loginDevice: string;
  tags: string[];
  autoRenew: boolean;
  invoiceStatus: InvoiceStatus;
  invoiceNumber: string;
  invoiceUrl: string;
  reminderDays: number;
  notes: string;
  archived: boolean;
};

type SmartDraft = {
  id: string;
  intent: string;
  targetName: string | null;
  summary: string;
  status: string;
  expiresAt: string;
  payload: { subscription?: Partial<Subscription>; changes?: Partial<Subscription> };
};

type ApiIssue = { code: string; message: string };

type ModelSettingsStatus = {
  configured: boolean;
  source: "byok" | "environment" | "unconfigured";
  baseUrl: string;
  model: string;
  keyConfigured: boolean;
  storageAvailable: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

type ExchangeRateSnapshot = {
  rates: Record<Subscription["currency"], number>;
  rateDate: string;
  source: string;
  lastAttemptDate: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

type ServerState = {
  subscriptions: Subscription[];
  tags: TagDefinition[];
  exchangeRates?: ExchangeRateSnapshot;
};

const STORAGE_KEY = "api-hub-subscriptions-v1";
const TAGS_STORAGE_KEY = "api-hub-tags-v1";
const MIGRATION_KEY = "api-hub-server-migrated-v1";
const tagColors = [
  { bg: "#daf7e8", color: "#17734b" },
  { bg: "#e7efff", color: "#315da8" },
  { bg: "#fff0cc", color: "#8a5a00" },
  { bg: "#eee7ff", color: "#6842a3" },
  { bg: "#f0f1f2", color: "#6e7479" },
  { bg: "#ffe7e1", color: "#a54d3c" },
];
const defaultTagDefinitions: TagDefinition[] = [
  { id: "tag_primary", name: "主力", ...tagColors[0] },
  { id: "tag_regular", name: "常用", ...tagColors[1] },
  { id: "tag_retired", name: "弃用", ...tagColors[4] },
];
const defaultExchangeRates: ExchangeRateSnapshot = {
  rates: { CNY: 1, USD: 6.7714, EUR: 7.6969 },
  rateDate: "2026-07-28",
  source: "built_in",
  lastAttemptDate: null,
  lastAttemptAt: null,
  lastError: null,
  updatedAt: "2026-07-28T00:00:00.000Z",
};

const emptyForm: Omit<Subscription, "id"> = {
  name: "",
  provider: "",
  plan: "",
  price: 0,
  currency: "CNY",
  billingCycle: "monthly",
  renewalDate: "",
  channel: "",
  loginDevice: "",
  tags: [],
  autoRenew: false,
  invoiceStatus: "pending",
  invoiceNumber: "",
  invoiceUrl: "",
  reminderDays: 7,
  notes: "",
  archived: false,
};

function daysUntil(date: string) {
  const end = new Date(`${date}T23:59:59`);
  const now = new Date();
  return Math.ceil((end.getTime() - now.getTime()) / 86400000);
}

function shortDate(date: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function formatMoney(value: number, currency: Subscription["currency"]) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
  }).format(value);
}

function renewalTone(days: number) {
  if (days < 0) return "danger";
  if (days <= 7) return "warning";
  if (days <= 30) return "attention";
  return "safe";
}

function renewalCopy(days: number) {
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return "今天续费";
  if (days === 1) return "明天续费";
  return `${days} 天后`;
}

function Avatar({ name }: { name: string }) {
  const colors = ["#132b22", "#375f4f", "#b65b36", "#41597e", "#80683f"];
  const index = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length;
  return (
    <span className="service-avatar" style={{ background: colors[index] }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Tag({ name, definitions }: { name: string; definitions: TagDefinition[] }) {
  const palette = definitions.find((tag) => tag.name === name) ?? { bg: "#eef1ef", color: "#54605b" };
  return <span className="tag" style={{ background: palette.bg, color: palette.color }}>{name}</span>;
}

class ApiRequestError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(typeof payload.message === "string" ? payload.message : typeof payload.error === "string" ? payload.error : "request_failed");
    this.status = status;
    this.payload = payload;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new ApiRequestError(response.status, payload);
  return payload as T;
}

function hydrateSubscription(value: Subscription): Subscription {
  return {
    ...value,
    provider: value.provider || "",
    plan: value.plan || "",
    channel: value.channel || "",
    loginDevice: value.loginDevice || "",
    tags: Array.isArray(value.tags) ? value.tags : [],
    invoiceNumber: value.invoiceNumber || "",
    invoiceUrl: value.invoiceUrl || "",
    notes: value.notes || "",
  };
}

export default function Home() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [section, setSection] = useState<Section>("overview");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("全部");
  const [sortBy, setSortBy] = useState<"renewal" | "price" | "name">("renewal");
  const [modalOpen, setModalOpen] = useState(false);
  const [tagSettingsOpen, setTagSettingsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Subscription, "id">>(emptyForm);
  const [tagDefinitions, setTagDefinitions] = useState<TagDefinition[]>(defaultTagDefinitions);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateSnapshot>(defaultExchangeRates);
  const [tagDraft, setTagDraft] = useState<TagDefinition[]>([]);
  const [tagError, setTagError] = useState("");
  const [toast, setToast] = useState("");
  const [smartText, setSmartText] = useState("");
  const [smartBusy, setSmartBusy] = useState(false);
  const [smartDraft, setSmartDraft] = useState<SmartDraft | null>(null);
  const [smartIssues, setSmartIssues] = useState<ApiIssue[]>([]);
  const [modelSettings, setModelSettings] = useState({ baseUrl: "https://api.openai.com/v1", model: "", apiKey: "" });
  const [modelStatus, setModelStatus] = useState<ModelSettingsStatus | null>(null);
  const [modelSettingsBusy, setModelSettingsBusy] = useState(false);
  const [modelSettingsError, setModelSettingsError] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const smartInputRef = useRef<HTMLTextAreaElement>(null);

  const applyServerState = useCallback((state: ServerState) => {
    setSubscriptions(state.subscriptions.map(hydrateSubscription));
    setTagDefinitions(state.tags);
    if (state.exchangeRates) setExchangeRates(state.exchangeRates);
  }, []);

  const loadServerState = useCallback(async (allowMigration = true) => {
    let state = await requestJson<ServerState>("/api/web/state");
    if (allowMigration && !state.subscriptions.length && !window.localStorage.getItem(MIGRATION_KEY)) {
      const savedSubscriptions = window.localStorage.getItem(STORAGE_KEY);
      const savedTags = window.localStorage.getItem(TAGS_STORAGE_KEY);
      if (savedSubscriptions) {
        try {
          const importedSubscriptions = JSON.parse(savedSubscriptions);
          const importedTags = savedTags ? JSON.parse(savedTags) : defaultTagDefinitions;
          state = await requestJson("/api/web/import", {
            method: "POST",
            body: JSON.stringify({ subscriptions: importedSubscriptions, tags: importedTags }),
          });
          window.localStorage.setItem(MIGRATION_KEY, new Date().toISOString());
        } catch {
          // Keep the browser copy intact. The user can still import it manually.
        }
      }
    }
    applyServerState(state);
  }, [applyServerState]);

  useEffect(() => {
    let activeRequest = true;
    void (async () => {
      try {
        const session = await requestJson<{ authenticated: boolean }>("/api/session", { method: "GET" });
        if (!activeRequest) return;
        setAuthenticated(session.authenticated);
        if (session.authenticated) await loadServerState();
      } catch {
        if (activeRequest) setLoginError("暂时无法连接 API Hub 服务");
      } finally {
        if (activeRequest) setReady(true);
      }
    })();
    return () => { activeRequest = false; };
  }, [loadServerState]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const active = subscriptions.filter((item) => !item.archived);
  const archived = subscriptions.filter((item) => item.archived);
  const allTags = useMemo(() => tagDefinitions.map((tag) => tag.name), [tagDefinitions]);

  const monthlyTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    active.forEach((item) => {
      totals[item.currency] = (totals[item.currency] ?? 0) + item.price / (item.billingCycle === "yearly" ? 12 : 1);
    });
    return Object.entries(totals).map(([currency, value]) => formatMoney(value, currency as Subscription["currency"])).join(" + ") || "¥0";
  }, [active]);

  const dueSoon = active.filter((item) => {
    const days = daysUntil(item.renewalDate);
    return days >= 0 && days <= 30;
  }).sort((a, b) => a.renewalDate.localeCompare(b.renewalDate));
  const pendingInvoices = active.filter((item) => item.invoiceStatus === "pending").length;
  const annualized = active.reduce((sum, item) => {
    const yearlyAmount = item.price * (item.billingCycle === "monthly" ? 12 : 1);
    return sum + yearlyAmount * (exchangeRates.rates[item.currency] ?? 1);
  }, 0);

  const filtered = useMemo(() => {
    let list = section === "archived" ? archived : active;
    if (section === "invoices") list = list.filter((item) => item.invoiceStatus !== "none");
    if (tagFilter !== "全部") list = list.filter((item) => item.tags.includes(tagFilter));
    const query = search.trim().toLowerCase();
    if (query) {
      list = list.filter((item) => [item.name, item.provider, item.plan, item.channel, item.loginDevice, item.notes, item.tags.join(" ")].join(" ").toLowerCase().includes(query));
    }
    return [...list].sort((a, b) => {
      if (sortBy === "price") return (b.price / (b.billingCycle === "yearly" ? 12 : 1)) - (a.price / (a.billingCycle === "yearly" ? 12 : 1));
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return a.renewalDate.localeCompare(b.renewalDate);
    });
  }, [active, archived, search, section, sortBy, tagFilter]);

  const notify = (message: string) => setToast(message);

  const handleRequestError = (error: unknown, fallback: string) => {
    if (error instanceof ApiRequestError && error.status === 401) {
      setAuthenticated(false);
      setLoginError("登录已过期，请重新登录");
      return;
    }
    notify(error instanceof ApiRequestError && error.message !== "request_failed" ? error.message : fallback);
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    try {
      await requestJson("/api/session", { method: "POST", body: JSON.stringify({ password: loginPassword }) });
      setAuthenticated(true);
      setLoginPassword("");
      await loadServerState();
    } catch (error) {
      setLoginError(error instanceof ApiRequestError && error.status === 401 ? "密码不正确" : "登录服务暂时不可用");
    } finally {
      setLoginBusy(false);
    }
  };

  const logout = async () => {
    await requestJson("/api/session", { method: "DELETE" }).catch(() => undefined);
    setAuthenticated(false);
    setSubscriptions([]);
    setSmartDraft(null);
  };

  const openTagSettings = () => {
    setTagDraft(tagDefinitions.map((tag) => ({ ...tag })));
    setTagError("");
    setTagSettingsOpen(true);
  };

  const addTagDraft = () => {
    const usedNames = new Set(tagDraft.map((tag) => tag.name));
    let index = 1;
    while (usedNames.has(`新标签 ${index}`)) index += 1;
    setTagDraft((current) => [...current, { id: crypto.randomUUID(), name: `新标签 ${index}`, ...tagColors[current.length % tagColors.length] }]);
  };

  const saveTagSettings = async () => {
    const cleaned = tagDraft.map((tag) => ({ ...tag, name: tag.name.trim() }));
    if (cleaned.some((tag) => !tag.name)) {
      setTagError("标签名称不能为空");
      return;
    }
    if (new Set(cleaned.map((tag) => tag.name.toLowerCase())).size !== cleaned.length) {
      setTagError("标签名称不能重复");
      return;
    }

    try {
      const state = await requestJson<{ subscriptions: Subscription[]; tags: TagDefinition[] }>("/api/web/tags", {
        method: "PUT",
        body: JSON.stringify({ tags: cleaned }),
      });
      applyServerState(state);
      if (tagFilter !== "全部" && !cleaned.some((tag) => tag.name === tagFilter)) setTagFilter("全部");
      setTagSettingsOpen(false);
      notify("标签设置已保存");
    } catch (error) {
      handleRequestError(error, "标签设置保存失败");
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, renewalDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) });
    setModalOpen(true);
  };

  const openEdit = (item: Subscription) => {
    setEditingId(item.id);
    const { id: _id, ...values } = item;
    void _id;
    setForm(values);
    setModalOpen(true);
  };

  const submitForm = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.renewalDate || form.price < 0) return;
    try {
      const path = editingId ? `/api/web/subscriptions/${editingId}` : "/api/web/subscriptions";
      const result = await requestJson<{ subscription: Subscription }>(path, {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify({ subscription: { ...form, name: form.name.trim() } }),
      });
      const saved = hydrateSubscription(result.subscription);
      setSubscriptions((current) => editingId
        ? current.map((item) => item.id === editingId ? saved : item)
        : [saved, ...current]);
      notify(editingId ? "订阅信息已更新" : "新订阅已加入清单");
      setModalOpen(false);
    } catch (error) {
      handleRequestError(error, "订阅保存失败");
    }
  };

  const archiveItem = async (item: Subscription) => {
    try {
      const result = await requestJson<{ subscription: Subscription }>(`/api/web/subscriptions/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({ subscription: { ...item, archived: !item.archived } }),
      });
      const saved = hydrateSubscription(result.subscription);
      setSubscriptions((current) => current.map((entry) => entry.id === item.id ? saved : entry));
      notify(item.archived ? "订阅已恢复" : "订阅已归档");
    } catch (error) {
      handleRequestError(error, "订阅状态更新失败");
    }
  };

  const deleteItem = async (item: Subscription) => {
    if (!window.confirm(`确定永久删除「${item.name}」吗？`)) return;
    try {
      await requestJson(`/api/web/subscriptions/${item.id}`, { method: "DELETE" });
      setSubscriptions((current) => current.filter((entry) => entry.id !== item.id));
      notify("记录已删除");
    } catch (error) {
      handleRequestError(error, "删除失败");
    }
  };

  const exportData = () => {
    const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), subscriptions, tags: tagDefinitions }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `api-hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notify("备份文件已导出");
  };

  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.subscriptions)) throw new Error("invalid");
      const importedTags = Array.isArray(parsed.tags)
        ? parsed.tags
        : Array.from(new Set<string>(parsed.subscriptions.flatMap((item: Subscription) => item.tags)))
          .map((name, index) => ({ id: crypto.randomUUID(), name, ...tagColors[index % tagColors.length] }));
      const state = await requestJson<{ subscriptions: Subscription[]; tags: TagDefinition[] }>("/api/web/import", {
        method: "POST",
        body: JSON.stringify({ subscriptions: parsed.subscriptions, tags: importedTags }),
      });
      applyServerState(state);
      notify(`已导入 ${parsed.subscriptions.length} 条订阅`);
    } catch (error) {
      handleRequestError(error, "无法识别或导入这个备份文件");
    }
    event.target.value = "";
  };

  const submitSmartText = async () => {
    if (!smartText.trim()) return;
    setSmartBusy(true);
    setSmartDraft(null);
    setSmartIssues([]);
    try {
      const result = await requestJson<{
        status: string;
        draft?: SmartDraft;
        issues?: ApiIssue[];
        results?: Subscription[];
      }>("/api/web/intake", { method: "POST", body: JSON.stringify({ message: smartText.trim() }) });
      if (result.status === "pending_confirmation" && result.draft) setSmartDraft(result.draft);
      else if (result.status === "query_completed") {
        setSubscriptions((current) => {
          const found = (result.results || []).map(hydrateSubscription);
          const foundIds = new Set(found.map((item) => item.id));
          return [...found, ...current.filter((item) => !foundIds.has(item.id))];
        });
        setSmartIssues([{ code: "query_completed", message: `已找到 ${(result.results || []).length} 条相关订阅，请在清单中查看。` }]);
      } else setSmartIssues(result.issues || [{ code: "needs_clarification", message: "信息还不够完整，请补充后再试。" }]);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const issues = Array.isArray(error.payload.issues) ? error.payload.issues as ApiIssue[] : [];
        setSmartIssues(issues.length ? issues : [{ code: String(error.payload.error || "request_failed"), message: error.message }]);
        if (error.status === 401) setAuthenticated(false);
      } else setSmartIssues([{ code: "request_failed", message: "智能录入暂时不可用，请稍后再试。" }]);
    } finally {
      setSmartBusy(false);
    }
  };

  const closeSmartDraft = async (cancel = true) => {
    if (cancel && smartDraft) await requestJson(`/api/web/drafts/${smartDraft.id}/cancel`, { method: "POST", body: "{}" }).catch(() => undefined);
    setSmartDraft(null);
  };

  const commitSmartDraft = async () => {
    if (!smartDraft) return;
    setSmartBusy(true);
    try {
      await requestJson(`/api/web/drafts/${smartDraft.id}/commit`, { method: "POST", body: "{}" });
      await loadServerState(false);
      setSmartDraft(null);
      setSmartText("");
      notify("草稿已确认并写入订阅台账");
    } catch (error) {
      handleRequestError(error, "草稿确认失败");
    } finally {
      setSmartBusy(false);
    }
  };

  const openModelSettings = async () => {
    setSection("settings");
    setModelSettingsError("");
    setModelSettingsBusy(true);
    try {
      const result = await requestJson<{ settings: ModelSettingsStatus }>("/api/web/model-settings");
      setModelStatus(result.settings);
      setModelSettings({ baseUrl: result.settings.baseUrl, model: result.settings.model, apiKey: "" });
    } catch (error) {
      handleRequestError(error, "模型设置读取失败");
    } finally {
      setModelSettingsBusy(false);
    }
  };

  const saveModelSettings = async (event: FormEvent) => {
    event.preventDefault();
    setModelSettingsBusy(true);
    setModelSettingsError("");
    try {
      const result = await requestJson<{ settings: ModelSettingsStatus }>("/api/web/model-settings", {
        method: "PUT",
        body: JSON.stringify({ settings: modelSettings }),
      });
      setModelStatus(result.settings);
      setModelSettings((current) => ({ ...current, apiKey: "" }));
      notify(modelStatus?.source === "byok" ? "模型设置已更新" : "BYOK 模型已安全保存");
    } catch (error) {
      if (error instanceof ApiRequestError && Array.isArray(error.payload.issues)) {
        setModelSettingsError((error.payload.issues as ApiIssue[]).map((issue) => issue.message).join("；"));
      } else setModelSettingsError(error instanceof ApiRequestError ? error.message : "模型设置保存失败");
    } finally {
      setModelSettingsBusy(false);
    }
  };

  const removeModelSettings = async () => {
    if (!window.confirm("确定删除已保存的 BYOK 配置吗？之后将改用 VPS 环境变量中的后备模型配置。")) return;
    setModelSettingsBusy(true);
    try {
      const result = await requestJson<{ settings: ModelSettingsStatus }>("/api/web/model-settings", { method: "DELETE" });
      setModelStatus(result.settings);
      setModelSettings({ baseUrl: result.settings.baseUrl, model: result.settings.model, apiKey: "" });
      notify("已删除数据库中的 BYOK 配置");
    } catch (error) {
      handleRequestError(error, "删除模型设置失败");
    } finally {
      setModelSettingsBusy(false);
    }
  };

  const sectionTitle = section === "overview" ? "订阅总览" : section === "subscriptions" ? "全部订阅" : section === "invoices" ? "发票台账" : section === "archived" ? "归档记录" : "模型设置";

  if (!ready) return <main className="loading-screen"><span className="loading-mark">A</span><p>正在整理订阅台账…</p></main>;

  if (!authenticated) return (
    <main className="login-screen">
      <section className="login-card">
        <div className="brand-mark login-mark">A</div>
        <p className="section-kicker">PRIVATE SUBSCRIPTION LEDGER</p>
        <h1>登录 API Hub</h1>
        <p className="login-copy">这是部署在你 VPS 上的私人订阅台账。请输入站点密码继续。</p>
        <form onSubmit={submitLogin}>
          <label><span>站点密码</span><input type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required /></label>
          {loginError && <p className="login-error" role="alert">{loginError}</p>}
          <button className="primary-button" type="submit" disabled={loginBusy}>{loginBusy ? "正在验证…" : "登录"}</button>
        </form>
        <div className="login-boundary"><span>◇</span><p>订阅台账绝不保存任何 API Key；模型 BYOK 凭据只能在登录后的设置页加密保存。</p></div>
      </section>
    </main>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">A</div>
          <div><strong>API Hub</strong><span>SUBSCRIPTION INDEX</span></div>
        </div>

        <nav className="main-nav" aria-label="主要导航">
          <button className={section === "overview" ? "active" : ""} onClick={() => setSection("overview")}><span>⌂</span>总览</button>
          <button className={section === "subscriptions" ? "active" : ""} onClick={() => setSection("subscriptions")}><span>▤</span>全部订阅 <em>{active.length}</em></button>
          <button className={section === "invoices" ? "active" : ""} onClick={() => setSection("invoices")}><span>▧</span>发票台账 <em>{pendingInvoices}</em></button>
          <button className={section === "archived" ? "active" : ""} onClick={() => setSection("archived")}><span>□</span>归档 <em>{archived.length}</em></button>
          <button className={section === "settings" ? "active" : ""} onClick={openModelSettings}><span>⚙</span>模型设置</button>
        </nav>

        <div className="sidebar-section">
          <div className="sidebar-label"><span>标签</span><button className="tag-settings-button" onClick={openTagSettings} aria-label="管理标签">设置</button></div>
          <button className={tagFilter === "全部" ? "tag-filter active" : "tag-filter"} onClick={() => setTagFilter("全部")}><i className="dot all" />全部标签</button>
          {allTags.map((tag) => (
            <button key={tag} className={tagFilter === tag ? "tag-filter active" : "tag-filter"} onClick={() => setTagFilter(tag)}>
              <i className="dot" style={{ background: tagDefinitions.find((item) => item.name === tag)?.color ?? "#829087" }} />{tag}
              <small>{subscriptions.filter((item) => item.tags.includes(tag)).length}</small>
            </button>
          ))}
        </div>

        <div className="privacy-card">
          <div className="privacy-icon">✓</div>
          <div><strong>数据域隔离</strong><p>订阅台账拒绝密钥；模型 Key 仅在设置仓库中加密保存。</p></div>
        </div>

        <div className="data-actions">
          <button onClick={exportData}>↓ 导出备份</button>
          <button onClick={() => importRef.current?.click()}>↑ 导入数据</button>
          <button onClick={logout}>↪ 退出登录</button>
          <input ref={importRef} type="file" accept="application/json" onChange={importData} hidden />
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">PRIVATE SUBSCRIPTION LEDGER</p>
            <h1>{sectionTitle}</h1>
          </div>
          <div className="topbar-actions">
            <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索产品、渠道或标签" aria-label="搜索订阅" /></label>
            <button className="settings-jump-button" onClick={openModelSettings} aria-label="模型设置"><span>⚙</span><b>设置</b></button>
            <button className="smart-jump-button" onClick={() => { setSection("overview"); window.setTimeout(() => smartInputRef.current?.focus(), 0); }}><span>◇</span>智能录入</button>
            <button className="primary-button" onClick={openCreate}><span>＋</span>添加订阅</button>
          </div>
        </header>

        {section === "overview" && (
          <>
            <section className="smart-intake-panel">
              <div className="smart-intake-copy">
                <p className="section-kicker">SEMANTIC INTAKE</p>
                <h2>一句话录入订阅</h2>
                <p>输入自然语言，语义闸机会先整理成草稿。只有你确认后才会写入台账。</p>
              </div>
              <div className="smart-input-shell">
                <textarea
                  ref={smartInputRef}
                  value={smartText}
                  onChange={(event) => { setSmartText(event.target.value); setSmartIssues([]); }}
                  rows={3}
                  maxLength={12000}
                  placeholder="例如：新增 Cursor Pro，每月 20 美元，9 月 8 日续费，官网信用卡，标签主力，待开票"
                  aria-label="智能录入文本"
                />
                <div className="smart-input-footer">
                  <small>不要输入 API Key、Token、Secret 或完整卡号</small>
                  <button className="primary-button" onClick={submitSmartText} disabled={smartBusy || !smartText.trim()}>{smartBusy ? "正在整理…" : "生成草稿"}</button>
                </div>
              </div>
              {smartIssues.length > 0 && (
                <div className="smart-issues" role="status">
                  {smartIssues.map((item, index) => <p key={`${item.code}-${index}`}><span>!</span>{item.message}</p>)}
                </div>
              )}
              {smartDraft && (
                <div className="smart-draft-card" role="dialog" aria-label="智能录入草稿">
                  <div className="smart-draft-heading"><span>待确认草稿</span><small>{new Date(smartDraft.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 前有效</small></div>
                  <pre>{smartDraft.summary}</pre>
                  <div className="smart-draft-actions">
                    <button className="secondary-button" onClick={() => closeSmartDraft(true)} disabled={smartBusy}>取消草稿</button>
                    <button className="primary-button" onClick={commitSmartDraft} disabled={smartBusy}>确认写入</button>
                  </div>
                </div>
              )}
            </section>
            <section className="hero-grid">
              <article className="summary-card dark-card">
                <div className="card-topline"><span>月均订阅成本</span><span className="trend-chip">稳定</span></div>
                <strong className="big-number">{monthlyTotals}</strong>
                <p>月均按币种分开展示；年化总额按参考汇率折算人民币</p>
                <div className="budget-bar"><span style={{ width: `${Math.min(annualized / 5000 * 100, 100)}%` }} /></div>
                <small>人民币年化估算 {formatMoney(annualized, "CNY")}</small>
                <small className="rate-note" title={exchangeRates.lastError ? `本月汇率更新失败：${exchangeRates.lastError}` : "每月最多自动更新一次"}>
                  {exchangeRates.source === "ecb" ? "ECB 参考汇率" : exchangeRates.lastError ? "本月更新失败，使用缓存汇率" : "系统内置汇率"}
                  {` · ${exchangeRates.rateDate} · USD 1≈¥${exchangeRates.rates.USD.toFixed(2)} · EUR 1≈¥${exchangeRates.rates.EUR.toFixed(2)}`}
                </small>
              </article>
              <article className="summary-card">
                <div className="card-topline"><span>30 天内到期</span><span className="card-symbol amber">↗</span></div>
                <strong className="big-number">{dueSoon.length}<small> 项</small></strong>
                <p>{dueSoon.length ? `最近：${dueSoon[0].name} · ${shortDate(dueSoon[0].renewalDate)}` : "近期没有续费压力"}</p>
              </article>
              <article className="summary-card">
                <div className="card-topline"><span>待处理发票</span><span className="card-symbol blue">▧</span></div>
                <strong className="big-number">{pendingInvoices}<small> 张</small></strong>
                <p>{pendingInvoices ? "建议在月底报销前集中处理" : "票据状态清爽"}</p>
              </article>
            </section>

            <section className="renewal-board">
              <div className="section-heading">
                <div><p className="section-kicker">RENEWAL RADAR</p><h2>续费雷达</h2></div>
                <button className="text-button" onClick={() => setSection("subscriptions")}>查看全部 →</button>
              </div>
              <div className="radar-layout">
                <div className="radar-visual" aria-label="未来三十天续费分布">
                  <div className="ring ring-outer"><span>30 天</span></div>
                  <div className="ring ring-middle"><span>14 天</span></div>
                  <div className="ring ring-inner"><span>7 天</span></div>
                  <div className="radar-center"><strong>{dueSoon.length}</strong><small>待续费</small></div>
                  {dueSoon.slice(0, 3).map((item, index) => {
                    const days = daysUntil(item.renewalDate);
                    return <div key={item.id} className={`radar-dot dot-${index + 1} ${renewalTone(days)}`} title={`${item.name}：${renewalCopy(days)}`}><span>{item.name.slice(0, 1)}</span></div>;
                  })}
                </div>
                <div className="renewal-list">
                  {dueSoon.length ? dueSoon.slice(0, 4).map((item) => {
                    const days = daysUntil(item.renewalDate);
                    return (
                      <button key={item.id} className="renewal-row" onClick={() => openEdit(item)}>
                        <Avatar name={item.name} />
                        <span className="renewal-name"><strong>{item.name}</strong><small>{item.plan}</small></span>
                        <span className="renewal-date"><strong>{shortDate(item.renewalDate)}</strong><small>{renewalCopy(days)}</small></span>
                        <span className={`status-pill ${renewalTone(days)}`}>{item.autoRenew ? "自动续费" : "手动确认"}</span>
                      </button>
                    );
                  }) : <div className="empty-state compact"><strong>未来 30 天很安静</strong><p>没有即将到期的订阅。</p></div>}
                </div>
              </div>
            </section>
          </>
        )}

        {section === "settings" && (
          <section className="settings-page">
            <div className="settings-intro">
              <div><p className="section-kicker">MODEL GATE BYOK</p><h2>语义闸机模型</h2></div>
              <span className={`settings-status ${modelStatus?.configured ? "ready" : ""}`}>{modelStatus?.configured ? "已配置" : "未配置"}</span>
              <p>这里的 API Key 只用于 API Hub 的语义整理服务，与订阅台账完全分离。保存后网页和接口都不会再次回显 Key。</p>
            </div>
            <form className="settings-form" onSubmit={saveModelSettings}>
              <label><span>OpenAI-compatible 接口地址</span><input type="url" required maxLength={500} value={modelSettings.baseUrl} onChange={(event) => setModelSettings({ ...modelSettings, baseUrl: event.target.value })} placeholder="https://provider.example/v1" /></label>
              <label><span>模型 ID</span><input required maxLength={200} value={modelSettings.model} onChange={(event) => setModelSettings({ ...modelSettings, model: event.target.value })} placeholder="例如：your-model-id" /></label>
              <label><span>API Key</span><input type="password" minLength={8} maxLength={512} autoComplete="new-password" value={modelSettings.apiKey} onChange={(event) => setModelSettings({ ...modelSettings, apiKey: event.target.value })} placeholder={modelStatus?.source === "byok" ? "留空表示保留当前 Key" : "首次配置必须填写"} /></label>
              <div className="secret-boundary"><span>✓</span><div><strong>AES-256-GCM 加密存储</strong><p>SQLite 只保存密文、随机 IV 和认证标签；独立主密钥由 VPS 环境变量或 Docker Secret 提供，不进入数据库和 Git。</p></div></div>
              {!modelStatus?.storageAvailable && <p className="settings-warning">VPS 尚未提供 APIHUB_SECRETS_MASTER_KEY。设置可查看，但在配置主密钥前无法保存 BYOK Key。</p>}
              {modelSettingsError && <p className="settings-error" role="alert">{modelSettingsError}</p>}
              <div className="settings-meta">
                <span>当前来源：{modelStatus?.source === "byok" ? "网页 BYOK" : modelStatus?.source === "environment" ? "VPS 环境变量" : "未配置"}</span>
                {modelStatus?.updatedAt && <span>上次更新：{new Date(modelStatus.updatedAt).toLocaleString("zh-CN")}</span>}
              </div>
              <footer>
                {modelStatus?.source === "byok" && <button type="button" className="danger-button" onClick={removeModelSettings} disabled={modelSettingsBusy}>删除 BYOK 配置</button>}
                <button type="submit" className="primary-button" disabled={modelSettingsBusy || !modelSettings.baseUrl.trim() || !modelSettings.model.trim()}>{modelSettingsBusy ? "正在保存…" : modelStatus?.source === "byok" ? "保存设置" : "安全保存 Key"}</button>
              </footer>
            </form>
            <aside className="settings-notes"><h3>使用边界</h3><ul><li>不要把模型 Key 填进订阅名称、备注、渠道或智能录入文本。</li><li>替换 Key 时直接输入新值；旧密文会被覆盖，接口永不提供查看原值的功能。</li><li>请单独备份 VPS 主密钥。主密钥丢失后，已保存的 Key 无法恢复，只能删除并重新填写。</li><li>生产环境必须通过 HTTPS 访问设置页，并限制 SQLite 与环境变量文件的系统权限。</li></ul></aside>
          </section>
        )}

        {section !== "settings" && <section className={`records-section ${section !== "overview" ? "standalone" : ""}`}>
          <div className="section-heading records-heading">
            <div><p className="section-kicker">SUBSCRIPTION INDEX</p><h2>{section === "overview" ? "订阅清单" : sectionTitle}</h2></div>
            <div className="table-tools">
              <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} aria-label="按标签筛选">
                <option>全部</option>{allTags.map((tag) => <option key={tag}>{tag}</option>)}
              </select>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} aria-label="排序方式">
                <option value="renewal">按到期时间</option><option value="price">按月均价格</option><option value="name">按名称</option>
              </select>
            </div>
          </div>

          <div className="records-table-wrap">
            <div className="records-table-head"><span>服务</span><span>标签</span><span>登录设备</span><span>费用 / 周期</span><span>下次到期</span><span>渠道</span><span>发票 / 报销</span><span>备注</span><span aria-hidden="true" /></div>
            <div className="records-list">
              {filtered.length ? filtered.map((item) => {
                const days = daysUntil(item.renewalDate);
                return (
                  <article className="record-row" key={item.id}>
                    <div className="service-cell"><Avatar name={item.name} /><span><strong>{item.name}</strong><small>{item.provider} · {item.plan || "未填写方案"}</small></span></div>
                    <div className="tags-cell">{item.tags.length ? item.tags.map((tag) => <Tag name={tag} definitions={tagDefinitions} key={tag} />) : <span className="no-tag">无标签</span>}</div>
                    <div className="device-cell" title={item.loginDevice || "未记录登录设备"}><span className="cell-label">登录设备</span><strong>{item.loginDevice || "未记录"}</strong></div>
                    <div className="price-cell"><strong>{formatMoney(item.price, item.currency)}</strong><small>/{item.billingCycle === "monthly" ? "月" : "年"}</small></div>
                    <div className="date-cell"><strong>{shortDate(item.renewalDate)}</strong><small className={renewalTone(days)}>{renewalCopy(days)}</small></div>
                    <div className="channel-cell" title={item.channel || "未填写渠道"}><span className="cell-label">渠道</span><strong>{item.channel || "未填写渠道"}</strong></div>
                    <div className="invoice-cell"><span className="cell-label">发票 / 报销</span><strong className={`invoice-${item.invoiceStatus}`}>{item.invoiceStatus === "issued" ? `已开票${item.invoiceNumber ? ` · ${item.invoiceNumber}` : ""}` : item.invoiceStatus === "pending" ? "待开票" : "无需发票"}</strong><small>{item.notes ? "报销备忘见备注" : "可在备注记录报销"}</small></div>
                    <div className="notes-cell" title={item.notes || "暂无备注"}><span className="cell-label">备注</span><p>{item.notes || "暂无备注"}</p></div>
                    <div className="row-actions">
                      {item.invoiceUrl && <a href={item.invoiceUrl} target="_blank" rel="noreferrer" title="打开发票链接">↗</a>}
                      <button onClick={() => openEdit(item)} title="编辑">编辑</button>
                      <button onClick={() => archiveItem(item)} title={item.archived ? "恢复" : "归档"}>{item.archived ? "恢复" : "归档"}</button>
                      <button className="danger-action" onClick={() => deleteItem(item)} title="删除">×</button>
                    </div>
                  </article>
                );
              }) : (
                <div className="empty-state"><span>◎</span><strong>没有匹配的订阅</strong><p>换个筛选条件，或添加一项新的 API 订阅。</p><button onClick={openCreate}>添加订阅</button></div>
              )}
            </div>
          </div>
        </section>}
      </main>

      <nav className="mobile-nav" aria-label="移动端导航">
        <button className={section === "overview" ? "active" : ""} onClick={() => setSection("overview")}><span>⌂</span>总览</button>
        <button className={section === "subscriptions" ? "active" : ""} onClick={() => setSection("subscriptions")}><span>▤</span>订阅</button>
        <button className="mobile-add" onClick={openCreate} aria-label="添加订阅">＋</button>
        <button className={section === "invoices" ? "active" : ""} onClick={() => setSection("invoices")}><span>▧</span>发票</button>
        <button className={section === "archived" ? "active" : ""} onClick={() => setSection("archived")}><span>□</span>归档</button>
      </nav>

      {modalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <header><div><p className="section-kicker">SUBSCRIPTION RECORD</p><h2 id="modal-title">{editingId ? "编辑订阅" : "添加 API 订阅"}</h2></div><button className="modal-close" onClick={() => setModalOpen(false)} aria-label="关闭">×</button></header>
            <form onSubmit={submitForm}>
              <div className="form-grid">
                <label className="full"><span>订阅名称 *</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：Codex" required /></label>
                <label><span>服务商</span><input value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })} placeholder="例如：OpenAI" /></label>
                <label><span>方案</span><input value={form.plan} onChange={(event) => setForm({ ...form, plan: event.target.value })} placeholder="例如：Team · 1 席位" /></label>
                <label><span>价格 *</span><div className="compound-input"><select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value as Subscription["currency"] })}><option value="CNY">¥ CNY</option><option value="USD">$ USD</option><option value="EUR">€ EUR</option></select><input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: Number(event.target.value) })} required /></div></label>
                <label><span>订阅周期</span><select value={form.billingCycle} onChange={(event) => setForm({ ...form, billingCycle: event.target.value as BillingCycle })}><option value="monthly">按月</option><option value="yearly">按年</option></select></label>
                <label><span>下次到期 *</span><input type="date" value={form.renewalDate} onChange={(event) => setForm({ ...form, renewalDate: event.target.value })} required /></label>
                <label><span>提醒时间</span><select value={form.reminderDays} onChange={(event) => setForm({ ...form, reminderDays: Number(event.target.value) })}><option value={3}>提前 3 天</option><option value={7}>提前 7 天</option><option value={14}>提前 14 天</option><option value={30}>提前 30 天</option></select></label>
                <label className="full"><span>订阅途径 / 支付渠道</span><input value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })} placeholder="例如：官网 · Visa 尾号 2048（不要填写完整卡号）" /></label>
                <label className="full"><span>登录设备</span><input value={form.loginDevice} onChange={(event) => setForm({ ...form, loginDevice: event.target.value })} placeholder="例如：Windows 台式机、MacBook、安卓手机" /></label>
                <div className="full tag-picker-field"><span>标签</span><div className="tag-picker">{tagDefinitions.length ? tagDefinitions.map((tag) => {
                  const selected = form.tags.includes(tag.name);
                  return <button type="button" key={tag.id} className={selected ? "selected" : ""} style={selected ? { background: tag.bg, color: tag.color, borderColor: tag.color } : undefined} onClick={() => setForm({ ...form, tags: selected ? form.tags.filter((name) => name !== tag.name) : [...form.tags, tag.name] })}>{selected ? "✓ " : ""}{tag.name}</button>;
                }) : <small className="field-hint">还没有标签，可从左侧“标签设置”添加。</small>}</div><button type="button" className="inline-settings-link" onClick={openTagSettings}>管理标签 →</button></div>
                <label><span>发票状态</span><select value={form.invoiceStatus} onChange={(event) => setForm({ ...form, invoiceStatus: event.target.value as InvoiceStatus })}><option value="pending">待开票</option><option value="issued">已开票</option><option value="none">无需发票</option></select></label>
                <label><span>发票号码</span><input value={form.invoiceNumber} onChange={(event) => setForm({ ...form, invoiceNumber: event.target.value })} disabled={form.invoiceStatus !== "issued"} placeholder="选填" /></label>
                <label className="full"><span>发票文件链接</span><input type="url" value={form.invoiceUrl} onChange={(event) => setForm({ ...form, invoiceUrl: event.target.value })} placeholder="https://…（可填 VPS 或云盘中的文件链接）" /></label>
                <label className="full"><span>备注 / 报销备忘</span><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="例如：已开票并报销至 2026 年 5 月；续费前复核用量和席位" /></label>
              </div>
              <div className="switch-row"><label className="switch" aria-label="自动续费"><input type="checkbox" checked={form.autoRenew} onChange={(event) => setForm({ ...form, autoRenew: event.target.checked })} /><span /></label><div><strong>自动续费</strong><small>仅记录状态，不会执行付款</small></div></div>
              <div className="modal-note"><span>◇</span><p><strong>安全边界：</strong>请勿在任何字段粘贴 API Key、Token、Secret 或完整支付卡号。</p></div>
              <footer><button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>取消</button><button type="submit" className="primary-button">{editingId ? "保存修改" : "加入清单"}</button></footer>
            </form>
          </section>
        </div>
      )}

      {tagSettingsOpen && (
        <div className="modal-backdrop tag-modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTagSettingsOpen(false); }}>
          <section className="modal tag-settings-modal" role="dialog" aria-modal="true" aria-labelledby="tag-modal-title">
            <header><div><p className="section-kicker">CUSTOM LABELS</p><h2 id="tag-modal-title">标签设置</h2></div><button className="modal-close" onClick={() => setTagSettingsOpen(false)} aria-label="关闭">×</button></header>
            <div className="tag-settings-body">
              <p className="tag-settings-intro">只保留真正有用的分类。你可以新增、重命名、换颜色或删除标签；删除后会同步从相关订阅中移除。</p>
              <div className="tag-manager-list">
                {tagDraft.map((tag, index) => (
                  <div className="tag-manager-row" key={tag.id}>
                    <span className="tag-preview-dot" style={{ background: tag.color }} />
                    <input value={tag.name} maxLength={16} aria-label={`标签 ${index + 1} 名称`} onChange={(event) => setTagDraft((current) => current.map((item) => item.id === tag.id ? { ...item, name: event.target.value } : item))} />
                    <div className="color-choices" aria-label="标签颜色">
                      {tagColors.map((palette) => <button type="button" key={palette.color} className={tag.color === palette.color ? "selected" : ""} style={{ background: palette.color }} aria-label={`选择颜色 ${palette.color}`} onClick={() => setTagDraft((current) => current.map((item) => item.id === tag.id ? { ...item, ...palette } : item))} />)}
                    </div>
                    <button type="button" className="remove-tag-button" onClick={() => setTagDraft((current) => current.filter((item) => item.id !== tag.id))} aria-label={`删除标签 ${tag.name}`}>×</button>
                  </div>
                ))}
                {!tagDraft.length && <div className="empty-tags"><strong>当前没有标签</strong><p>完全不使用标签也没问题。</p></div>}
              </div>
              <button type="button" className="add-tag-button" onClick={addTagDraft}>＋ 新增标签</button>
              {tagError && <p className="tag-error" role="alert">{tagError}</p>}
              <footer><button type="button" className="secondary-button" onClick={() => setTagSettingsOpen(false)}>取消</button><button type="button" className="primary-button" onClick={saveTagSettings}>保存设置</button></footer>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </div>
  );
}
