import { roleLabels, type WorkspaceState } from "@/lib/domain";

export function UsageMapView({ state, onOpenItem }: { state: WorkspaceState; onOpenItem: (id: string) => void }) {
  const itemMap = new Map(state.catalog.map((item) => [item.id, item]));
  const providerMap = new Map(state.providers.map((provider) => [provider.id, provider]));
  const surfaceMap = new Map(state.accessSurfaces.map((surface) => [surface.id, surface]));

  return (
    <div className="view-stack">
      <section className="section-intro"><div><span className="kicker">WHERE CAN I USE AI?</span><h2>使用地图</h2><p>从购买权益出发，查看它通过哪些 API、软件、Agent、设备和工作流产生价值。</p></div><button className="primary-button">＋ 建立关系</button></section>
      <section className="usage-map-grid">
        {state.entitlements.map((entitlement) => {
          const source = itemMap.get(entitlement.itemId);
          const links = state.usageLinks.filter((link) => link.entitlementId === entitlement.id);
          return (
            <article className="panel usage-chain" key={entitlement.id}>
              <header><span className="provider-avatar large">{source ? providerMap.get(source.providerId)?.name.slice(0, 2) : "AI"}</span><div><small>权益来源</small><button onClick={() => source && onOpenItem(source.id)}>{source?.name}</button><p>{entitlement.label}</p></div></header>
              <div className="chain-line" />
              <div className="chain-targets">
                {links.map((link) => {
                  const consumer = link.consumerItemId ? itemMap.get(link.consumerItemId) : null;
                  const surface = link.accessSurfaceId ? surfaceMap.get(link.accessSurfaceId) : null;
                  return <div key={link.id}><span>→</span><section><strong>{link.label}</strong><small>{consumer ? `${consumer.name} · ${consumer.roles.map((role) => roleLabels[role]).join("/")}` : surface?.name || "使用入口"}</small>{surface?.device && <em>{surface.device}</em>}</section></div>;
                })}
                {!links.length && <div className="empty-block">尚未记录使用位置。</div>}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
