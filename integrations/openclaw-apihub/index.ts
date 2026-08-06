import { createHash, createHmac } from "node:crypto";
import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

function gatewayConfig() {
  const baseUrl = (process.env.APIHUB_GATEWAY_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  const token = process.env.APIHUB_OPENCLAW_TOKEN || "";
  const hmacSecret = process.env.APIHUB_OPENCLAW_HMAC_SECRET || "";
  if (!token) throw new Error("APIHUB_OPENCLAW_TOKEN is not configured");
  return { baseUrl, token, hmacSecret };
}

async function gatewayRequest(path: string, payload?: unknown) {
  const config = gatewayConfig();
  const rawBody = payload === undefined ? "" : JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${config.token}`,
    "Content-Type": "application/json",
  };
  if (config.hmacSecret) {
    headers["x-apihub-signature"] = `sha256=${createHmac("sha256", config.hmacSecret).update(rawBody).digest("hex")}`;
  }
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: payload === undefined ? "GET" : "POST",
    headers,
    body: payload === undefined ? undefined : rawBody,
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error || `API Hub returned ${response.status}`);
  return body;
}

function sourceMessageId(sessionKey: string, message: string) {
  const tenMinuteBucket = Math.floor(Date.now() / 600_000);
  return `openclaw:${createHash("sha256").update(`${sessionKey}:${tenMinuteBucket}:${message}`).digest("hex")}`;
}

export default definePluginEntry({
  id: "apihub-gateway",
  name: "API Hub Gateway",
  description: "A narrow, owner-only bridge into API Hub's isolated intake gate.",
  register(api) {
    api.registerTool((ctx) => {
      if (!ctx.senderIsOwner) return null;
      const sessionKey = ctx.sessionKey || ctx.sessionId || "owner-session";
      const senderId = ctx.requesterSenderId || "owner";
      const channel = ctx.messageChannel || "openclaw";
      return {
        name: "apihub_submit_message",
        description: "Submit one API subscription-management message to API Hub for independent parsing, policy validation and human confirmation. This tool never commits directly.",
        parameters: Type.Object({
          message: Type.String({ minLength: 1, maxLength: 12000, description: "The user's subscription-management request verbatim." }),
        }),
        outputSchema: Type.Object({}, { additionalProperties: true }),
        async execute(_id, params) {
          const result = await gatewayRequest("/v1/openclaw/intake", {
            sourceMessageId: sourceMessageId(sessionKey, params.message),
            senderId,
            channel,
            message: params.message,
            timestamp: new Date().toISOString(),
          });
          const text = result.status === "pending_confirmation"
            ? `${result.draft.summary}\n\n确认命令：${result.approval.command}\n该命令会绕过模型并在 ${result.approval.expiresAt} 前有效。`
            : result.status === "needs_clarification"
              ? `API Hub 需要补充信息：${result.issues.map((item: { message: string }) => item.message).join("；")}`
              : result.status === "query_completed"
                ? JSON.stringify(result.results, null, 2)
                : `API Hub 状态：${result.status}`;
          return { content: [{ type: "text", text }], details: result };
        },
      };
    }, { optional: true, name: "apihub_submit_message" });

    api.registerCommand({
      name: "apihub-confirm",
      description: "Confirm one API Hub draft using its one-time approval code.",
      acceptsArgs: true,
      requireAuth: true,
      exposeSenderIsOwner: true,
      handler: async (ctx) => {
        if (!ctx.senderIsOwner) return { text: "此命令仅限 OpenClaw 所有者使用。" };
        const [draftId, approvalCode, ...extra] = (ctx.args || "").trim().split(/\s+/);
        if (!draftId || !/^\d{6}$/.test(approvalCode || "") || extra.length) {
          return { text: "用法：/apihub-confirm <草稿ID> <6位确认码>" };
        }
        try {
          const result = await gatewayRequest(`/v1/openclaw/drafts/${draftId}/commit`, { approvalCode });
          return { text: `已确认写入：${result.subscription.name}` };
        } catch (error) {
          return { text: `确认失败：${error instanceof Error ? error.message : "未知错误"}` };
        }
      },
    });

    api.registerCommand({
      name: "apihub-cancel",
      description: "Cancel one pending API Hub draft.",
      acceptsArgs: true,
      requireAuth: true,
      exposeSenderIsOwner: true,
      handler: async (ctx) => {
        if (!ctx.senderIsOwner) return { text: "此命令仅限 OpenClaw 所有者使用。" };
        const [draftId, ...extra] = (ctx.args || "").trim().split(/\s+/);
        if (!draftId || extra.length) return { text: "用法：/apihub-cancel <草稿ID>" };
        try {
          await gatewayRequest(`/v1/openclaw/drafts/${draftId}/cancel`, {});
          return { text: "草稿已取消，没有写入订阅数据。" };
        } catch (error) {
          return { text: `取消失败：${error instanceof Error ? error.message : "未知错误"}` };
        }
      },
    });
  },
});
