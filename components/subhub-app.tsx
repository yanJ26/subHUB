"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CatalogView } from "./catalog-view";
import { DashboardView } from "./dashboard-view";
import { EntitlementsView } from "./entitlements-view";
import { EvaluationsView } from "./evaluations-view";
import { ItemDrawer } from "./item-drawer";
import { SettingsView } from "./settings-view";
import { UsageMapView } from "./usage-map-view";
import { AssetsView } from "./assets-view";
import { WorkspaceEditor, type EditorKind } from "./workspace-editor";
import { previewState } from "@/lib/preview-data";
import type { WorkspaceState } from "@/lib/domain";

type View = "overview" | "catalog" | "entitlements" | "assets" | "map" | "evaluations" | "settings";

const nav: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "总览", icon: "⌂" },
  { id: "catalog", label: "完整目录", icon: "▦" },
  { id: "entitlements", label: "使用权益", icon: "◇" },
  { id: "assets", label: "资产与域名", icon: "◫" },
  { id: "map", label: "使用地图", icon: "↗" },
  { id: "evaluations", label: "快照与效率", icon: "◎" },
  { id: "settings", label: "数据与连接", icon: "⚙" },
];

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
type ConnectionMode = "checking" | "preview" | "login" | "server" | "unavailable";

export function SubHubApp() {
  const [view, setView] = useState<View>("overview");
  const [search, setSearch] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [state, setState] = useState<WorkspaceState>(previewState);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<EditorKind | null>(null);
  const [connection, setConnection] = useState<ConnectionMode>("checking");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const title = useMemo(() => nav.find((item) => item.id === view)?.label || "总览", [view]);

  async function loadServerState() {
    const response = await fetch(`${BASE_PATH}/api/web/state`, { cache: "no-store" });
    if (!response.ok) throw new Error("gateway_unavailable");
    const result = await response.json() as { workspace: WorkspaceState; revision: number };
    setState(result.workspace);
    setRevision(result.revision || 0);
    setConnection("server");
  }

  useEffect(() => {
    let active = true;
    fetch(`${BASE_PATH}/api/session`, { cache: "no-store" }).then(async (response) => {
      const session = await response.json() as { configured: boolean; authenticated: boolean };
      if (!active) return;
      if (!session.configured) return setConnection("preview");
      if (!session.authenticated) return setConnection("login");
      await loadServerState();
    }).catch(() => active && setConnection("unavailable"));
    return () => { active = false; };
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setLoginError("");
    const response = await fetch(`${BASE_PATH}/api/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setLoginError(result.error === "invalid_password" ? "密码不正确" : "暂时无法登录");
      return;
    }
    setPassword("");
    try { await loadServerState(); } catch { setConnection("unavailable"); }
  }

  async function saveWorkspace(next: WorkspaceState, summary: string) {
    if (connection !== "server") {
      setState(next);
      return;
    }
    const response = await fetch(`${BASE_PATH}/api/web/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: next, expectedRevision: revision, summary }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) {
        await loadServerState();
        throw new Error("数据已在其他窗口更新，已刷新到最新版本，请重试。");
      }
      throw new Error(result.error === "likely_secret_detected" ? "内容疑似包含密钥，已拒绝保存。" : result.error || "保存失败");
    }
    setState(result.workspace);
    setRevision(result.revision);
  }

  if (connection === "checking") return <main className="auth-screen"><div className="auth-card"><span className="brand-mark">s</span><span className="kicker">SUBHUB</span><h1>正在检查本机连接</h1><p>正在确认安全会话与 Gateway 状态。</p></div></main>;
  if (connection === "login") return <main className="auth-screen"><form className="auth-card" onSubmit={login}><span className="brand-mark">s</span><span className="kicker">OWNER ACCESS</span><h1>进入 subHUB</h1><p>这是你的私人数字服务与资产控制台，请输入站点密码。</p><label><span>站点密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{loginError && <em>{loginError}</em>}<button className="primary-button">登录</button></form></main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">s</span><div><strong>subHUB</strong><small>DIGITAL CONTROL PLANE</small></div></div>
      <nav>{nav.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)}><span>{item.icon}</span><b>{item.label}</b>{item.id === "catalog" && <em>{state.catalog.length}</em>}</button>)}</nav>
      <div className="sidebar-spacer" />
      {connection !== "server" && <section className="preview-note"><span>PREVIEW DATA</span><strong>迁移前预览</strong><p>当前个人状态和日期用于验证界面，导入旧项目后必须人工确认。</p></section>}
      <footer><i className={connection === "server" ? "online" : ""} /><span><strong>{connection === "server" ? "私人数据已连接" : connection === "preview" ? "本机预览模式" : "连接不可用"}</strong><small>{connection === "server" ? "SQLite · Owner session" : "演示数据不会写入"}</small></span></footer>
    </aside>

    <main className="main-content">
      <header className="topbar"><div><span className="kicker">SERVICES · RIGHTS · ASSETS</span><h1>{title}</h1></div><div className="topbar-actions"><label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索服务、权益、域名、设备或入口" /></label><button className="quick-button" onClick={() => setView("evaluations")}>✦ 快速记录</button></div></header>
      {view === "overview" && <DashboardView state={state} onOpenItem={setSelectedItemId} onShowCatalog={() => setView("catalog")} />}
      {view === "catalog" && <CatalogView state={state} search={search} onOpenItem={setSelectedItemId} onAdd={() => setEditor("catalog")} />}
      {view === "entitlements" && <EntitlementsView state={state} onOpenItem={setSelectedItemId} onAdd={() => setEditor("entitlement")} />}
      {view === "assets" && <AssetsView state={state} onOpenItem={setSelectedItemId} onAdd={() => setEditor("asset")} onAddDeployment={() => setEditor("deployment")} />}
      {view === "map" && <UsageMapView state={state} onOpenItem={setSelectedItemId} />}
      {view === "evaluations" && <EvaluationsView state={state} onOpenItem={setSelectedItemId} serverMode={connection === "server"} onWorkspaceChange={(next) => { setState(next); if (connection === "server") void loadServerState(); }} />}
      {view === "settings" && <SettingsView state={state} revision={revision} mode={connection === "server" ? "server" : connection === "preview" ? "preview" : "unavailable"} onWorkspaceChange={(next) => { setState(next); if (connection === "server") void loadServerState(); }} />}
    </main>

    <nav className="mobile-nav">{nav.slice(0, 5).map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)}><span>{item.icon}</span><small>{item.label.replace("完整", "").replace("使用", "")}</small></button>)}</nav>
    <ItemDrawer state={state} itemId={selectedItemId} onClose={() => setSelectedItemId(null)} onAddEntitlement={() => setEditor("entitlement")} onAddAsset={() => setEditor("asset")} onAddDeployment={() => setEditor("deployment")} />
    <WorkspaceEditor kind={editor} state={state} contextItemId={selectedItemId} onClose={() => setEditor(null)} onSave={saveWorkspace} />
  </div>;
}
