import { type ExchangeRateSnapshot, type WorkspaceState } from "@/lib/domain";
import { daysUntil, lifecycleEvents, monthlyEquivalent, nextEntitlementDate, workspaceSummary } from "@/lib/metrics";

type Props = {
  state: WorkspaceState;
  exchangeRates: ExchangeRateSnapshot;
  onOpenItem: (id: string) => void;
  onShowServices: () => void;
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" });

function formatDate(value?: string) {
  if (!value) return "未设置";
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(value);
}

function dateHint(value?: string) {
  const days = daysUntil(value);
  if (days === null) return "";
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return "今天";
  return `${days} 天后`;
}

export function DashboardView({ state, exchangeRates, onOpenItem, onShowServices }: Props) {
  const summary = workspaceSummary(state, exchangeRates.rates);
  const providerMap = new Map(state.providers.map((provider) => [provider.id, provider]));
  const itemMap = new Map(state.catalog.map((item) => [item.id, item]));
  const urgent = lifecycleEvents(state).slice(0, 6).map((event) => ({ ...event, item: event.itemId ? itemMap.get(event.itemId) : undefined }));
  const activeSubscriptions = state.entitlements.filter((entry) => !["paused", "expired", "cancelled"].includes(entry.status || "active")).length;
  const subscriptions = [...state.entitlements]
    .sort((left, right) => (nextEntitlementDate(left) || "9999").localeCompare(nextEntitlementDate(right) || "9999"))
    .slice(0, 8);

  return (
    <div className="view-stack">
      <section className="summary-grid" aria-label="关键指标">
        <article className="metric-card metric-primary"><span>有效订阅</span><strong>{activeSubscriptions}</strong><small>{summary.trial} 项仍在试用</small></article>
        <article className="metric-card"><span>每月固定成本</span><strong>{formatCurrency(summary.monthlyCost)}</strong><small>{summary.unpricedRecurring ? `${summary.unpricedRecurring} 项费用待补充` : `按 ${exchangeRates.rateDate} 汇率估算`}</small></article>
        <article className={`metric-card ${summary.upcoming ? "metric-warning" : ""}`}><span>30 天内续费或到期</span><strong>{summary.upcoming}</strong><small>订阅与资产日期合并提醒</small></article>
        <article className={`metric-card ${summary.pendingInvoices || summary.attentionAssets ? "metric-warning" : ""}`}><span>待处理</span><strong>{summary.pendingInvoices + summary.attentionAssets}</strong><small>{summary.pendingInvoices} 张待开票 · {summary.attentionAssets} 项资产待关注</small></article>
      </section>

      <section className="panel urgency-panel">
        <header className="panel-header"><div><span className="kicker">UPCOMING</span><h2>近期续费与到期</h2></div><span>{urgent.length} 项</span></header>
        <div className="urgent-list urgent-grid">
          {urgent.map(({ id, item, label, date, days, kind }) => (
            <button key={id} onClick={() => item && onOpenItem(item.id)}>
              <time><b>{formatDate(date)}</b><small>{days === 0 ? "今天" : `${days} 天后`}</small></time>
              <span className="urgent-main"><strong>{item?.name || label}</strong><small>{label} · {kind === "renewal" ? "续费" : kind === "asset_expiry" ? "资产到期" : "订阅到期"}</small></span>
              <span className={`urgency-dot ${days <= 14 ? "hot" : ""}`} />
            </button>
          ))}
          {!urgent.length && <div className="empty-block">还没有近期续费或到期事项。</div>}
        </div>
      </section>

      <section className="panel subscription-preview">
        <header className="panel-header"><div><span className="kicker">SUBSCRIPTIONS</span><h2>订阅一览</h2></div><button className="text-button" onClick={onShowServices}>查看全部服务 →</button></header>
        <div className="subscription-preview-head"><span>服务 / 方案</span><span>费用</span><span>到期 / 下次续费</span></div>
        <div className="subscription-preview-body">
          {subscriptions.map((entitlement) => {
            const item = itemMap.get(entitlement.itemId);
            const provider = item ? providerMap.get(item.providerId) : undefined;
            const equivalent = monthlyEquivalent(entitlement, exchangeRates.rates);
            const nextDate = nextEntitlementDate(entitlement);
            return (
              <button className="subscription-preview-row" key={entitlement.id} onClick={() => item && onOpenItem(item.id)}>
                <span className="product-cell"><i>{provider?.name.slice(0, 2) || "AI"}</i><span><strong>{item?.name || "未知服务"}</strong><small>{entitlement.label}</small></span></span>
                <span><b>{entitlement.amount === null ? "待补充" : `${entitlement.currency} ${entitlement.amount}`}</b><small>{equivalent && equivalent > 0 ? `月均约 ¥${equivalent.toFixed(0)}` : "非固定月费"}</small></span>
                <span><b>{nextDate || "未设置"}</b><small>{dateHint(nextDate)}</small></span>
              </button>
            );
          })}
          {!subscriptions.length && <div className="empty-block">还没有订阅。可以直接在上方用一句话录入。</div>}
        </div>
      </section>
    </div>
  );
}
