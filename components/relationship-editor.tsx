"use client";

import { FormEvent, useState } from "react";
import type {
  Confidence, EvaluationLevel, QuotaWindowType, Recommendation, ValueLevel, WorkspaceState,
} from "@/lib/domain";

export type RelationshipEditorKind = "surface" | "usageLink" | "quotaPolicy" | "evaluation" | "workRecord";

type Props = {
  kind: RelationshipEditorKind | null;
  editId?: string | null;
  state: WorkspaceState;
  contextItemId?: string | null;
  contextEntitlementId?: string | null;
  onClose: () => void;
  onSave: (next: WorkspaceState, summary: string) => Promise<void>;
};

function id(prefix: string) {
  return prefix + "_" + crypto.randomUUID();
}

export function RelationshipEditor({ kind, editId, state, contextItemId, contextEntitlementId, onClose, onSave }: Props) {
  const existingSurface = kind === "surface" ? state.accessSurfaces.find((entry) => entry.id === editId) : undefined;
  const existingLink = kind === "usageLink" ? state.usageLinks.find((entry) => entry.id === editId) : undefined;
  const existingQuota = kind === "quotaPolicy" ? state.quotaPolicies.find((entry) => entry.id === editId) : undefined;
  const existingEvaluation = kind === "evaluation" ? state.evaluations.find((entry) => entry.id === editId) : undefined;
  const existingWork = kind === "workRecord" ? state.workRecords.find((entry) => entry.id === editId) : undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [itemId, setItemId] = useState(existingSurface?.itemId || existingEvaluation?.itemId || existingWork?.itemId || contextItemId || state.catalog[0]?.id || "");
  const [entitlementId, setEntitlementId] = useState(existingLink?.entitlementId || existingQuota?.entitlementId || contextEntitlementId || state.entitlements[0]?.id || "");
  const [name, setName] = useState(existingSurface?.name || existingLink?.label || existingQuota?.label || existingWork?.title || "");
  const [surfaceKind, setSurfaceKind] = useState(existingSurface?.kind || "web");
  const [surfaceStatus, setSurfaceStatus] = useState(existingSurface?.status || "available");
  const [assetId, setAssetId] = useState(existingSurface?.assetId || existingLink?.assetId || "");
  const [deploymentId, setDeploymentId] = useState(existingSurface?.deploymentId || existingLink?.deploymentId || "");
  const [surfaceId, setSurfaceId] = useState(existingLink?.accessSurfaceId || "");
  const [consumerItemId, setConsumerItemId] = useState(existingLink?.consumerItemId || "");
  const [allocationPercent, setAllocationPercent] = useState(existingLink?.allocationPercent === undefined ? "" : String(existingLink.allocationPercent));
  const [device, setDevice] = useState(existingSurface?.device || "");
  const [account, setAccount] = useState(existingSurface?.account || "");
  const [metric, setMetric] = useState(existingQuota?.metric || "unknown");
  const [windowType, setWindowType] = useState<QuotaWindowType>(existingQuota?.windowType || "metered");
  const [windowHours, setWindowHours] = useState(existingQuota?.windowHours === undefined ? "" : String(existingQuota.windowHours));
  const [limitValue, setLimitValue] = useState(existingQuota?.limitValue === undefined ? "" : String(existingQuota.limitValue));
  const [date, setDate] = useState(existingEvaluation?.evaluatedAt || existingWork?.occurredAt || new Date().toISOString().slice(0, 10));
  const [utilization, setUtilization] = useState<EvaluationLevel>(existingEvaluation?.utilization || "normal");
  const [outputValue, setOutputValue] = useState<ValueLevel>(existingEvaluation?.outputValue || "unknown");
  const [quotaPressure, setQuotaPressure] = useState<EvaluationLevel>(existingEvaluation?.quotaPressure || "none");
  const [trend, setTrend] = useState(existingEvaluation?.trend || "unknown");
  const [recommendation, setRecommendation] = useState<Recommendation>(existingEvaluation?.recommendation || "observe");
  const [confidence, setConfidence] = useState<Confidence>(existingEvaluation?.confidence || "low");
  const [evidenceCount, setEvidenceCount] = useState(String(existingEvaluation?.evidenceCount ?? 0));
  const [observationDays, setObservationDays] = useState(String(existingEvaluation?.observationDays ?? 0));
  const [notes, setNotes] = useState(existingSurface?.notes || existingQuota?.notes || existingEvaluation?.note || existingWork?.note || "");

  if (!kind) return null;

  async function submit(next: WorkspaceState, summary: string) {
    setBusy(true);
    setError("");
    try {
      await onSave(next, summary);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (kind === "surface") {
      const row = {
        id: existingSurface?.id || id("surface"), itemId, name: name.trim(), kind: surfaceKind,
        ...(assetId ? { assetId } : {}), ...(deploymentId ? { deploymentId } : {}),
        ...(device.trim() ? { device: device.trim() } : {}), ...(account.trim() ? { account: account.trim() } : {}),
        status: surfaceStatus, ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      const accessSurfaces = existingSurface ? state.accessSurfaces.map((entry) => entry.id === existingSurface.id ? row : entry) : [...state.accessSurfaces, row];
      void submit({ ...state, accessSurfaces }, (existingSurface ? "Updated" : "Added") + " access surface " + row.name);
      return;
    }
    if (kind === "usageLink") {
      const row = {
        id: existingLink?.id || id("usage_link"), entitlementId, label: name.trim(),
        ...(consumerItemId ? { consumerItemId } : {}), ...(surfaceId ? { accessSurfaceId: surfaceId } : {}),
        ...(assetId ? { assetId } : {}), ...(deploymentId ? { deploymentId } : {}),
        ...(allocationPercent !== "" ? { allocationPercent: Number(allocationPercent) } : {}),
      };
      const usageLinks = existingLink ? state.usageLinks.map((entry) => entry.id === existingLink.id ? row : entry) : [...state.usageLinks, row];
      void submit({ ...state, usageLinks }, (existingLink ? "Updated" : "Added") + " usage link " + row.label);
      return;
    }
    if (kind === "quotaPolicy") {
      const row = {
        id: existingQuota?.id || id("quota"), entitlementId, label: name.trim(), metric, windowType,
        ...(windowHours !== "" ? { windowHours: Number(windowHours) } : {}),
        ...(limitValue !== "" ? { limitValue: Number(limitValue) } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      const quotaPolicies = existingQuota ? state.quotaPolicies.map((entry) => entry.id === existingQuota.id ? row : entry) : [...state.quotaPolicies, row];
      void submit({ ...state, quotaPolicies }, (existingQuota ? "Updated" : "Added") + " quota policy " + row.label);
      return;
    }
    if (kind === "evaluation") {
      const row = {
        id: existingEvaluation?.id || id("evaluation"), itemId, evaluatedAt: date, utilization, outputValue,
        quotaPressure, trend, recommendation, confidence, evidenceCount: Number(evidenceCount), observationDays: Number(observationDays),
        ...(notes.trim() ? { note: notes.trim() } : {}),
      };
      const evaluations = existingEvaluation ? state.evaluations.map((entry) => entry.id === existingEvaluation.id ? row : entry) : [...state.evaluations, row];
      void submit({ ...state, evaluations }, (existingEvaluation ? "Updated" : "Added") + " evaluation for " + itemId);
      return;
    }
    const row = {
      id: existingWork?.id || id("work"), itemId, title: name.trim(), occurredAt: date,
      ...(notes.trim() ? { note: notes.trim() } : {}), sourceLabel: existingWork?.sourceLabel || "手工记录",
    };
    const workRecords = existingWork ? state.workRecords.map((entry) => entry.id === existingWork.id ? row : entry) : [...state.workRecords, row];
    void submit({ ...state, workRecords }, (existingWork ? "Updated" : "Added") + " work record " + row.title);
  }

  const title = {
    surface: existingSurface ? "编辑使用入口" : "添加使用入口",
    usageLink: existingLink ? "编辑权益关系" : "建立权益关系",
    quotaPolicy: existingQuota ? "编辑额度规则" : "添加额度规则",
    evaluation: existingEvaluation ? "编辑效率评价" : "添加效率评价",
    workRecord: existingWork ? "编辑工作记录" : "添加工作记录",
  }[kind];

  return <><button className="drawer-backdrop" aria-label="关闭编辑器" onClick={onClose} /><section className="snapshot-modal workspace-editor" role="dialog" aria-modal="true">
    <header><div><span className="kicker">RELATION & EVIDENCE</span><h2>{title}</h2></div><button className="close-button" onClick={onClose}>×</button></header>
    <p>关系、额度和工作价值分别记录；无订阅的 Agent 也可以保存入口、评价和重要工作。</p>
    <form onSubmit={save}>
      {(kind === "surface" || kind === "evaluation" || kind === "workRecord") && <label><span>目录项目 *</span><select required value={itemId} onChange={(event) => setItemId(event.target.value)}>{state.catalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {(kind === "usageLink" || kind === "quotaPolicy") && <label><span>权益 *</span><select required value={entitlementId} onChange={(event) => setEntitlementId(event.target.value)}>{state.entitlements.map((entry) => <option key={entry.id} value={entry.id}>{state.catalog.find((item) => item.id === entry.itemId)?.name} · {entry.label}</option>)}</select></label>}

      {kind === "surface" && <>
        <div className="form-pair"><label><span>入口名称 *</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>类型</span><select value={surfaceKind} onChange={(event) => setSurfaceKind(event.target.value as typeof surfaceKind)}><option value="web">Web</option><option value="mobile">移动端</option><option value="desktop">桌面端</option><option value="cli">CLI</option><option value="api">API</option><option value="bot">Bot</option><option value="message">消息</option><option value="workflow">工作流</option></select></label></div>
        <div className="form-pair"><label><span>资产</span><select value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">不关联</option>{state.assets.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label><label><span>部署</span><select value={deploymentId} onChange={(event) => setDeploymentId(event.target.value)}><option value="">不关联</option>{state.deployments.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label></div>
        <div className="form-pair"><label><span>设备说明</span><input value={device} onChange={(event) => setDevice(event.target.value)} /></label><label><span>账号标签</span><input value={account} onChange={(event) => setAccount(event.target.value)} /></label></div>
        <label><span>可用状态</span><select value={surfaceStatus} onChange={(event) => setSurfaceStatus(event.target.value as typeof surfaceStatus)}><option value="available">可用</option><option value="limited">受限</option><option value="offline">离线 / 归档</option></select></label>
      </>}

      {kind === "usageLink" && <>
        <label><span>关系说明 *</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 ChatGPT Plus 供 Codex Desktop 使用" /></label>
        <div className="form-pair"><label><span>消费项目</span><select value={consumerItemId} onChange={(event) => setConsumerItemId(event.target.value)}><option value="">不指定</option>{state.catalog.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label><label><span>使用入口</span><select value={surfaceId} onChange={(event) => setSurfaceId(event.target.value)}><option value="">不指定</option>{state.accessSurfaces.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label></div>
        <div className="form-pair"><label><span>资产</span><select value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">不指定</option>{state.assets.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label><label><span>部署</span><select value={deploymentId} onChange={(event) => setDeploymentId(event.target.value)}><option value="">不指定</option>{state.deployments.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label></div>
        <label><span>分配比例 %（可选）</span><input type="number" min="0" max="100" value={allocationPercent} onChange={(event) => setAllocationPercent(event.target.value)} /></label>
      </>}

      {kind === "quotaPolicy" && <>
        <label><span>规则名称 *</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="form-pair"><label><span>计量单位</span><select value={metric} onChange={(event) => setMetric(event.target.value as typeof metric)}><option value="tokens">Tokens</option><option value="credits">Credits</option><option value="calls">Calls</option><option value="currency">金额</option><option value="percentage">百分比</option><option value="time">时间</option><option value="unknown">未知</option></select></label><label><span>窗口</span><select value={windowType} onChange={(event) => setWindowType(event.target.value as QuotaWindowType)}><option value="calendar_month">自然月</option><option value="billing_cycle">计费周期</option><option value="fixed_window">固定窗口</option><option value="rolling_window">滚动窗口</option><option value="balance">余额</option><option value="lifetime">终身</option><option value="metered">按量</option></select></label></div>
        <div className="form-pair"><label><span>窗口小时数</span><input type="number" min="0" value={windowHours} onChange={(event) => setWindowHours(event.target.value)} /></label><label><span>额度上限</span><input type="number" min="0" step="any" value={limitValue} onChange={(event) => setLimitValue(event.target.value)} /></label></div>
      </>}

      {kind === "evaluation" && <>
        <label><span>评价日期 *</span><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <div className="form-pair"><label><span>利用程度</span><select value={utilization} onChange={(event) => setUtilization(event.target.value as EvaluationLevel)}>{["none", "low", "normal", "high", "constrained"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>产出价值</span><select value={outputValue} onChange={(event) => setOutputValue(event.target.value as ValueLevel)}>{["unknown", "low", "fair", "good", "core"].map((value) => <option key={value}>{value}</option>)}</select></label></div>
        <div className="form-pair"><label><span>额度压力</span><select value={quotaPressure} onChange={(event) => setQuotaPressure(event.target.value as EvaluationLevel)}>{["none", "low", "normal", "high", "constrained"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>趋势</span><select value={trend} onChange={(event) => setTrend(event.target.value as typeof trend)}>{["rising", "stable", "falling", "unknown"].map((value) => <option key={value}>{value}</option>)}</select></label></div>
        <div className="form-pair"><label><span>建议</span><select value={recommendation} onChange={(event) => setRecommendation(event.target.value as Recommendation)}>{["continue", "observe", "upgrade", "downgrade", "pause", "stop"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>可信度</span><select value={confidence} onChange={(event) => setConfidence(event.target.value as Confidence)}>{["low", "medium", "high"].map((value) => <option key={value}>{value}</option>)}</select></label></div>
        <div className="form-pair"><label><span>证据数量</span><input type="number" min="0" value={evidenceCount} onChange={(event) => setEvidenceCount(event.target.value)} /></label><label><span>观察天数</span><input type="number" min="0" value={observationDays} onChange={(event) => setObservationDays(event.target.value)} /></label></div>
      </>}

      {kind === "workRecord" && <><label><span>工作标题 *</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>发生日期 *</span><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></>}
      {(kind === "surface" || kind === "quotaPolicy" || kind === "evaluation" || kind === "workRecord") && <label><span>备注</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>}
      {error && <em>{error}</em>}
      <footer><span className="form-spacer" /><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy}>{busy ? "保存中…" : "保存"}</button></footer>
    </form>
  </section></>;
}
