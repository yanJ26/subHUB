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

export function AssetsView({ state, onOpenItem, onAdd, onAddDeployment, onEditAsset, onEditDeployment }: { state: WorkspaceState; onOpenItem: (id: string) => void; onAdd: () => void; onAddDeployment: () => void; onEditAsset: (id: string) => void; onEditDeployment: (id: string) => void }) {
  const itemMap = new Map(state.catalog.map((item) => [item.id, item]));
  const assetMap = new Map(state.assets.map((asset) => [asset.id, asset]));
  const domains = state.assets.filter((asset) => asset.kind === "domain");
  const infrastructure = state.assets.filter((asset) => asset.kind !== "domain");

  return (
    <div className="view-stack">
      <section className="section-intro">
        <div>
          <span className="kicker">OWNED DIGITAL ASSETS</span>
          <h2>资产、域名与运行节点</h2>
          <p>产品是外部提供的服务，资产是你实际拥有或控制的域名、设备、服务器、账号和站点；两者通过权益与部署建立关系。</p>
        </div>
        <span className="section-actions-inline"><button className="secondary-button" onClick={onAddDeployment}>＋ 部署</button><button className="primary-button" onClick={onAdd}>＋ 添加资产</button></span>
      </section>

      <section className="asset-summary-grid">
        <article className="metric-card metric-primary"><span>域名</span><strong>{domains.length}</strong><small>{domains.filter((asset) => (daysUntil(asset.expiresAt) ?? 999) <= 30).length} 个 30 天内到期</small></article>
        <article className="metric-card"><span>设备与节点</span><strong>{infrastructure.length}</strong><small>{infrastructure.filter((asset) => asset.status === "attention").length} 个需要关注</small></article>
        <article className="metric-card"><span>部署实例</span><strong>{state.deployments.length}</strong><small>{state.deployments.filter((entry) => entry.status === "degraded").length} 个受限</small></article>
        <article className="metric-card"><span>访问入口</span><strong>{state.accessSurfaces.length}</strong><small>Web、App、API、CLI 与消息渠道</small></article>
      </section>

      <section className="panel">
        <header className="panel-header"><div><span className="kicker">DOMAIN PORTFOLIO</span><h2>域名与生命周期</h2></div><span>注册、DNS、证书与部署分开记录</span></header>
        <div className="asset-table asset-domain-table">
          <div className="asset-head"><span>域名</span><span>注册商</span><span>到期</span><span>续费</span><span>关联服务</span></div>
          {domains.map((asset) => {
            const item = asset.itemId ? itemMap.get(asset.itemId) : null;
            const days = daysUntil(asset.expiresAt);
            return <article className="asset-row" key={asset.id}>
              <span><button className="record-link compact" onClick={() => item && onOpenItem(item.id)}><strong>{asset.domainName || asset.name}</strong></button><small>{asset.notes || "域名资产"}</small></span>
              <span><b>{asset.registrar || "待补充"}</b><small>{statusLabels[asset.status]}</small></span>
              <span className={(days ?? 999) <= 30 ? "date-warning" : ""}><b>{asset.expiresAt || "未设置"}</b><small>{lifecycle(asset)}</small></span>
              <span><b>{asset.autoRenew ? "自动续费" : "手动续费"}</b><small>{asset.autoRenew === undefined ? "状态待确认" : "提前核对付款方式"}</small></span>
              <span><b>{item?.name || "未关联产品"}</b><small>{asset.url || "可继续关联 DNS 与站点"}</small><button className="record-edit" onClick={() => onEditAsset(asset.id)}>编辑</button></span>
            </article>;
          })}
          {!domains.length && <div className="empty-block">还没有域名资产。</div>}
        </div>
      </section>

      <section className="dashboard-split">
        <article className="panel">
          <header className="panel-header"><div><span className="kicker">NODES</span><h2>设备与运行节点</h2></div><span>{infrastructure.length} 项</span></header>
          <div className="asset-card-list">
            {infrastructure.map((asset) => <article key={asset.id}>
              <span className="asset-kind">{kindLabels[asset.kind]}</span>
              <div><strong>{asset.name}</strong><small>{[asset.deviceType, asset.os, asset.location].filter(Boolean).join(" · ") || asset.description || "详情待补充"}</small></div>
              <span className="record-actions"><em className={`asset-status status-${asset.status}`}>{statusLabels[asset.status]}</em><button className="record-edit" onClick={() => onEditAsset(asset.id)}>编辑</button></span>
            </article>)}
            {!infrastructure.length && <div className="empty-block">还没有设备或运行节点。</div>}
          </div>
        </article>

        <article className="panel">
          <header className="panel-header"><div><span className="kicker">DEPLOYMENTS</span><h2>部署拓扑</h2></div><span>{state.deployments.length} 个实例</span></header>
          <div className="asset-card-list">
            {state.deployments.map((deployment) => {
              const item = itemMap.get(deployment.itemId);
              const asset = assetMap.get(deployment.assetId);
              return <article key={deployment.id}>
                <span className="asset-kind">{deployment.role === "primary" ? "主力" : deployment.role === "testing" ? "测试" : "辅助"}</span>
                <div><button className="record-link compact" onClick={() => item && onOpenItem(item.id)}><strong>{deployment.name}</strong></button><small>{item?.name || "未知服务"} → {asset?.name || "未知节点"}{deployment.runtime ? ` · ${deployment.runtime}` : ""}</small></div>
                <span className="record-actions"><em className={`asset-status status-${deployment.status}`}>{deployment.status === "online" ? "在线" : deployment.status === "degraded" ? "受限" : deployment.status === "offline" ? "离线" : deployment.status === "retired" ? "已归档" : "未知"}</em><button className="record-edit" onClick={() => onEditDeployment(deployment.id)}>编辑</button></span>
              </article>;
            })}
            {!state.deployments.length && <div className="empty-block">还没有部署关系。</div>}
          </div>
        </article>
      </section>
    </div>
  );
}
