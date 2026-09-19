import { type Entitlement, type ExchangeRateSnapshot, type WorkspaceState } from "@/lib/domain";
import { daysUntil, monthlyEquivalent, nextEntitlementDate } from "@/lib/metrics";

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

const statusLabels = { active: "有效", trial: "试用中", paused: "已暂停", expired: "已到期", cancelled: "已取消" } as const;

function money(value: number | null, currency: string) {
  if (value === null) return "金额待补充";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function dateStatus(value?: string) {
  const days = daysUntil(value);
  if (!value || days === null) return { value: "未设置", hint: "", warning: false };
  if (days < 0) return { value, hint: `已过期 ${Math.abs(days)} 天`, warning: true };
  if (days === 0) return { value, hint: "今天", warning: true };
  return { value, hint: `${days} 天后`, warning: days <= 30 };
}

export function EntitlementsView({ state, search, exchangeRates, onOpenItem, onAdd, onEdit }: {
  state: WorkspaceState;
  search: string;
  exchangeRates: ExchangeRateSnapshot;
  onOpenItem: (id: string) => void;
  onAdd: () => void;
  onEdit: (id: string) => void;
}) {
  const itemMap = new Map(state.catalog.map((item) => [item.id, item]));
  const providerMap = new Map(state.providers.map((provider) => [provider.id, provider]));
  const query = search.trim().toLocaleLowerCase();
  const entries = [...state.entitlements]
    .filter((entitlement) => {
      if (!query) return true;
      const item = itemMap.get(entitlement.itemId);
      const provider = item ? providerMap.get(item.providerId) : undefined;
      return [provider?.name, item?.name, entitlement.label, entitlement.channel, ...(entitlement.tags || [])]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(query));
    })
    .sort((left, right) => (nextEntitlementDate(left) || "9999").localeCompare(nextEntitlementDate(right) || "9999"));

  return (
    <div className="view-stack">
      <section className="section-intro"><div><span className="kicker">SUBSCRIPTIONS</span><h2>我的订阅</h2><p>服务、费用、下次续费和权益到期集中在一张表里。平时优先用首页的一句话录入，这里也可以手工补充或修改。</p></div><button className="primary-button" onClick={onAdd}>＋ 手工添加</button></section>
      <section className="panel entitlement-table">
        <div className="entitlement-head"><span>服务 / 方案</span><span>状态</span><span>费用</span><span>下次续费</span><span>权益到期</span></div>
        {entries.map((entitlement) => {
          const item = itemMap.get(entitlement.itemId);
          const provider = item ? providerMap.get(item.providerId) : undefined;
          const equivalent = monthlyEquivalent(entitlement, exchangeRates.rates);
          const renewal = dateStatus(entitlement.renewsAt);
          const expiry = dateStatus(entitlement.expiresAt);
          return (
            <article className="entitlement-row" key={entitlement.id}>
              <button className="product-cell record-link" onClick={() => item && onOpenItem(item.id)}><i>{provider?.name.slice(0, 2) || "AI"}</i><span><strong>{item?.name || "未知服务"}</strong><small>{entitlement.label}{provider?.name ? ` · ${provider.name}` : ""}</small></span></button>
              <span><b>{statusLabels[entitlement.status || "active"]}</b><small>{billingLabels[entitlement.billingMode]} · {entitlement.autoRenew ? "自动续费" : "手动续费"}</small><button className="record-edit" onClick={() => onEdit(entitlement.id)}>编辑</button></span>
              <span><b>{money(entitlement.amount, entitlement.currency)}</b><small>{entitlement.billingCycle === "yearly" ? "年付" : entitlement.billingCycle === "monthly" ? "月付" : "非固定周期"}{equivalent && equivalent > 0 ? ` · 月均约 ¥${equivalent.toFixed(0)}` : ""}</small></span>
              <span className={renewal.warning ? "date-warning" : ""}><b>{renewal.value}</b><small>{renewal.hint}</small></span>
              <span className={expiry.warning ? "date-warning" : ""}><b>{expiry.value}</b><small>{expiry.hint}</small></span>
            </article>
          );
        })}
        {!entries.length && <div className="empty-block">{query ? `没有找到与“${search.trim()}”相关的订阅。` : "还没有订阅。回到总览，用一句话就能完成录入。"}</div>}
      </section>
    </div>
  );
}
