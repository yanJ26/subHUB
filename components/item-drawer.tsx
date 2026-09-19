import { AdoptionBadge } from "./status-badge";
import { roleLabels, type Asset, type Entitlement, type WorkspaceState } from "@/lib/domain";
import { nextEntitlementDate } from "@/lib/metrics";

const billingLabels: Record<Entitlement["billingMode"], string> = {
  subscription: "订阅",
  token_pack: "Token 包",
  pay_as_you_go: "按量计费",
  free: "免费",
  trial: "试用",
  self_hosted: "自托管",
  hybrid: "混合费用",
  bundled: "套餐内含",
  one_time: "一次性购买",
};

const assetKindLabels: Record<Asset["kind"], string> = {
  domain: "域名", device: "设备", server: "服务器", account: "账号", repository: "代码仓库", website: "网站", workflow: "工作流", other: "其他",
};

function amount(entitlement: Entitlement) {
  if (entitlement.amount === null) return "金额待补充";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: entitlement.currency, maximumFractionDigits: 2 }).format(entitlement.amount);
}

export function ItemDrawer({ state, itemId, onClose, onEditItem, onAddEntitlement, onEditEntitlement, onAddAsset, onEditAsset }: {
  state: WorkspaceState;
  itemId: string | null;
  onClose: () => void;
  onEditItem: (id: string) => void;
  onAddEntitlement: () => void;
  onEditEntitlement: (id: string) => void;
  onAddAsset: () => void;
  onEditAsset: (id: string) => void;
}) {
  const item = state.catalog.find((entry) => entry.id === itemId);
  if (!item) return null;
  const provider = state.providers.find((entry) => entry.id === item.providerId);
  const entitlements = state.entitlements.filter((entry) => entry.itemId === item.id);
  const entitlementIds = new Set(entitlements.map((entry) => entry.id));
  const invoices = state.invoices.filter((entry) => entitlementIds.has(entry.entitlementId));
  const assets = state.assets.filter((entry) => entry.itemId === item.id);

  return <><button className="drawer-backdrop" aria-label="关闭详情" onClick={onClose} /><aside className="item-drawer" aria-label={`${item.name} 详情`}>
    <header><span className="provider-avatar large">{provider?.name.slice(0, 2) || "AI"}</span><div><small>{provider?.name}</small><h2>{item.name}</h2></div><button className="record-edit" onClick={() => onEditItem(item.id)}>编辑服务</button><button className="close-button" onClick={onClose}>×</button></header>
    {item.description && <p className="drawer-description">{item.description}</p>}
    <div className="drawer-badges"><AdoptionBadge status={item.adoptionStatus} />{item.roles.map((role) => <em key={role}>{roleLabels[role]}</em>)}</div>
    {item.models.length > 0 && <section><header><h3>可用模型</h3></header><div className="pill-box">{item.models.map((model) => <span key={model}>{model}</span>)}</div></section>}
    <section><header><h3>订阅</h3><button onClick={onAddEntitlement}>＋ 添加</button></header>{entitlements.map((entitlement) => <article className="drawer-record" key={entitlement.id}><strong>{entitlement.label}</strong><small>{billingLabels[entitlement.billingMode]} · {amount(entitlement)}{entitlement.channel ? ` · ${entitlement.channel}` : ""}</small><div className="drawer-date-pair"><span><b>到期 / 下次续费</b><small>{nextEntitlementDate(entitlement) || "未设置"}</small></span></div>{(entitlement.tags || []).length > 0 && <div className="pill-box">{entitlement.tags?.map((tag) => <span key={tag}>{tag}</span>)}</div>}<footer><button className="record-edit" onClick={() => onEditEntitlement(entitlement.id)}>编辑订阅</button></footer></article>)}{!entitlements.length && <div className="empty-block">当前没有订阅记录。</div>}</section>
    {invoices.length > 0 && <section><header><h3>发票</h3></header>{invoices.map((invoice) => <article className="drawer-record" key={invoice.id}><strong>{invoice.status === "pending" ? "待开票" : invoice.status === "issued" ? "已开票" : invoice.status === "reimbursed" ? "已报销" : invoice.status === "paid" ? "已支付" : "无发票"}</strong><small>{invoice.number || "未填写发票号码"}{invoice.url ? " · 已登记文件链接" : ""}</small></article>)}</section>}
    <section><header><h3>关联资产</h3><button onClick={onAddAsset}>＋ 添加</button></header><div className="pill-box">{assets.map((asset) => <button className="pill-action" key={asset.id} onClick={() => onEditAsset(asset.id)}>{asset.name} · {assetKindLabels[asset.kind]}</button>)}{!assets.length && <small>尚未关联资产</small>}</div></section>
  </aside></>;
}
