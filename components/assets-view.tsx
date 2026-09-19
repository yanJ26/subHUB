import type { Asset, WorkspaceState } from "@/lib/domain";
import { daysUntil } from "@/lib/metrics";

const kindLabels: Record<Asset["kind"], string> = {
  domain: "域名",
  device: "设备",
  server: "服务器",
  account: "账号",
  repository: "代码仓库",
  website: "网站",
  workflow: "工作流",
  other: "其他",
};

const statusLabels: Record<Asset["status"], string> = {
  active: "正常",
  attention: "待关注",
  offline: "离线",
  expired: "已到期",
  retired: "已退役",
  unknown: "待确认",
};

function lifecycle(asset: Asset) {
  if (!asset.expiresAt) return "未设置到期日";
  const days = daysUntil(asset.expiresAt);
  if (days === null) return asset.expiresAt;
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return "今天到期";
  return `${days} 天后到期`;
}

export function AssetsView({ state, onOpenItem, onAdd, onEditAsset }: {
  state: WorkspaceState;
  onOpenItem: (id: string) => void;
  onAdd: () => void;
  onEditAsset: (id: string) => void;
}) {
  const itemMap = new Map(state.catalog.map((item) => [item.id, item]));
  const domains = state.assets.filter((asset) => asset.kind === "domain");
  const otherAssets = state.assets.filter((asset) => asset.kind !== "domain");
  const expiring = state.assets.filter((asset) => {
    const days = daysUntil(asset.expiresAt);
    return days !== null && days >= 0 && days <= 30;
  }).length;
  const attention = state.assets.filter((asset) => ["attention", "offline", "expired", "unknown"].includes(asset.status)).length;

  return (
    <div className="view-stack">
      <section className="section-intro">
        <div><span className="kicker">ASSETS</span><h2>我的数字资产</h2><p>集中记录域名、设备、服务器、账号、代码仓库和网站，以及需要关注的状态和到期日期。</p></div>
        <button className="primary-button" onClick={onAdd}>＋ 添加资产</button>
      </section>

      <section className="asset-summary-grid">
        <article className="metric-card metric-primary"><span>域名</span><strong>{domains.length}</strong><small>登记在册的域名</small></article>
        <article className="metric-card"><span>其他资产</span><strong>{otherAssets.length}</strong><small>设备、服务器、账号与站点</small></article>
        <article className={`metric-card ${expiring ? "metric-warning" : ""}`}><span>30 天内到期</span><strong>{expiring}</strong><small>需要确认续费安排</small></article>
        <article className={`metric-card ${attention ? "metric-warning" : ""}`}><span>待关注</span><strong>{attention}</strong><small>异常、离线、到期或待确认</small></article>
      </section>

      <section className="panel">
        <header className="panel-header"><div><span className="kicker">DOMAINS</span><h2>域名</h2></div><span>{domains.length} 个</span></header>
        <div className="asset-table asset-domain-table">
          <div className="asset-head"><span>域名</span><span>注册商</span><span>到期</span><span>续费</span><span>关联服务</span></div>
          {domains.map((asset) => {
            const item = asset.itemId ? itemMap.get(asset.itemId) : undefined;
            const days = daysUntil(asset.expiresAt);
            return <article className="asset-row" key={asset.id}>
              <span><strong>{asset.domainName || asset.name}</strong><small>{asset.notes || "域名资产"}</small></span>
              <span><b>{asset.registrar || "待补充"}</b><small>{statusLabels[asset.status]}</small></span>
              <span className={(days ?? 999) <= 30 ? "date-warning" : ""}><b>{asset.expiresAt || "未设置"}</b><small>{lifecycle(asset)}</small></span>
              <span><b>{asset.autoRenew ? "自动续费" : "手动续费"}</b><small>{asset.autoRenew === undefined ? "状态待确认" : ""}</small></span>
              <span>{item ? <button className="record-link compact" onClick={() => onOpenItem(item.id)}><b>{item.name}</b></button> : <b>未关联服务</b>}<small>{asset.url || ""}</small><button className="record-edit" onClick={() => onEditAsset(asset.id)}>编辑</button></span>
            </article>;
          })}
          {!domains.length && <div className="empty-block">还没有域名资产。</div>}
        </div>
      </section>

      <section className="panel">
        <header className="panel-header"><div><span className="kicker">OTHER ASSETS</span><h2>其他资产</h2></div><span>{otherAssets.length} 项</span></header>
        <div className="asset-card-list">
          {otherAssets.map((asset) => <article key={asset.id}>
            <span className="asset-kind">{kindLabels[asset.kind]}</span>
            <div><strong>{asset.name}</strong><small>{[asset.deviceType, asset.os, asset.location].filter(Boolean).join(" · ") || asset.description || asset.url || "详情待补充"}</small></div>
            <span className="record-actions"><em className={`asset-status status-${asset.status}`}>{statusLabels[asset.status]}</em><button className="record-edit" onClick={() => onEditAsset(asset.id)}>编辑</button></span>
          </article>)}
          {!otherAssets.length && <div className="empty-block">还没有其他资产。</div>}
        </div>
      </section>
    </div>
  );
}
