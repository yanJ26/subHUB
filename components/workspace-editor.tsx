"use client";

import { FormEvent, useMemo, useState } from "react";
import type {
  AdoptionStatus, AssetKind, AssetStatus, BillingMode, Currency, InvoiceStatus,
  ItemRole, WorkspaceState,
} from "@/lib/domain";

export type EditorKind = "catalog" | "entitlement" | "asset" | "deployment";

type Props = {
  kind: EditorKind | null;
  state: WorkspaceState;
  contextItemId?: string | null;
  onClose: () => void;
  onSave: (next: WorkspaceState, summary: string) => Promise<void>;
};

const roleOptions: Array<[ItemRole, string]> = [
  ["platform", "平台/服务"], ["api", "API"], ["model", "模型"], ["agent", "Agent"],
  ["app", "应用"], ["code", "开发工具"], ["domain", "域名"], ["hosting", "托管"],
  ["cloud", "云服务"], ["storage", "存储"], ["automation", "自动化"], ["security", "安全"], ["other", "其他"],
];

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function splitList(value: string) {
  return [...new Set(value.split(/[,，、]/).map((part) => part.trim()).filter(Boolean))];
}

export function WorkspaceEditor({ kind, state, contextItemId, onClose, onSave }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!kind) return null;

  async function submit(next: WorkspaceState, summary: string) {
    setBusy(true);
    setError("");
    try {
      await onSave(next, summary);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return <><button className="drawer-backdrop" aria-label="关闭编辑器" onClick={onClose} /><section className="snapshot-modal workspace-editor" role="dialog" aria-modal="true">
    {kind === "catalog" && <CatalogForm state={state} busy={busy} error={error} onClose={onClose} onSubmit={submit} />}
    {kind === "entitlement" && <EntitlementForm state={state} contextItemId={contextItemId} busy={busy} error={error} onClose={onClose} onSubmit={submit} />}
    {kind === "asset" && <AssetForm state={state} busy={busy} error={error} onClose={onClose} onSubmit={submit} />}
    {kind === "deployment" && <DeploymentForm state={state} contextItemId={contextItemId} busy={busy} error={error} onClose={onClose} onSubmit={submit} />}
  </section></>;
}

type FormProps = {
  state: WorkspaceState;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (next: WorkspaceState, summary: string) => Promise<void>;
};

function Header({ kicker, title, onClose }: { kicker: string; title: string; onClose: () => void }) {
  return <header><div><span className="kicker">{kicker}</span><h2>{title}</h2></div><button className="close-button" onClick={onClose}>×</button></header>;
}

function Footer({ busy, onClose, error }: { busy: boolean; onClose: () => void; error: string }) {
  return <>{error && <em>{error}</em>}<footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy}>{busy ? "保存中…" : "保存"}</button></footer></>;
}

