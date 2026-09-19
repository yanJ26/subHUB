"use client";

import { useEffect, useState } from "react";
import type { WorkspaceState } from "@/lib/domain";

type ConnectionMode = "preview" | "server" | "unavailable";
type MigrationPreview = {
  workspace: WorkspaceState;
  warnings: Array<{ code: string; message: string }>;
  conflicts: Array<{ id: string; code: string; message: string; severity: "blocking" | "warning" }>;
  stats: Record<string, number>;
  canCommit: boolean;
  targetRevision: number;
  previewToken: string;
};
type RestorePreview = { restoreToken: string; targetRevision: number; stats: Record<string, number> };
type ModelSettingsStatus = {
  configured: boolean;
  source: "byok" | "environment" | "unconfigured";
  baseUrl: string;
  model: string;
  keyConfigured: boolean;
  storageAvailable: boolean;
  updatedAt: string | null;
};

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

async function readJsonFile(file: File | undefined) {
  if (!file) return undefined;
  if (file.size > 2 * 1024 * 1024) throw new Error("文件超过 2 MB 上限");
  return JSON.parse(await file.text());
}

export function SettingsView({ mode, onWorkspaceChange, onIntakeConfiguredChange }: {
  state: WorkspaceState;
  revision: number;
  mode: ConnectionMode;
  onWorkspaceChange: (state: WorkspaceState) => void;
  onIntakeConfiguredChange: (configured: boolean) => void;
}) {
  const [apiFile, setApiFile] = useState<File>();
  const [agentFile, setAgentFile] = useState<File>();
  const [buddyFile, setBuddyFile] = useState<File>();
  const [preview, setPreview] = useState<MigrationPreview>();
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, "keep_both" | "keep_existing" | "use_incoming">>({});
  const [restoreFile, setRestoreFile] = useState<File>();
  const [restorePreview, setRestorePreview] = useState<RestorePreview>();
  const [message, setMessage] = useState("");
  const [auditLogs, setAuditLogs] = useState<Array<{ id: string; occurredAt: string; action: string; summary: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelSettingsStatus | null>(null);
  const [modelSettings, setModelSettings] = useState({ baseUrl: "https://api.openai.com/v1", model: "", apiKey: "" });
  const [modelMessage, setModelMessage] = useState("");
  const [modelBusy, setModelBusy] = useState(false);

  useEffect(() => {
    if (mode !== "server") return;
    let active = true;
    void fetch(`${BASE_PATH}/api/web/model-settings`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "读取模型设置失败");
      if (!active) return;
      setModelStatus(result.settings);
      setModelSettings({ baseUrl: result.settings.baseUrl || "https://api.openai.com/v1", model: result.settings.model || "", apiKey: "" });
      onIntakeConfiguredChange(Boolean(result.settings.configured && (result.settings.source !== "byok" || result.settings.storageAvailable)));
    }).catch((error) => active && setModelMessage(error instanceof Error ? error.message : "读取模型设置失败"));
    return () => { active = false; };
  }, [mode, onIntakeConfiguredChange]);

  async function saveModelSettings() {
    if (!modelSettings.baseUrl.trim() || !modelSettings.model.trim()) return;
    setModelBusy(true); setModelMessage("");
    try {
      const response = await fetch(`${BASE_PATH}/api/web/model-settings`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: modelSettings }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.issues?.[0]?.message || result.error || "模型设置保存失败");
      setModelStatus(result.settings);
      setModelSettings({ baseUrl: result.settings.baseUrl, model: result.settings.model, apiKey: "" });
      onIntakeConfiguredChange(true);
      setModelMessage("模型设置已加密保存，可以使用一句话录入。");
    } catch (error) { setModelMessage(error instanceof Error ? error.message : "模型设置保存失败"); }
    finally { setModelBusy(false); }
  }

  async function deleteModelSettings() {
    setModelBusy(true); setModelMessage("");
    try {
      const response = await fetch(`${BASE_PATH}/api/web/model-settings`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "删除模型设置失败");
      setModelStatus(result.settings);
      setModelSettings({ baseUrl: result.settings.baseUrl || "https://api.openai.com/v1", model: result.settings.model || "", apiKey: "" });
      onIntakeConfiguredChange(Boolean(result.settings.configured));
      setModelMessage(result.settings.configured ? "已删除网页 BYOK，当前使用服务器环境配置。" : "已删除网页 BYOK，一句话录入已停用。");
    } catch (error) { setModelMessage(error instanceof Error ? error.message : "删除模型设置失败"); }
    finally { setModelBusy(false); }
  }

  async function generatePreview() {
    if (!apiFile && !agentFile && !buddyFile) return setMessage("请至少选择一个旧项目导出的 JSON 文件。");
    setBusy(true);
    setMessage("");
    try {
      const [apiHub, agentHub, buddyHub] = await Promise.all([readJsonFile(apiFile), readJsonFile(agentFile), readJsonFile(buddyFile)]);
      const response = await fetch(`${BASE_PATH}/api/web/migration/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiHub, agentHub, buddyHub }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error === "likely_secret_detected" ? "导出文件疑似包含密钥，已拒绝读取。" : result.error || "迁移预检失败");
      setPreview(result);
      setConflictResolutions({});
      setMessage(result.conflicts.length ? "预检完成：发现需要人工核对的重复项。" : "预检完成，可以提交。" );
    } catch (error) {
      setPreview(undefined);
      setMessage(error instanceof Error ? error.message : "无法读取迁移文件");
    } finally { setBusy(false); }
  }

  async function commitPreview() {
    if (!preview || preview.conflicts.some((conflict) => conflict.severity === "blocking" && !conflictResolutions[conflict.id])) return;
    setBusy(true);
    try {
      const [apiHub, agentHub, buddyHub] = await Promise.all([readJsonFile(apiFile), readJsonFile(agentFile), readJsonFile(buddyFile)]);
      const response = await fetch(`${BASE_PATH}/api/web/migration/commit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiHub, agentHub, buddyHub, expectedRevision: preview.targetRevision, previewToken: preview.previewToken, conflictResolutions }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "写入失败");
      onWorkspaceChange(result.workspace);
      setMessage("迁移数据已写入 subHUB；三个旧仓库均未改动。" );
    } catch (error) { setMessage(error instanceof Error ? error.message : "写入失败"); }
    finally { setBusy(false); }
  }

  async function exportBackup() {
    setBusy(true);
    setMessage("");
    try {
      if (mode !== "server") throw new Error("连接 Gateway 后才能导出一致的业务备份。");
      const response = await fetch(`${BASE_PATH}/api/web/backup`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "导出失败");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `subhub-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("业务 JSON 备份已导出。完整 SQLite 备份请使用服务器备份脚本。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "导出失败"); }
    finally { setBusy(false); }
  }

  async function loadAudit() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${BASE_PATH}/api/web/audit?limit=20`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "读取审计记录失败");
      setAuditLogs(result.auditLogs || []); setMessage("已读取最近 20 条审计记录。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "读取审计记录失败"); }
    finally { setBusy(false); }
  }

  async function previewRestore() {
    setBusy(true); setMessage(""); setRestorePreview(undefined);
    try {
      const backup = await readJsonFile(restoreFile);
      if (!backup) throw new Error("请选择 subHUB 业务备份文件。");
      const response = await fetch(`${BASE_PATH}/api/web/restore/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backup }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "恢复预检失败");
      setRestorePreview(result); setMessage("恢复预检通过。确认后将用备份内容替换当前业务数据。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "恢复预检失败"); }
    finally { setBusy(false); }
  }

  async function commitRestore() {
    if (!restorePreview) return;
    setBusy(true); setMessage("");
    try {
      const backup = await readJsonFile(restoreFile);
      const response = await fetch(`${BASE_PATH}/api/web/restore/commit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backup, expectedRevision: restorePreview.targetRevision, restoreToken: restorePreview.restoreToken }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "恢复失败");
      onWorkspaceChange(result.workspace); setRestorePreview(undefined); setMessage("业务备份已恢复。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "恢复失败"); }
    finally { setBusy(false); }
  }

  return <div className="settings-stack">
    <section className="settings-layout">
      <article className="panel model-settings-panel">
        <span className="kicker">SEMANTIC INTAKE</span><h2>一句话录入模型</h2>
        <p>填写支持 OpenAI-compatible Chat Completions 和严格 JSON Schema 的模型。API Key 只在这里接收，加密后保存且永不回显。</p>
        {modelStatus && <span className={`connection-chip ${modelStatus.configured ? "server" : "unavailable"}`}>{modelStatus.configured ? `${modelStatus.source === "byok" ? "网页 BYOK" : "服务器环境"} · ${modelStatus.model}` : "尚未配置"}</span>}
        {modelStatus && !modelStatus.storageAvailable && <small className="settings-error">服务器缺少 SUBHUB_SECRETS_MASTER_KEY，暂时不能安全保存网页 Key。</small>}
        <div className="model-settings-fields">
          <label><span>兼容接口地址</span><input type="url" maxLength={500} value={modelSettings.baseUrl} onChange={(event) => setModelSettings({ ...modelSettings, baseUrl: event.target.value })} placeholder="https://provider.example/v1" /></label>
          <label><span>模型 ID</span><input maxLength={200} value={modelSettings.model} onChange={(event) => setModelSettings({ ...modelSettings, model: event.target.value })} placeholder="例如：your-model-id" /></label>
          <label><span>API Key</span><input type="password" minLength={8} maxLength={512} autoComplete="new-password" value={modelSettings.apiKey} onChange={(event) => setModelSettings({ ...modelSettings, apiKey: event.target.value })} placeholder={modelStatus?.source === "byok" ? "留空保留当前 Key" : "首次网页配置必须填写"} /></label>
        </div>
        {modelMessage && <small className="settings-message" role="status">{modelMessage}</small>}
        <div className="model-settings-actions">
          {modelStatus?.source === "byok" && <button className="danger-button" disabled={modelBusy} onClick={() => void deleteModelSettings()}>删除网页 BYOK</button>}
          <button className="primary-button" disabled={mode !== "server" || modelBusy || !modelStatus?.storageAvailable || !modelSettings.baseUrl.trim() || !modelSettings.model.trim()} onClick={() => void saveModelSettings()}>{modelBusy ? "正在保存…" : modelStatus?.source === "byok" ? "保存模型设置" : "安全保存 Key"}</button>
        </div>
      </article>
      <article className="panel migration-panel">
        <span className="kicker">MIGRATION</span><h2>旧项目迁移</h2>
        <p>分别选择 apiHUB、agentHUB 和 buddyHUB 导出的 JSON。系统先生成候选和冲突，不会直接覆盖。</p>
        <div className="file-pair">
          <label><span>apiHUB 导出</span><input type="file" accept="application/json,.json" onChange={(event) => { setApiFile(event.target.files?.[0]); setPreview(undefined); }} /><small>{apiFile?.name || "尚未选择"}</small></label>
          <label><span>agentHUB 导出</span><input type="file" accept="application/json,.json" onChange={(event) => { setAgentFile(event.target.files?.[0]); setPreview(undefined); }} /><small>{agentFile?.name || "尚未选择"}</small></label>
          <label><span>buddyHUB 导出</span><input type="file" accept="application/json,.json" onChange={(event) => { setBuddyFile(event.target.files?.[0]); setPreview(undefined); }} /><small>{buddyFile?.name || "尚未选择"}</small></label>
        </div>
        <button className="primary-button" disabled={mode !== "server" || busy} onClick={generatePreview}>{busy ? "处理中…" : "生成迁移预览"}</button>
      </article>
      <article className="panel">
        <span className="kicker">BACKUP</span><h2>subHUB 安全导出</h2>
        <p>从 Gateway 导出同一修订版的业务数据。登录密码、内部 Token、审计日志与服务器配置不进入 JSON。</p>
        <button className="secondary-button" disabled={mode !== "server" || busy} onClick={() => void exportBackup()}>导出业务 JSON</button>
        <label className="restore-file"><span>选择业务备份</span><input type="file" accept="application/json,.json" onChange={(event) => { setRestoreFile(event.target.files?.[0]); setRestorePreview(undefined); }} /><small>{restoreFile?.name || "尚未选择"}</small></label>
        <button className="secondary-button" disabled={mode !== "server" || busy || !restoreFile} onClick={() => void previewRestore()}>预检恢复文件</button>
        {restorePreview && <button className="danger-button" disabled={busy} onClick={() => void commitRestore()}>确认替换当前业务数据</button>}
      </article>
      <article className="panel">
        <span className="kicker">SECURITY</span><h2>密钥边界</h2>
        <p>subHUB 只记录凭据标签，不接受或保存真实 API Key、Token、密码与 Cookie；它们也不会进入备份、迁移或效率评价。</p>
        <span className={`connection-chip ${mode}`}>{mode === "server" ? "安全 Gateway 已连接" : mode === "preview" ? "本机界面预览" : "Gateway 不可用"}</span>
        <button className="secondary-button audit-button" disabled={mode !== "server" || busy} onClick={() => void loadAudit()}>查看最近审计</button>
      </article>
      <article className="panel">
        <span className="kicker">RETIREMENT</span><h2>旧仓库退役</h2>
        <p>subHUB 完成并验收后，三个旧仓库仍保持独立和可访问；这里只记录它们作为只读迁移来源，不修改或删除历史。</p>
        <span className="pending-chip">旧仓库保持原样</span>
      </article>
    </section>

    {(message || preview) && <section className="panel migration-result">
      <header className="panel-header"><div><span className="kicker">PREVIEW RESULT</span><h2>迁移预检结果</h2></div>{message && <span>{message}</span>}</header>
      {preview && <>
        <div className="migration-stats">{Object.entries(preview.stats).map(([key, value]) => <span key={key}><b>{value}</b><small>{key}</small></span>)}</div>
        {[...preview.conflicts, ...preview.warnings].length > 0 && <div className="migration-issues">{preview.conflicts.map((issue) => <p className="conflict" key={`${issue.code}-${issue.message}`}>需核对 · {issue.message}</p>)}{preview.warnings.map((issue) => <p key={`${issue.code}-${issue.message}`}>提示 · {issue.message}</p>)}</div>}
        {preview.conflicts.filter((conflict) => conflict.severity === "blocking").map((conflict) => <label className="conflict-confirm" key={conflict.id}><span>{conflict.message}</span><select value={conflictResolutions[conflict.id] || ""} onChange={(event) => setConflictResolutions((current) => ({ ...current, [conflict.id]: event.target.value as "keep_both" | "keep_existing" | "use_incoming" }))}><option value="">请选择处理方式</option><option value="keep_both">保留两条独立权益</option><option value="keep_existing">保留现有 / 优先来源</option><option value="use_incoming">采用新导入权益</option></select></label>)}
        <footer><button className="primary-button" disabled={preview.conflicts.some((conflict) => conflict.severity === "blocking" && !conflictResolutions[conflict.id]) || busy} onClick={commitPreview}>{preview.canCommit ? "确认写入 subHUB" : "确认核对结果并写入"}</button><small>提交绑定当前文件摘要和数据库修订号；任一变化都必须重新预览。</small></footer>
      </>}
    </section>}
    {auditLogs.length > 0 && <section className="panel audit-list"><header className="panel-header"><div><span className="kicker">AUDIT</span><h2>最近操作</h2></div><span>摘要由服务端生成</span></header>{auditLogs.map((entry) => <article key={entry.id}><time>{new Date(entry.occurredAt).toLocaleString("zh-CN")}</time><strong>{entry.action}</strong><span>{entry.summary}</span></article>)}</section>}
  </div>;
}
