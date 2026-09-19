"use client";

import { useEffect, useState } from "react";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

type ModelSettingsStatus = {
  configured: boolean;
  source: "byok" | "environment" | "unconfigured";
  baseUrl: string;
  model: string;
  storageAvailable: boolean;
};

export function ModelSettingsDialog({ open, serverMode, onClose, onConfiguredChange }: {
  open: boolean;
  serverMode: boolean;
  onClose: () => void;
  onConfiguredChange: (configured: boolean) => void;
}) {
  const [status, setStatus] = useState<ModelSettingsStatus | null>(null);
  const [settings, setSettings] = useState({ baseUrl: "https://api.openai.com/v1", model: "", apiKey: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!serverMode) return;
    let active = true;
    void fetch(`${BASE_PATH}/api/web/model-settings`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "读取模型设置失败");
      if (!active) return;
      setMessage("");
      setStatus(result.settings);
      setSettings({ baseUrl: result.settings.baseUrl || "https://api.openai.com/v1", model: result.settings.model || "", apiKey: "" });
    }).catch((error) => active && setMessage(error instanceof Error ? error.message : "读取模型设置失败"));
    return () => { active = false; };
  }, [open, serverMode]);

  async function save() {
    if (!settings.baseUrl.trim() || !settings.model.trim() || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${BASE_PATH}/api/web/model-settings`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.issues?.[0]?.message || result.error || "模型设置保存失败");
      onConfiguredChange(true);
      onClose();
    } catch (error) { setMessage(error instanceof Error ? error.message : "模型设置保存失败"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${BASE_PATH}/api/web/model-settings`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "删除模型设置失败");
      const configured = Boolean(result.settings.configured);
      onConfiguredChange(configured);
      setStatus(result.settings);
      setSettings({ baseUrl: result.settings.baseUrl || "https://api.openai.com/v1", model: result.settings.model || "", apiKey: "" });
      setMessage(configured ? "已恢复使用服务器环境配置。" : "模型设置已删除。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "删除模型设置失败"); }
    finally { setBusy(false); }
  }

  if (!open) return null;
  return <><button className="drawer-backdrop" aria-label="关闭模型设置" onClick={onClose} /><section className="snapshot-modal model-settings-modal" role="dialog" aria-label="一句话录入模型设置">
    <header><div><span className="kicker">QUICK INTAKE</span><h2>模型设置</h2></div><button className="close-button" onClick={onClose}>×</button></header>
    <p>只用于把自然语言整理成待确认草稿。API Key 加密保存且不会回显。</p>
    {status && <span className={`connection-chip ${status.configured ? "server" : "unavailable"}`}>{status.configured ? `${status.source === "byok" ? "网页配置" : "服务器配置"} · ${status.model}` : "尚未配置"}</span>}
    <div className="model-dialog-fields">
      <label><span>兼容接口地址</span><input type="url" maxLength={500} value={settings.baseUrl} onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })} placeholder="https://provider.example/v1" /></label>
      <label><span>模型 ID</span><input maxLength={200} value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} placeholder="例如：your-model-id" /></label>
      <label><span>API Key</span><input type="password" minLength={8} maxLength={512} autoComplete="new-password" value={settings.apiKey} onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })} placeholder={status?.source === "byok" ? "留空保留当前 Key" : "首次网页配置必须填写"} /></label>
    </div>
    {status && !status.storageAvailable && <em>服务器缺少 SUBHUB_SECRETS_MASTER_KEY，暂时不能安全保存网页 Key。</em>}
    {(!serverMode || message) && <em role="status">{serverMode ? message : "预览模式不能保存模型设置。"}</em>}
    <footer>{status?.source === "byok" && <button className="danger-button" disabled={busy} onClick={() => void remove()}>删除网页配置</button>}<span className="form-spacer" /><button className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={!serverMode || busy || !status?.storageAvailable || !settings.baseUrl.trim() || !settings.model.trim()} onClick={() => void save()}>{busy ? "保存中…" : "保存"}</button></footer>
  </section></>;
}
