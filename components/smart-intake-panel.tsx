"use client";

import { useState } from "react";
import type { WorkspaceState } from "@/lib/domain";
import { ModelSettingsDialog } from "./model-settings-dialog";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

type Issue = { code: string; message: string };
type Draft = { id: string; summary: string; expiresAt: string; expectedRevision: number };

export function SmartIntakePanel({ configured, serverMode, onConfiguredChange, onCommitted }: {
  configured: boolean;
  serverMode: boolean;
  onConfiguredChange: (configured: boolean) => void;
  onCommitted: (workspace: WorkspaceState, revision: number) => void;
}) {
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  async function generateDraft() {
    if (!message.trim() || busy) return;
    setBusy(true); setIssues([]);
    try {
      if (draft) await closeDraft(true);
      const response = await fetch(`${BASE_PATH}/api/web/intake`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: message.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.message || result.error || "智能录入失败"), { result });
      if (result.status === "pending_confirmation" && result.draft) setDraft(result.draft);
      else setIssues(result.issues || [{ code: "needs_clarification", message: "信息还不够明确，请换一种说法或补充关键内容。" }]);
    } catch (error) {
      const result = error && typeof error === "object" && "result" in error ? (error as { result?: { issues?: Issue[] } }).result : undefined;
      setIssues(result?.issues?.length ? result.issues : [{ code: "request_failed", message: error instanceof Error ? error.message : "智能录入暂时不可用" }]);
    } finally { setBusy(false); }
  }

  async function closeDraft(cancel = true) {
    const activeDraft = draft;
    setDraft(null);
    if (cancel && activeDraft) await fetch(`${BASE_PATH}/api/web/intake/drafts/${activeDraft.id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
  }

  async function commitDraft() {
    if (!draft || busy) return;
    setBusy(true); setIssues([]);
    try {
      const response = await fetch(`${BASE_PATH}/api/web/intake/drafts/${draft.id}/commit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? "数据已经变化，请重新生成草稿。" : result.error === "intake_draft_expired" ? "草稿已过期，请重新生成。" : result.error || "确认写入失败");
      onCommitted(result.workspace, result.revision);
      setDraft(null); setMessage("");
      setIssues([{ code: "committed", message: result.op === "update" ? "已按草稿更新对应订阅，其余字段保持不变。" : result.op === "create_service" ? "服务已经加入列表，没有创建任何订阅或费用记录。" : "订阅已经写入，相关服务和可选发票也已自动处理。" }]);
    } catch (error) {
      setIssues([{ code: "commit_failed", message: error instanceof Error ? error.message : "确认写入失败" }]);
    } finally { setBusy(false); }
  }

  const available = configured && serverMode;
  return <section className="smart-intake-panel">
    <div className="smart-intake-copy"><span className="kicker">QUICK INTAKE</span><h2>一句话记录服务和订阅</h2><p>已订阅、免费使用或只是想列进来，都可以直接说明。系统会区分服务和订阅，不会为未订阅工具虚构费用。</p></div>
    <div className="smart-intake-input">
      <textarea id="smart-intake-input" rows={3} maxLength={12000} value={message} onChange={(event) => { setMessage(event.target.value); if (draft) void closeDraft(true); }} placeholder="例如：把 Kimi 列进来，我没有订阅，只是偶尔使用。或：新增 Qoder Pro，每月 20 美元，10 月 18 日续费" />
      <footer><small>不要输入 API Key、Token、密码、Cookie 或完整卡号 <button type="button" className="inline-settings-button" onClick={() => setSettingsOpen(true)}>模型设置</button></small><button className="primary-button" disabled={!available || busy || !message.trim()} onClick={() => void generateDraft()}>{busy ? "正在整理…" : "生成草稿"}</button></footer>
    </div>
    {!serverMode && <p className="smart-intake-warning">预览模式不能写入真实数据。</p>}
    {serverMode && !configured && <p className="smart-intake-warning">自然语言模型尚未配置。<button type="button" onClick={() => setSettingsOpen(true)}>现在配置</button></p>}
    {issues.length > 0 && <div className="smart-intake-issues" role="status">{issues.map((entry, index) => <p className={entry.code === "committed" ? "success" : ""} key={`${entry.code}-${index}`}><b>{entry.code === "committed" ? "✓" : "!"}</b><span>{entry.message}</span></p>)}</div>}
    {draft && <div className="smart-intake-draft" role="dialog" aria-label="自然语言录入草稿"><header><strong>待确认草稿</strong><small>{new Date(draft.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 前有效</small></header><pre>{draft.summary}</pre><footer><button className="secondary-button" disabled={busy} onClick={() => void closeDraft(true)}>取消草稿</button><button className="primary-button" disabled={busy} onClick={() => void commitDraft()}>确认写入</button></footer></div>}
    <ModelSettingsDialog open={settingsOpen} serverMode={serverMode} onClose={() => setSettingsOpen(false)} onConfiguredChange={onConfiguredChange} />
  </section>;
}
