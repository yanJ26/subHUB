import { type ExchangeRateSnapshot, type WorkspaceState } from "@/lib/domain";
import { daysUntil, monthlyEquivalent, nextEntitlementDate } from "@/lib/metrics";

const billingLabels = {
  subscription: "订阅",
  token_pack: "Token Plan",
  pay_as_you_go: "按量计费",
  free: "免费",
  trial: "试用",
  self_hosted: "自托管",
  hybrid: "混合费用",
  bundled: "套餐内含",
  one_time: "一次性购买",
};

function money(value: number | null, currency: string) {
  if (value === null) return "金额待核对";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

export function EntitlementsView({ state, exchangeRates, onOpenItem, onAdd, onEdit }: { state: WorkspaceState; exchangeRates: ExchangeRateSnapshot; onOpenItem: (id: string) => void; onAdd: () => void; onEdit: (id: string) => void }) {
  const itemMap = new Map(state.catalog.map((item) => [item.id, item]));
  const providerMap = new Map(state.providers.map((provider) => [provider.id, provider]));
  const entries = [...state.entitlements].sort((left, right) => (nextEntitlementDate(left) || "9999").localeCompare(nextEntitlementDate(right) || "9999"));
  return (
    <div className="view-stack">
      <section className="section-intro"><div><span className="kicker">SINGLE SOURCE OF TRUTH</span><h2>使用权益</h2><p>日常订阅可一次填写服务、方案、费用、续费和到期；资产、部署和使用关系需要时再补充。</p></div><button className="primary-button" onClick={onAdd}>＋ 添加订阅</button></section>
      <section className="panel entitlement-table">
        <div className="entitlement-head"><span>产品 / 权益</span><span>计费方式</span><span>原始金额</span><span>月度等价</span><span>续费或到期</span><span>使用位置</span></div>
        {entries.map((entitlement) => {
          const item = itemMap.get(entitlement.itemId);
          const provider = item ? providerMap.get(item.providerId) : null;
          const links = state.usageLinks.filter((link) => link.entitlementId === entitlement.id);
          const nextDate = nextEntitlementDate(entitlement);
          const days = daysUntil(nextDate);
          const equivalent = monthlyEquivalent(entitlement, exchangeRates.rates);
          return (
            <article className="entitlement-row" key={entitlement.id}>
              <button className="product-cell record-link" onClick={() => item && onOpenItem(item.id)}><i>{provider?.name.slice(0, 2) || "AI"}</i><span><strong>{item?.name || "未知产品"}</strong><small>{entitlement.label}</small></span></button>
              <span><b>{billingLabels[entitlement.billingMode]}</b><small>{entitlement.autoRenew ? "自动续费" : "非自动续费"}</small></span>
              <span><b>{money(entitlement.amount, entitlement.currency)}</b><small>{entitlement.billingCycle === "yearly" ? "年付" : entitlement.billingCycle === "monthly" ? "月付" : "非固定周期"}</small></span>
              <span><b>{equivalent === null ? "待估算" : equivalent === 0 ? "不计入" : `¥${equivalent.toFixed(0)}`}</b><small>{equivalent && equivalent > 0 ? `汇率日期 ${exchangeRates.rateDate}` : "非固定月度费用"}</small></span>
              <span className={(days ?? 99) <= 30 ? "date-warning" : ""}><b>{nextDate || "未设置"}</b><small>{days === null ? "" : days < 0 ? `已过期 ${Math.abs(days)} 天` : `${days} 天后`}</small></span>
              <span className="link-pills">{links.map((link) => <em key={link.id}>{link.label}</em>)}{!links.length && <small>尚未关联入口</small>}<button className="record-edit" onClick={() => onEdit(entitlement.id)}>编辑</button></span>
            </article>
          );
        })}
      </section>
    </div>
  );
}
