import { AdoptionBadge, RecommendationBadge } from "./status-badge";
import { adoptionLabels, roleLabels, type AdoptionStatus, type ExchangeRateSnapshot, type WorkspaceState } from "@/lib/domain";
import { latestEvaluation, lifecycleEvents, workspaceSummary } from "@/lib/metrics";

type Props = {
  state: WorkspaceState;
  exchangeRates: ExchangeRateSnapshot;
  onOpenItem: (id: string) => void;
  onShowCatalog: () => void;
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" });

function formatDate(value?: string) {
  if (!value) return "未设置";
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(value);
}

export function DashboardView({ state, exchangeRates, onOpenItem, onShowCatalog }: Props) {
  const summary = workspaceSummary(state, exchangeRates.rates);
  const providerMap = new Map(state.providers.map((provider) => [provider.id, provider]));
  const itemMap = new Map(state.catalog.map((item) => [item.id, item]));
  const urgent = lifecycleEvents(state).slice(0, 5).map((event) => ({ ...event, item: event.itemId ? itemMap.get(event.itemId) : undefined }));
  const attention = state.catalog
    .map((item) => ({ item, evaluation: latestEvaluation(item.id, state.evaluations) }))
    .filter(({ evaluation }) => evaluation && ["observe", "downgrade", "pause", "stop", "upgrade"].includes(evaluation.recommendation))
    .slice(0, 4);
  const firstRows = [...state.catalog].sort((left, right) => {
    const order: AdoptionStatus[] = ["active", "trial", "considering", "unused", "paused", "retired"];
    return order.indexOf(left.adoptionStatus) - order.indexOf(right.adoptionStatus) || left.name.localeCompare(right.name);
  }).slice(0, 8);

  return (
    <div className="view-stack">
      <section className="summary-grid" aria-label="关键指标">
        <article className="metric-card metric-primary"><span>正在使用</span><strong>{summary.active}</strong><small>{state.assets.length} 项数字资产已登记</small></article>
        <article className="metric-card"><span>月度等价固定成本</span><strong>{formatCurrency(summary.monthlyCost)}</strong><small>{summary.unpricedRecurring ? `${summary.unpricedRecurring} 项周期费用未计价` : `${exchangeRates.rateDate} · ${exchangeRates.source}`}</small></article>
        <article className={`metric-card ${summary.upcoming ? "metric-warning" : ""}`}><span>30 天内续费或到期</span><strong>{summary.upcoming}</strong><small>{summary.trial} 项仍在试用</small></article>
        <article className={`metric-card ${summary.pendingInvoices || summary.attentionAssets ? "metric-warning" : ""}`}><span>待处理事项</span><strong>{summary.pendingInvoices + summary.attentionAssets}</strong><small>{summary.pendingInvoices} 张待开发票 · {summary.attentionAssets} 项资产异常</small></article>
      </section>

      <section className="dashboard-split">
        <article className="panel urgency-panel">
          <header className="panel-header"><div><span className="kicker">RENEWAL & EXPIRY</span><h2>近期续费与到期</h2></div><span>{urgent.length} 项有日期</span></header>
          <div className="urgent-list">
            {urgent.map(({ id, item, label, date, days, kind }) => (
              <button key={id} onClick={() => item && onOpenItem(item.id)}>
                <time><b>{formatDate(date)}</b><small>{days !== null && days < 0 ? `已过期 ${Math.abs(days)} 天` : days === 0 ? "今天" : `${days} 天后`}</small></time>
                <span className="urgent-main"><strong>{item?.name || label}</strong><small>{label} · {kind === "renewal" ? "续费" : kind === "asset_expiry" ? "资产到期" : "权益到期"}</small></span>
                <span className={`urgency-dot ${(days ?? 99) <= 14 ? "hot" : ""}`} />
              </button>
            ))}
            {!urgent.length && <div className="empty-block">还没有续费或到期日期。</div>}
          </div>
        </article>

        <article className="panel attention-panel">
          <header className="panel-header"><div><span className="kicker">DECISION QUEUE</span><h2>需要关注</h2></div><span>近似评价</span></header>
          <div className="attention-list">
            {attention.map(({ item, evaluation }) => evaluation && (
              <button key={item.id} onClick={() => onOpenItem(item.id)}>
                <span className="provider-avatar">{providerMap.get(item.providerId)?.name.slice(0, 1) || "AI"}</span>
                <span><strong>{item.name}</strong><small>{evaluation.note || `使用趋势：${evaluation.trend}`}</small></span>
                <RecommendationBadge recommendation={evaluation.recommendation} />
              </button>
            ))}
            {!attention.length && <div className="empty-block">当前没有需要处理的项目。</div>}
          </div>
        </article>
      </section>

      <section className="panel catalog-preview">
        <header className="panel-header"><div><span className="kicker">COMPLETE CATALOG</span><h2>全部产品与服务</h2></div><button className="text-button" onClick={onShowCatalog}>查看完整目录 →</button></header>
        <div className="directory-head"><span>厂商 / 产品</span><span>角色</span><span>可用模型</span><span>个人状态</span><span>利用与产出</span></div>
        <div className="directory-body">
          {firstRows.map((item) => {
            const evaluation = latestEvaluation(item.id, state.evaluations);
            return (
              <button className={item.adoptionStatus === "unused" ? "directory-row muted" : "directory-row"} key={item.id} onClick={() => onOpenItem(item.id)}>
                <span className="product-cell"><i>{providerMap.get(item.providerId)?.name.slice(0, 2) || "AI"}</i><span><strong>{item.name}</strong><small>{providerMap.get(item.providerId)?.name}</small></span></span>
                <span className="role-cell">{item.roles.slice(0, 3).map((role) => <em key={role}>{roleLabels[role]}</em>)}</span>
                <span className="model-cell">{item.models.join("、") || "待补充"}</span>
                <span><AdoptionBadge status={item.adoptionStatus} /></span>
                <span className="evaluation-cell">{evaluation ? <><b>{evaluation.utilization === "high" ? "高利用" : evaluation.utilization === "low" ? "低利用" : "正常利用"}</b><small>{evaluation.outputValue === "core" ? "核心产出" : evaluation.outputValue === "good" ? "产出良好" : "继续观察"}</small></> : <small>{adoptionLabels[item.adoptionStatus]}</small>}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
