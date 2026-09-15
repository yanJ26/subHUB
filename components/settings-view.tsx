"use client";

import { useState } from "react";
import type { WorkspaceState } from "@/lib/domain";

type ConnectionMode = "preview" | "server" | "unavailable";
type MigrationPreview = {
  workspace: WorkspaceState;
  warnings: Array<{ code: string; message: string }>;
  conflicts: Array<{ code: string; message: string }>;
  stats: Record<string, number>;
  canCommit: boolean;
};

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

async function readJsonFile(file: File | undefined) {
  if (!file) return undefined;
  if (file.size > 2 * 1024 * 1024) throw new Error("文件超过 2 MB 上限");
  return JSON.parse(await file.text());
}

export function SettingsView({ state, revision, mode, onWorkspaceChange }: { state: WorkspaceState; revision: number; mode: ConnectionMode; onWorkspaceChange: (state: WorkspaceState) => void }) {
  const [apiFile, setApiFile] = useState<File>();
  const [agentFile, setAgentFile] = useState<File>();
  const [buddyFile, setBuddyFile] = useState<File>();
  const [preview, setPreview] = useState<MigrationPreview>();
  const [confirmConflicts, setConfirmConflicts] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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
      setConfirmConflicts(false);
      setMessage(result.conflicts.length ? "预检完成：发现需要人工核对的重复项。" : "预检完成，可以提交。" );
    } catch (error) {
      setPreview(undefined);
      setMessage(error instanceof Error ? error.message : "无法读取迁移文件");
    } finally { setBusy(false); }
  }

  async function commitPreview() {
    if (!preview || (!preview.canCommit && !confirmConflicts)) return;
    setBusy(true);
    try {
      const [apiHub, agentHub, buddyHub] = await Promise.all([readJsonFile(apiFile), readJsonFile(agentFile), readJsonFile(buddyFile)]);
      const response = await fetch(`${BASE_PATH}/api/web/migration/commit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiHub, agentHub, buddyHub, expectedRevision: revision, confirmConflicts }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "写入失败");
      onWorkspaceChange(result.workspace);
      setMessage("迁移数据已写入 subHUB；三个旧仓库均未改动。" );
    } catch (error) { setMessage(error instanceof Error ? error.message : "写入失败"); }
    finally { setBusy(false); }
  }

  function exportBackup() {
    const payload = { product: "subHUB", schemaVersion: 1, exportedAt: new Date().toISOString(), workspace: state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `subhub-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className="settings-stack">
    <section className="settings-layout">
      <article className="panel migration-panel">
        <span className="kicker">MIGRATION</span><h2>旧项目迁移</h2>
        <p>分别选择 apiHUB、agentHUB 和 buddyHUB 导出的 JSON。系统先生成候选和冲突，不会直接覆盖。</p>
        <div className="file-pair">
          <label><span>apiHUB 导出</span><input type="file" accept="application/json,.json" onChange={(event) => setApiFile(event.target.files?.[0])} /><small>{apiFile?.name || "尚未选择"}</small></label>
          <label><span>agentHUB 导出</span><input type="file" accept="application/json,.json" onChange={(event) => setAgentFile(event.target.files?.[0])} /><small>{agentFile?.name || "尚未选择"}</small></label>
          <label><span>buddyHUB 导出</span><input type="file" accept="application/json,.json" onChange={(event) => setBuddyFile(event.target.files?.[0])} /><small>{buddyFile?.name || "尚未选择"}</small></label>
        </div>
        <button className="primary-button" disabled={mode !== "server" || busy} onClick={generatePreview}>{busy ? "处理中…" : "生成迁移预览"}</button>
      </article>
      <article className="panel">
        <span className="kicker">BACKUP</span><h2>subHUB 安全导出</h2>
        <p>导出目录、权益、发票、资产、部署、入口、快照和评价。登录密码与内部 Token 永不进入文件。</p>
        <button className="secondary-button" onClick={exportBackup}>导出 JSON 备份</button>
      </article>
      <article className="panel">
        <span className="kicker">SECURITY</span><h2>密钥边界</h2>
        <p>subHUB 只记录凭据标签，不接受或保存真实 API Key、Token、密码与 Cookie；它们也不会进入备份、迁移或效率评价。</p>
        <span className={`connection-chip ${mode}`}>{mode === "server" ? "安全 Gateway 已连接" : mode === "preview" ? "本机界面预览" : "Gateway 不可用"}</span>
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
        {!preview.canCommit && <label className="conflict-confirm"><input type="checkbox" checked={confirmConflicts} onChange={(event) => setConfirmConflicts(event.target.checked)} /><span>我已逐项核对：重复费用继续以 apiHUB 为准，并保留全部来源映射。</span></label>}
        <footer><button className="primary-button" disabled={(!preview.canCommit && !confirmConflicts) || busy} onClick={commitPreview}>{preview.canCommit ? "确认写入 subHUB" : "确认取舍并写入 subHUB"}</button><small>写入只影响 subHUB，不会修改三个旧项目。</small></footer>
      </>}
    </section>}
  </div>;
}
