"use client";

import { useState } from "react";
import { AdoptionBadge } from "./status-badge";
import { roleLabels, type Entitlement, type WorkspaceState } from "@/lib/domain";
import { daysUntil } from "@/lib/metrics";

type Filter = "all" | "subscribed" | "unsubscribed";

const inactiveStatuses = new Set(["paused", "expired", "cancelled"]);

function currentEntitlements(entitlements: Entitlement[]) {
  return entitlements.filter((entry) => !inactiveStatuses.has(entry.status || "active"));
}

function commercialStatus(entitlements: Entitlement[]) {
  const current = currentEntitlements(entitlements);
  if (!current.length) {
    if (entitlements.some((entry) => entry.status === "expired")) return { key: "expired", label: "已到期" };
    if (entitlements.some((entry) => entry.status === "paused")) return { key: "paused", label: "已暂停" };
    return { key: "none", label: "未订阅" };
  }
  const modes = new Set(current.map((entry) => entry.billingMode));
  if (modes.has("trial")) return { key: "trial", label: "试用中" };
  if (modes.has("subscription") || modes.has("hybrid") || modes.has("self_hosted")) return { key: "subscribed", label: "已订阅" };
  if (modes.has("pay_as_you_go")) return { key: "metered", label: "按量使用" };
  if (modes.has("token_pack")) return { key: "pack", label: "Token 包" };
  if (modes.has("free")) return { key: "free", label: "免费使用" };
  if (modes.has("bundled")) return { key: "bundled", label: "套餐内含" };
  if (modes.has("one_time")) return { key: "purchased", label: "已购买" };
  return { key: "subscribed", label: "已有记录" };
}

function relevantDate(entitlements: Entitlement[]) {
  const values = entitlements.flatMap((entry) => [entry.renewsAt, entry.expiresAt]).filter((value): value is string => Boolean(value)).sort();
  return values.find((value) => (daysUntil(value) ?? -1) >= 0) || values.at(-1);
}

function dateStatus(value?: string) {
  const days = daysUntil(value);
  if (!value || days === null) return { value: "—", hint: "", warning: false };
  if (days < 0) return { value, hint: `已过期 ${Math.abs(days)} 天`, warning: true };
  if (days === 0) return { value, hint: "今天", warning: true };
  return { value, hint: `${days} 天后`, warning: days <= 30 };
}

export function ServicesView({ state, search, onOpenItem, onAddService, onAddSubscription, onEditItem }: {
  state: WorkspaceState;
  search: string;
  onOpenItem: (id: string) => void;
  onAddService: () => void;
  onAddSubscription: () => void;
  onEditItem: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const providerMap = new Map(state.providers.map((provider) => [provider.id, provider]));
  const entitlementsByItem = new Map<string, Entitlement[]>();
  for (const entitlement of state.entitlements) {
    const entries = entitlementsByItem.get(entitlement.itemId) || [];
    entries.push(entitlement);
    entitlementsByItem.set(entitlement.itemId, entries);
  }
  const subscribedCount = state.catalog.filter((item) => currentEntitlements(entitlementsByItem.get(item.id) || []).length > 0).length;
  const query = search.trim().toLocaleLowerCase();
  const entries = [...state.catalog]
    .filter((item) => {
      const entitlements = entitlementsByItem.get(item.id) || [];
      const hasCurrent = currentEntitlements(entitlements).length > 0;
      if (filter === "subscribed" && !hasCurrent) return false;
      if (filter === "unsubscribed" && hasCurrent) return false;
      if (!query) return true;
      const provider = providerMap.get(item.providerId);
      return [item.name, provider?.name, ...item.roles.map((role) => roleLabels[role]), ...entitlements.map((entry) => entry.label)]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(query));
    })
    .sort((left, right) => {
      const leftSubscribed = currentEntitlements(entitlementsByItem.get(left.id) || []).length > 0 ? 0 : 1;
      const rightSubscribed = currentEntitlements(entitlementsByItem.get(right.id) || []).length > 0 ? 0 : 1;
      return leftSubscribed - rightSubscribed || left.name.localeCompare(right.name, "zh-CN");
    });

  return <div className="view-stack">
    <section className="section-intro"><div><span className="kicker">SERVICES</span><h2>我的服务</h2><p>这里既包括 Codex、Qoder 这样的已订阅服务，也包括 Kimi 这样的未订阅工具。服务类型和订阅状态分别记录，互不混淆。</p></div><span className="section-actions-inline"><button className="secondary-button" onClick={onAddSubscription}>添加订阅</button><button className="primary-button" onClick={onAddService}>＋ 添加服务</button></span></section>
    <nav className="filter-bar" aria-label="服务筛选">
      <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部服务 <b>{state.catalog.length}</b></button>
      <button className={filter === "subscribed" ? "active" : ""} onClick={() => setFilter("subscribed")}>有有效订阅 <b>{subscribedCount}</b></button>
      <button className={filter === "unsubscribed" ? "active" : ""} onClick={() => setFilter("unsubscribed")}>无有效订阅 <b>{state.catalog.length - subscribedCount}</b></button>
    </nav>
    <section className="panel service-table">
      <div className="service-head"><span>服务 / 厂商</span><span>服务类型</span><span>使用状态</span><span>订阅状态</span><span>到期 / 下次续费</span></div>
      {entries.map((item) => {
        const provider = providerMap.get(item.providerId);
        const entitlements = entitlementsByItem.get(item.id) || [];
        const current = currentEntitlements(entitlements);
        const commercial = commercialStatus(entitlements);
        const nextDate = dateStatus(relevantDate(current));
        return <article className="service-row" key={item.id}>
          <button className="product-cell record-link" onClick={() => onOpenItem(item.id)}><i>{provider?.name.slice(0, 2) || "AI"}</i><span><strong>{item.name}</strong><small>{provider?.name || "服务商待补充"}</small></span></button>
          <span className="role-cell">{item.roles.slice(0, 2).map((role) => <em key={role}>{roleLabels[role]}</em>)}</span>
          <span><AdoptionBadge status={item.adoptionStatus} /><button className="record-edit" onClick={() => onEditItem(item.id)}>编辑服务</button></span>
          <span><em className={`commercial-status commercial-${commercial.key}`}>{commercial.label}</em><small>{entitlements.map((entry) => entry.label).join("、") || "只记录服务，不生成费用"}</small></span>
          <span className={nextDate.warning ? "date-warning" : ""}><b>{nextDate.value}</b><small>{nextDate.hint}</small></span>
        </article>;
      })}
      {!entries.length && <div className="empty-block">{query ? `没有找到与“${search.trim()}”相关的服务。` : "这个分类里还没有服务。"}</div>}
    </section>
  </div>;
}
