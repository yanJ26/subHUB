import { useMemo, useState } from "react";
import { AdoptionBadge } from "./status-badge";
import { adoptionLabels, roleLabels, type AdoptionStatus, type WorkspaceState } from "@/lib/domain";
import { latestEvaluation } from "@/lib/metrics";

type Props = {
  state: WorkspaceState;
  search: string;
  onOpenItem: (id: string) => void;
  onAdd: () => void;
};

const statusOrder: AdoptionStatus[] = ["active", "trial", "considering", "unused", "paused", "retired"];

export function CatalogView({ state, search, onOpenItem, onAdd }: Props) {
  const [filter, setFilter] = useState<AdoptionStatus | "all">("all");
  const providerMap = useMemo(() => new Map(state.providers.map((provider) => [provider.id, provider])), [state.providers]);
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return state.catalog
      .filter((item) => filter === "all" || item.adoptionStatus === filter)
      .filter((item) => !query || [item.name, item.description, providerMap.get(item.providerId)?.name, item.roles.join(" "), item.models.join(" ")].join(" ").toLocaleLowerCase().includes(query))
      .sort((left, right) => statusOrder.indexOf(left.adoptionStatus) - statusOrder.indexOf(right.adoptionStatus) || left.name.localeCompare(right.name));
  }, [filter, providerMap, search, state.catalog]);

  return (
    <div className="view-stack">
      <section className="section-intro"><div><span className="kicker">MARKET + PERSONAL STATUS</span><h2>完整目录</h2><p>目录中的“暂未使用”是明确结论，不是缺失数据。订阅、API、Agent、域名和云服务都只是可组合角色。</p></div><button className="primary-button" onClick={onAdd}>＋ 添加目录项目</button></section>
      <div className="filter-bar" role="group" aria-label="使用状态筛选">
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部 <b>{state.catalog.length}</b></button>
        {statusOrder.map((status) => <button className={filter === status ? "active" : ""} key={status} onClick={() => setFilter(status)}>{adoptionLabels[status]} <b>{state.catalog.filter((item) => item.adoptionStatus === status).length}</b></button>)}
      </div>
      <section className="catalog-grid">
        {rows.map((item) => {
          const provider = providerMap.get(item.providerId);
          const evaluation = latestEvaluation(item.id, state.evaluations);
          const entitlementCount = state.entitlements.filter((entry) => entry.itemId === item.id).length;
          const accessCount = state.accessSurfaces.filter((entry) => entry.itemId === item.id).length;
          return (
            <button className={`catalog-card catalog-${item.adoptionStatus}`} key={item.id} onClick={() => onOpenItem(item.id)}>
              <header><span className="provider-avatar large">{provider?.name.slice(0, 2) || "AI"}</span><AdoptionBadge status={item.adoptionStatus} /></header>
              <small>{provider?.name || "未知厂商"}</small><h3>{item.name}</h3><p>{item.description}</p>
              <div className="role-cell">{item.roles.map((role) => <em key={role}>{roleLabels[role]}</em>)}</div>
              <footer><span>{entitlementCount} 项权益</span><span>{accessCount} 个入口</span><span>{evaluation ? `${evaluation.evidenceCount} 份证据` : "待评价"}</span></footer>
            </button>
          );
        })}
        {!rows.length && <div className="panel empty-block">没有匹配的目录项目。</div>}
      </section>
    </div>
  );
}