function CatalogForm({ state, busy, error, onClose, onSubmit }: FormProps) {
  const [name, setName] = useState("");
  const [providerName, setProviderName] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState<ItemRole>("platform");
  const [status, setStatus] = useState<AdoptionStatus>("active");
  const [models, setModels] = useState("");
  const [website, setWebsite] = useState("");

  function save(event: FormEvent) {
    event.preventDefault();
    const providerLabel = providerName.trim() || name.trim();
    const existingProvider = state.providers.find((provider) => provider.name.toLocaleLowerCase() === providerLabel.toLocaleLowerCase());
    const provider = existingProvider || { id: id("provider"), name: providerLabel };
    const item = {
      id: id("item"), providerId: provider.id, name: name.trim(), description: description.trim(),
      roles: [role], models: splitList(models), adoptionStatus: status,
      ...(website.trim() ? { website: website.trim() } : {}), lastReviewedAt: new Date().toISOString().slice(0, 10),
    };
    void onSubmit({ ...state, providers: existingProvider ? state.providers : [...state.providers, provider], catalog: [...state.catalog, item] }, `Added catalog item ${item.name}`);
  }

  return <><Header kicker="CATALOG ITEM" title="添加产品或服务" onClose={onClose} /><p>先记录它是什么；费用、资产和部署关系随后分别关联。</p><form onSubmit={save}>
    <div className="form-pair"><label><span>名称 *</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>厂商 *</span><input required value={providerName} onChange={(event) => setProviderName(event.target.value)} /></label></div>
    <label><span>说明</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <div className="form-pair"><label><span>主要角色</span><select value={role} onChange={(event) => setRole(event.target.value as ItemRole)}>{roleOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>使用状态</span><select value={status} onChange={(event) => setStatus(event.target.value as AdoptionStatus)}><option value="active">正在使用</option><option value="trial">试用中</option><option value="considering">考虑中</option><option value="unused">暂未使用</option><option value="paused">已暂停</option><option value="retired">已停用</option></select></label></div>
    <label><span>模型或能力（逗号分隔）</span><input value={models} onChange={(event) => setModels(event.target.value)} /></label>
    <label><span>官网</span><input type="url" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://" /></label>
    <Footer busy={busy} onClose={onClose} error={error} />
  </form></>;
}

function EntitlementForm({ state, contextItemId, busy, error, onClose, onSubmit }: FormProps & { contextItemId?: string | null }) {
  const [itemId, setItemId] = useState(contextItemId || state.catalog[0]?.id || "");
  const [label, setLabel] = useState("");
  const [billingMode, setBillingMode] = useState<BillingMode>("subscription");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("CNY");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly" | "none">("monthly");
  const [renewsAt, setRenewsAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [autoRenew, setAutoRenew] = useState(false);
  const [channel, setChannel] = useState("");
  const [reminderDays, setReminderDays] = useState("7");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatus>("none");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceUrl, setInvoiceUrl] = useState("");

  function save(event: FormEvent) {
    event.preventDefault();
    const entitlementId = id("entitlement");
    const entitlement = {
      id: entitlementId, itemId, label: label.trim(), billingMode,
      amount: amount === "" ? null : Number(amount), currency, billingCycle, status: "active" as const,
      ...(renewsAt ? { renewsAt } : {}), ...(expiresAt ? { expiresAt } : {}), autoRenew,
      ...(channel.trim() ? { channel: channel.trim() } : {}), reminderDays: Number(reminderDays || 0),
      tags: splitList(tags), ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    const invoice = invoiceStatus === "none" && !invoiceNumber && !invoiceUrl ? null : {
      id: id("invoice"), entitlementId, status: invoiceStatus,
      ...(invoiceNumber.trim() ? { number: invoiceNumber.trim() } : {}), ...(invoiceUrl.trim() ? { url: invoiceUrl.trim() } : {}),
    };
    const next = { ...state, entitlements: [...state.entitlements, entitlement], invoices: invoice ? [...state.invoices, invoice] : state.invoices };
    void onSubmit(next, `Added entitlement ${entitlement.label}`);
  }

  return <><Header kicker="ENTITLEMENT" title="添加订阅或使用权益" onClose={onClose} /><p>权益是费用、续费和额度的唯一真相，可被多个入口或部署共享。</p><form onSubmit={save}>
    <label><span>产品或服务 *</span><select required value={itemId} onChange={(event) => setItemId(event.target.value)}>{state.catalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className="form-pair"><label><span>方案名称 *</span><input required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Plus / Pro / API PAYG" /></label><label><span>计费方式</span><select value={billingMode} onChange={(event) => setBillingMode(event.target.value as BillingMode)}><option value="subscription">订阅</option><option value="pay_as_you_go">按量</option><option value="token_pack">Token 包</option><option value="trial">试用</option><option value="free">免费</option><option value="self_hosted">自托管</option><option value="hybrid">混合</option><option value="bundled">套餐内含</option><option value="one_time">一次性购买</option></select></label></div>
    <div className="form-pair"><label><span>金额</span><span className="compound-field"><select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}><option>CNY</option><option>USD</option><option>EUR</option><option>HKD</option><option>GBP</option><option>JPY</option></select><input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></span></label><label><span>周期</span><select value={billingCycle} onChange={(event) => setBillingCycle(event.target.value as "monthly" | "yearly" | "none")}><option value="monthly">月付</option><option value="yearly">年付</option><option value="none">无固定周期</option></select></label></div>
    <div className="form-pair"><label><span>下次续费</span><input type="date" value={renewsAt} onChange={(event) => setRenewsAt(event.target.value)} /></label><label><span>权益到期</span><input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label></div>
    <div className="form-pair"><label><span>购买渠道</span><input value={channel} onChange={(event) => setChannel(event.target.value)} /></label><label><span>提前提醒天数</span><input type="number" min="0" max="365" value={reminderDays} onChange={(event) => setReminderDays(event.target.value)} /></label></div>
    <label className="editor-checkbox"><input type="checkbox" checked={autoRenew} onChange={(event) => setAutoRenew(event.target.checked)} /><span>自动续费</span></label>
    <label><span>标签（逗号分隔）</span><input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
    <div className="form-pair"><label><span>发票状态</span><select value={invoiceStatus} onChange={(event) => setInvoiceStatus(event.target.value as InvoiceStatus)}><option value="none">无需发票</option><option value="pending">待开票</option><option value="issued">已开票</option><option value="paid">已支付</option><option value="reimbursed">已报销</option></select></label><label><span>发票号码</span><input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} /></label></div>
    <label><span>发票链接</span><input type="url" value={invoiceUrl} onChange={(event) => setInvoiceUrl(event.target.value)} placeholder="https://" /></label>
    <label><span>备注</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    <Footer busy={busy} onClose={onClose} error={error} />
  </form></>;
}

function AssetForm({ state, busy, error, onClose, onSubmit }: FormProps) {
  const [kind, setKind] = useState<AssetKind>("domain");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<AssetStatus>("active");
  const [itemId, setItemId] = useState("");
  const [registrar, setRegistrar] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [autoRenew, setAutoRenew] = useState(false);
  const [deviceType, setDeviceType] = useState("");
  const [os, setOs] = useState("");
  const [location, setLocation] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");

  function save(event: FormEvent) {
    event.preventDefault();
    const asset = {
      id: id("asset"), kind, name: name.trim(), status, ...(itemId ? { itemId } : {}),
      ...(kind === "domain" ? { domainName: name.trim().toLocaleLowerCase(), registrar: registrar.trim(), expiresAt, autoRenew } : {}),
      ...(deviceType.trim() ? { deviceType: deviceType.trim() } : {}), ...(os.trim() ? { os: os.trim() } : {}),
      ...(location.trim() ? { location: location.trim() } : {}), ...(url.trim() ? { url: url.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    void onSubmit({ ...state, assets: [...state.assets, asset] }, `Added ${kind} asset ${asset.name}`);
  }

  return <><Header kicker="OWNED ASSET" title="添加数字资产" onClose={onClose} /><p>域名、设备、服务器、账号和站点是你拥有或控制的对象，不与厂商产品混为一谈。</p><form onSubmit={save}>
    <div className="form-pair"><label><span>资产类型</span><select value={kind} onChange={(event) => setKind(event.target.value as AssetKind)}><option value="domain">域名</option><option value="device">设备</option><option value="server">服务器 / VPS / NAS</option><option value="account">账号</option><option value="repository">代码仓库</option><option value="website">网站</option><option value="workflow">工作流</option><option value="other">其他</option></select></label><label><span>名称 *</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label></div>
    <div className="form-pair"><label><span>状态</span><select value={status} onChange={(event) => setStatus(event.target.value as AssetStatus)}><option value="active">正常</option><option value="attention">待关注</option><option value="offline">离线</option><option value="expired">已到期</option><option value="retired">已退役</option><option value="unknown">待确认</option></select></label><label><span>关联服务</span><select value={itemId} onChange={(event) => setItemId(event.target.value)}><option value="">暂不关联</option>{state.catalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    {kind === "domain" && <><div className="form-pair"><label><span>注册商</span><input value={registrar} onChange={(event) => setRegistrar(event.target.value)} /></label><label><span>到期日</span><input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label></div><label className="editor-checkbox"><input type="checkbox" checked={autoRenew} onChange={(event) => setAutoRenew(event.target.checked)} /><span>域名自动续费</span></label></>}
    {kind !== "domain" && <div className="form-pair"><label><span>设备/节点类型</span><input value={deviceType} onChange={(event) => setDeviceType(event.target.value)} placeholder="laptop / vps / nas" /></label><label><span>系统/平台</span><input value={os} onChange={(event) => setOs(event.target.value)} /></label></div>}
    <div className="form-pair"><label><span>位置</span><input value={location} onChange={(event) => setLocation(event.target.value)} /></label><label><span>URL</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} /></label></div>
    <label><span>备注</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    <Footer busy={busy} onClose={onClose} error={error} />
  </form></>;
}

function DeploymentForm({ state, contextItemId, busy, error, onClose, onSubmit }: FormProps & { contextItemId?: string | null }) {
  const eligibleAssets = useMemo(() => state.assets.filter((asset) => ["device", "server"].includes(asset.kind)), [state.assets]);
  const [itemId, setItemId] = useState(contextItemId || state.catalog.find((item) => item.roles.includes("agent"))?.id || state.catalog[0]?.id || "");
  const [assetId, setAssetId] = useState(eligibleAssets[0]?.id || "");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"primary" | "secondary" | "testing">("primary");
  const [status, setStatus] = useState<"online" | "degraded" | "offline" | "unknown">("online");
  const [version, setVersion] = useState("");
  const [model, setModel] = useState("");
  const [runtime, setRuntime] = useState("");
  const [installMethod, setInstallMethod] = useState("");
  const [notes, setNotes] = useState("");

  function save(event: FormEvent) {
    event.preventDefault();
    const deployment = { id: id("deployment"), itemId, assetId, name: name.trim(), role, status,
      ...(version.trim() ? { version: version.trim() } : {}), ...(model.trim() ? { model: model.trim() } : {}),
      ...(runtime.trim() ? { runtime: runtime.trim() } : {}), ...(installMethod.trim() ? { installMethod: installMethod.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}) };
    void onSubmit({ ...state, deployments: [...state.deployments, deployment] }, `Added deployment ${deployment.name}`);
  }

  return <><Header kicker="DEPLOYMENT" title="建立部署关系" onClose={onClose} /><p>记录哪个产品或 Agent 在哪台设备、服务器或云节点上运行。</p><form onSubmit={save}>
    <div className="form-pair"><label><span>产品 / Agent *</span><select required value={itemId} onChange={(event) => setItemId(event.target.value)}>{state.catalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>运行节点 *</span><select required value={assetId} onChange={(event) => setAssetId(event.target.value)}>{eligibleAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label></div>
    <label><span>实例名称 *</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>
    <div className="form-pair"><label><span>角色</span><select value={role} onChange={(event) => setRole(event.target.value as "primary" | "secondary" | "testing")}><option value="primary">主力</option><option value="secondary">辅助</option><option value="testing">测试</option></select></label><label><span>状态</span><select value={status} onChange={(event) => setStatus(event.target.value as "online" | "degraded" | "offline" | "unknown")}><option value="online">在线</option><option value="degraded">受限</option><option value="offline">离线</option><option value="unknown">未知</option></select></label></div>
    <div className="form-pair"><label><span>版本</span><input value={version} onChange={(event) => setVersion(event.target.value)} /></label><label><span>模型 / 服务</span><input value={model} onChange={(event) => setModel(event.target.value)} /></label></div>
    <div className="form-pair"><label><span>运行方式</span><input value={runtime} onChange={(event) => setRuntime(event.target.value)} placeholder="Docker / Desktop / Vendor Cloud" /></label><label><span>安装方式</span><input value={installMethod} onChange={(event) => setInstallMethod(event.target.value)} /></label></div>
    <label><span>备注</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    <Footer busy={busy} onClose={onClose} error={error} />
  </form></>;
}
