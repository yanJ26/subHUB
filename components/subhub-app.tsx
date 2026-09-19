"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { DashboardView } from "./dashboard-view";
import { EntitlementsView } from "./entitlements-view";
import { ItemDrawer } from "./item-drawer";
import { AssetsView } from "./assets-view";
import { WorkspaceEditor, type EditorKind } from "./workspace-editor";
import { SmartIntakePanel } from "./smart-intake-panel";
import { previewState } from "@/lib/preview-data";
import type { ExchangeRateSnapshot, WorkspaceState } from "@/lib/domain";
import { defaultExchangeRates } from "@/lib/metrics";

type View = "overview" | "subscriptions" | "assets";

const nav: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "总览", icon: "⌂" },
  { id: "subscriptions", label: "订阅", icon: "◇" },
  { id: "assets", label: "资产", icon: "◫" },
];

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
type ConnectionMode = "checking" | "preview" | "login" | "server" | "unavailable";

export function SubHubApp() {
  const [view, setView] = useState<View>("overview");
  const [search, setSearch] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [state, setState] = useState<WorkspaceState>(previewState);
  const [revision, setRevision] = useState(0);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateSnapshot>(defaultExchangeRates);
  const [intakeConfigured, setIntakeConfigured] = useState(false);
  const [editor, setEditor] = useState<{ kind: EditorKind; editId?: string } | null>(null);
  const [connection, setConnection] = useState<ConnectionMode>("checking");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [reauth, setReauth] = useState(false);
  const title = useMemo(() => nav.find((item) => item.id === view)?.label || "总览", [view]);

  async function loadServerState() {
    const response = await fetch(`${BASE_PATH}/api/web/state`, { cache: "no-store" });
    if (!response.ok) throw new Error("gateway_unavailable");
    const result = await response.json() as { workspace: WorkspaceState; revision: number; exchangeRates?: ExchangeRateSnapshot; intake?: { configured?: boolean } };
    setState(result.workspace);
    setRevision(result.revision || 0);
    if (result.exchangeRates) setExchangeRates(result.exchangeRates);
    setIntakeConfigured(Boolean(result.intake?.configured));
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
      setLoginError(result.error === "invalid_password" ? "密码不正确" : result.error === "too_many_attempts" ? `尝试次数过多，请在 ${result.retryAfter || 60} 秒后重试` : "暂时无法登录");
      return;
    }
    setPassword("");
    try { await loadServerState(); setReauth(false); } catch { setConnection("unavailable"); }
  }

  async function saveWorkspace(next: WorkspaceState, summary: string) {
    if (connection === "preview") {
      setState(next);
      return;
    }
    if (connection !== "server") throw new Error("Gateway 当前不可用，内容尚未保存。");
    const response = await fetch(`${BASE_PATH}/api/web/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: next, expectedRevision: revision, operation: summary }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        setReauth(true);
        throw new Error("会话已过期，请重新登录后再保存。当前表单内容仍保留在此窗口。" );
      }
      if (response.status === 409) {
        await loadServerState();
        throw new Error("数据已在其他窗口更新，已刷新到最新版本，请重试。");
      }
      const detail = Array.isArray(result.details) && result.details[0] ? `${result.details[0].path}：${result.details[0].message}` : "";
      throw new Error(result.error === "likely_secret_detected" ? "内容疑似包含密钥，已拒绝保存。" : detail || result.error || "保存失败");
    }
    setState(result.workspace);
    setRevision(result.revision);
  }

  async function logout() {
    await fetch(`${BASE_PATH}/api/session`, { method: "DELETE" });
    setConnection("login");
    setState(previewState);
    setRevision(0);
  }

  if (connection === "checking") return <main className="auth-screen"><div className="auth-card"><span className="brand-mark">s</span><span className="kicker">SUBHUB</span><h1>正在检查本机连接</h1><p>正在确认安全会话与 Gateway 状态。</p></div></main>;
  if (connection === "login") return <main className="auth-screen"><form className="auth-card" onSubmit={login}><span className="brand-mark">s</span><span className="kicker">OWNER ACCESS</span><h1>进入 subHUB</h1><p>这是你的私人订阅与数字资产工具，请输入站点密码。</p><label><span>站点密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{loginError && <em>{loginError}</em>}<button className="primary-button">登录</button></form></main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">s</span><div><strong>subHUB</strong><small>PERSONAL SUBSCRIPTIONS</small></div></div>
      <nav>{nav.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)}><span>{item.icon}</span><b>{item.label}</b>{item.id === "subscriptions" && <em>{state.entitlements.length}</em>}</button>)}</nav>
      <div className="sidebar-spacer" />
      {connection !== "server" && <section className="preview-note"><span>PREVIEW DATA</span><strong>界面预览</strong><p>当前显示演示数据，不会写入你的数据库。</p></section>}
      <footer><i className={connection === "server" ? "online" : ""} /><span><strong>{connection === "server" ? "私人数据已连接" : connection === "preview" ? "本机预览模式" : "连接不可用"}</strong><small>{connection === "server" ? "SQLite · Owner session" : "演示数据不会写入"}</small></span>{connection === "server" && <button className="logout-button" onClick={() => void logout()}>退出</button>}</footer>
    </aside>

    <main className="main-content">
      <header className="topbar"><div><span className="kicker">SUBSCRIPTIONS · ASSETS</span><h1>{title}</h1></div><div className="topbar-actions"><label className="search-box"><span>⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); if (event.target.value) setView("subscriptions"); }} placeholder="搜索订阅、服务商或方案" /></label><button className="quick-button" onClick={() => { setView("overview"); window.setTimeout(() => document.getElementById("smart-intake-input")?.focus(), 0); }}>◇ 一句话录入</button></div></header>
      {view === "overview" && <><SmartIntakePanel configured={intakeConfigured} serverMode={connection === "server"} onConfiguredChange={setIntakeConfigured} onCommitted={(workspace, nextRevision) => { setState(workspace); setRevision(nextRevision); }} /><DashboardView state={state} exchangeRates={exchangeRates} onOpenItem={setSelectedItemId} onShowSubscriptions={() => setView("subscriptions")} /></>}
      {view === "subscriptions" && <EntitlementsView state={state} search={search} exchangeRates={exchangeRates} onOpenItem={setSelectedItemId} onAdd={() => setEditor({ kind: "quickSubscription" })} onEdit={(editId) => setEditor({ kind: "entitlement", editId })} />}
      {view === "assets" && <AssetsView state={state} onOpenItem={setSelectedItemId} onAdd={() => setEditor({ kind: "asset" })} onEditAsset={(editId) => setEditor({ kind: "asset", editId })} />}
    </main>

    <nav className="mobile-nav">{nav.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}</nav>
    <ItemDrawer state={state} itemId={selectedItemId} onClose={() => setSelectedItemId(null)} onEditItem={(editId) => setEditor({ kind: "catalog", editId })} onAddEntitlement={() => setEditor({ kind: "entitlement" })} onEditEntitlement={(editId) => setEditor({ kind: "entitlement", editId })} onAddAsset={() => setEditor({ kind: "asset" })} onEditAsset={(editId) => setEditor({ kind: "asset", editId })} />
    <WorkspaceEditor kind={editor?.kind || null} editId={editor?.editId} state={state} contextItemId={selectedItemId} onClose={() => setEditor(null)} onSave={saveWorkspace} />
    {reauth && <><button className="drawer-backdrop reauth-backdrop" aria-label="需要重新登录" /><form className="auth-card reauth-card" onSubmit={login}><span className="kicker">SESSION EXPIRED</span><h1>会话已过期</h1><p>重新登录后可继续提交，当前编辑表单不会被清空。</p><label><span>站点密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{loginError && <em>{loginError}</em>}<button className="primary-button">重新登录</button></form></>}
  </div>;
}
