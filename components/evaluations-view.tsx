"use client";

import { FormEvent, useState } from "react";
import { RecommendationBadge } from "./status-badge";
import { type WorkspaceState } from "@/lib/domain";
import { estimateUsagePace } from "@/lib/metrics";

const utilizationLabels = { none: "未使用", low: "偏低", normal: "正常", high: "高效", constrained: "经常受限" };
const valueLabels = { unknown: "待评价", low: "较低", fair: "一般", good: "良好", core: "核心价值" };
const trendLabels = { rising: "上升", stable: "稳定", falling: "下降", unknown: "未知" };

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function EvaluationsView({ state, onOpenItem, serverMode, onWorkspaceChange }: {
  state: WorkspaceState;
  onOpenItem: (id: string) => void;
  serverMode: boolean;
  onWorkspaceChange: (state: WorkspaceState) => void;
}) {
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [entitlementId, setEntitlementId] = useState(state.entitlements[0]?.id || "");
  const [observedAt, setObservedAt] = useState(new Date().toISOString().slice(0, 10));
  const [utilizationPercent, setUtilizationPercent] = useState("");
  const [remainingValue, setRemainingValue] = useState("");
  const [evidenceName, setEvidenceName] = useState("");
  const [notes, setNotes] = useState("");
  const itemMap = new Map(state.catalog.map((item) => [item.id, item]));
  const entitlementMap = new Map(state.entitlements.map((item) => [item.id, item]));
  const sorted = [...state.evaluations].sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt));
  const estimates = state.entitlements.map((entitlement) => ({ entitlement, estimate: estimateUsagePace(entitlement.id, state) })).filter((entry) => entry.estimate);

  async function addSnapshot(event: FormEvent) {
    event.preventDefault();
    if (!entitlementId) return setError("请先创建或迁移一项使用权益。" );
    setBusy(true);
    setError("");
    const snapshot = {
      id: globalThis.crypto?.randomUUID?.() || `snapshot_${Date.now()}`,
      entitlementId, observedAt: `${observedAt}T12:00:00.000Z`, sourceLabel: "网页快照 / 人工观察",
      ...(utilizationPercent ? { utilizationPercent: Number(utilizationPercent) } : {}),
      ...(remainingValue ? { remainingValue: Number(remainingValue) } : {}),
      ...(evidenceName.trim() ? { evidenceName: evidenceName.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    try {
      if (serverMode) {
        const response = await fetch(`${BASE_PATH}/api/web/snapshots`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "保存失败");
        onWorkspaceChange({ ...state, snapshots: [result.snapshot, ...state.snapshots] });
      } else {
        onWorkspaceChange({ ...state, snapshots: [snapshot, ...state.snapshots] });
      }
      setUtilizationPercent(""); setRemainingValue(""); setEvidenceName(""); setNotes(""); setShowSnapshot(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setBusy(false); }
  }

  return (
    <div className="view-stack">
      <section className="section-intro"><div><span className="kicker">APPROXIMATE, NOT PRETEND-PRECISE</span><h2>快照与效率</h2><p>不同平台额度规则分别解释；原始数值只作为证据，最终输出使用程度、产出价值和建议动作。</p></div><button className="primary-button" onClick={() => setShowSnapshot(true)}>＋ 添加快照</button></section>
      <section className="evaluation-grid">
        {sorted.map((evaluation) => {
          const item = itemMap.get(evaluation.itemId);
          return (
            <button className="panel evaluation-card" key={evaluation.id} onClick={() => item && onOpenItem(item.id)}>
              <header><div><small>{evaluation.evaluatedAt}</small><h3>{item?.name || "未知项目"}</h3></div><RecommendationBadge recommendation={evaluation.recommendation} /></header>
              <div className="evaluation-metrics"><span><small>利用程度</small><b>{utilizationLabels[evaluation.utilization]}</b></span><span><small>产出水平</small><b>{valueLabels[evaluation.outputValue]}</b></span><span><small>使用趋势</small><b>{trendLabels[evaluation.trend]}</b></span><span><small>额度压力</small><b>{utilizationLabels[evaluation.quotaPressure]}</b></span></div>
              <p>{evaluation.note || "暂无补充说明。"}</p>
              <footer><span>{evaluation.evidenceCount} 份证据</span><span>覆盖约 {evaluation.observationDays} 天</span><span>可信度：{evaluation.confidence === "high" ? "高" : evaluation.confidence === "medium" ? "中" : "低"}</span></footer>
            </button>
          );
        })}
      </section>
      {estimates.length > 0 && <section className="panel estimate-panel"><header className="panel-header"><div><span className="kicker">ROUGH PROJECTION</span><h2>不规则快照推算</h2></div><span>只做同一原始单位的速度估算</span></header><div className="estimate-grid">{estimates.map(({ entitlement, estimate }) => <article key={entitlement.id}><small>{itemMap.get(entitlement.itemId)?.name} · {entitlement.label}</small><strong>{estimate!.summary}</strong><span>{estimate!.evidenceCount} 份证据 · 覆盖 {estimate!.observationDays} 天 · 可信度 {estimate!.confidence === "high" ? "高" : estimate!.confidence === "medium" ? "中" : "低"}</span></article>)}</div></section>}
      <section className="panel snapshot-table">
        <header className="panel-header"><div><span className="kicker">RAW EVIDENCE</span><h2>原始快照</h2></div><span>不要求固定月度录入</span></header>
        {[...state.snapshots].sort((left, right) => right.observedAt.localeCompare(left.observedAt)).map((snapshot) => {
          const entitlement = entitlementMap.get(snapshot.entitlementId);
          const item = entitlement ? itemMap.get(entitlement.itemId) : null;
          return <div className="snapshot-row" key={snapshot.id}><time>{snapshot.observedAt.slice(0, 10)}</time><span><b>{item?.name}</b><small>{snapshot.sourceLabel}</small></span><span>{snapshot.utilizationPercent !== undefined ? `窗口利用率 ${snapshot.utilizationPercent}%` : snapshot.remainingValue !== undefined ? `剩余额度 ${snapshot.remainingValue}` : "保留原始证据"}</span><span>{snapshot.evidenceName || "未附文件"}</span></div>;
        })}
      </section>
      {showSnapshot && <><button className="drawer-backdrop" aria-label="关闭快照表单" onClick={() => setShowSnapshot(false)} /><section className="snapshot-modal" role="dialog" aria-modal="true" aria-labelledby="snapshot-title"><header><div><span className="kicker">IRREGULAR EVIDENCE</span><h2 id="snapshot-title">记录一份快照</h2></div><button className="close-button" onClick={() => setShowSnapshot(false)}>×</button></header><p>不要求整月或固定间隔。按快照实际日期保存；有多份证据后再估算趋势。</p><form onSubmit={addSnapshot}><label><span>对应权益</span><select required value={entitlementId} onChange={(event) => setEntitlementId(event.target.value)}>{state.entitlements.map((entitlement) => <option value={entitlement.id} key={entitlement.id}>{itemMap.get(entitlement.itemId)?.name} · {entitlement.label}</option>)}</select></label><label><span>观察日期</span><input required type="date" value={observedAt} onChange={(event) => setObservedAt(event.target.value)} /></label><div className="form-pair"><label><span>窗口利用率 %（可选）</span><input type="number" min="0" max="100" value={utilizationPercent} onChange={(event) => setUtilizationPercent(event.target.value)} /></label><label><span>剩余额度（可选）</span><input type="number" min="0" step="any" value={remainingValue} onChange={(event) => setRemainingValue(event.target.value)} /></label></div><label><span>证据名称（可选）</span><input value={evidenceName} onChange={(event) => setEvidenceName(event.target.value)} placeholder="例如 codex-usage-2026-08-27.png" /></label><label><span>观察备注（可选）</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="例如最近十天主要用于项目开发，产出可直接采用" /></label>{error && <em>{error}</em>}<footer><button type="button" className="secondary-button" onClick={() => setShowSnapshot(false)}>取消</button><button className="primary-button" disabled={busy}>{busy ? "保存中…" : serverMode ? "保存原始证据" : "加入本次预览"}</button></footer></form></section></>}
    </div>
  );
}
