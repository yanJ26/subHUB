import { AdoptionBadge, RecommendationBadge } from "./status-badge";
import { roleLabels, type WorkspaceState } from "@/lib/domain";
import { latestEvaluation } from "@/lib/metrics";

export function ItemDrawer({ state, itemId, onClose, onAddEntitlement, onAddAsset, onAddDeployment }: { state: WorkspaceState; itemId: string | null; onClose: () => void; onAddEntitlement: () => void; onAddAsset: () => void; onAddDeployment: () => void }) {
  const item = state.catalog.find((entry) => entry.id === itemId);
  if (!item) return null;
  const provider = state.providers.find((entry) => entry.id === item.providerId);
  const entitlements = state.entitlements.filter((entry) => entry.itemId === item.id);
  const surfaces = state.accessSurfaces.filter((entry) => entry.itemId === item.id);
  const entitlementIds = new Set(entitlements.map((entry) => entry.id));
  const invoices = state.invoices.filter((entry) => entitlementIds.has(entry.entitlementId));
  const assets = state.assets.filter((entry) => entry.itemId === item.id);
  const deployments = state.deployments.filter((entry) => entry.itemId === item.id);
  const workRecords = state.workRecords.filter((entry) => entry.itemId === item.id).slice(0, 5);
  const evaluation = latestEvaluation(item.id, state.evaluations);
  return <><button className="drawer-backdrop" aria-label="关闭详情" onClick={onClose} /><aside className="item-drawer" aria-label={`${item.name} 详情`}>
    <header><span className="provider-avatar large">{provider?.name.slice(0, 2) || "AI"}</span><div><small>{provider?.name}</small><h2>{item.name}</h2></div><button className="close-button" onClick={onClose}>×</button></header>
    <p className="drawer-description">{item.description}</p>
    <div className="drawer-badges"><AdoptionBadge status={item.adoptionStatus} />{item.roles.map((role) => <em key={role}>{roleLabels[role]}</em>)}</div>
    <section><header><h3>模型与能力</h3></header><div className="pill-box">{item.models.map((model) => <span key={model}>{model}</span>)}{!item.models.length && <small>尚未补充模型能力</small>}</div></section>
    <section><header><h3>使用权益</h3><button onClick={onAddEntitlement}>＋ 添加</button></header>{entitlements.map((entitlement) => <article className="drawer-record" key={entitlement.id}><strong>{entitlement.label}</strong><small>{entitlement.billingMode} · {entitlement.renewsAt || entitlement.expiresAt || "未设置日期"}{entitlement.channel ? ` · ${entitlement.channel}` : ""}</small><div className="pill-box">{(entitlement.tags || []).map((tag) => <span key={tag}>{tag}</span>)}</div></article>)}{!entitlements.length && <div className="empty-block">当前没有购买或试用权益。</div>}</section>
    {invoices.length > 0 && <section><header><h3>发票与报销</h3></header>{invoices.map((invoice) => <article className="drawer-record" key={invoice.id}><strong>{invoice.status === "pending" ? "待开票" : invoice.status === "issued" ? "已开票" : invoice.status === "reimbursed" ? "已报销" : invoice.status}</strong><small>{invoice.number || "未填写发票号码"}{invoice.url ? " · 已登记文件链接" : ""}</small></article>)}</section>}
    <section><header><h3>资产与部署</h3><span><button onClick={onAddAsset}>＋ 资产</button><button onClick={onAddDeployment}>＋ 部署</button></span></header><div className="pill-box">{assets.map((asset) => <span key={asset.id}>{asset.name} · {asset.kind}</span>)}{deployments.map((deployment) => <span key={deployment.id}>{deployment.name} · {deployment.status}</span>)}{!assets.length && !deployments.length && <small>尚未建立资产或部署关系</small>}</div></section>
    <section><header><h3>使用入口</h3></header><div className="pill-box">{surfaces.map((surface) => <span key={surface.id}>{surface.name}{surface.device ? ` · ${surface.device}` : ""}</span>)}{!surfaces.length && <small>尚未记录使用入口</small>}</div></section>
    {workRecords.length > 0 && <section><header><h3>重要工作</h3></header>{workRecords.map((record) => <article className="drawer-record" key={record.id}><strong>{record.title}</strong><small>{record.occurredAt}{record.note ? ` · ${record.note}` : ""}</small></article>)}</section>}
    <section><header><h3>近似效率</h3><button>＋ 快照</button></header>{evaluation ? <article className="drawer-evaluation"><RecommendationBadge recommendation={evaluation.recommendation} /><p>{evaluation.note || "根据现有快照形成的近似判断。"}</p><small>{evaluation.evidenceCount} 份证据 · 约 {evaluation.observationDays} 天 · {evaluation.confidence} confidence</small></article> : <div className="empty-block">证据不足，暂不评价。</div>}</section>
  </aside></>;
}
