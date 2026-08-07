// index.ts
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
async function gatewayRequest(path, payload) {
  const config = gatewayConfig();
  const rawBody = payload === void 0 ? "" : JSON.stringify(payload);
  const headers = {
    "Authorization": `Bearer ${config.token}`,
    "Content-Type": "application/json"
  };
  if (config.hmacSecret) {
    headers["x-apihub-signature"] = `sha256=${createHmac("sha256", config.hmacSecret).update(rawBody).digest("hex")}`;
  }
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: payload === void 0 ? "GET" : "POST",
    headers,
    body: payload === void 0 ? void 0 : rawBody,
    signal: AbortSignal.timeout(2e4)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error || `API Hub returned ${response.status}`);
  return body;
}
function sourceMessageId(sessionKey, message) {
  const tenMinuteBucket = Math.floor(Date.now() / 6e5);
  return `openclaw:${createHash("sha256").update(`${sessionKey}:${tenMinuteBucket}:${message}`).digest("hex")}`;
}
var index_default = definePluginEntry({
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
          message: Type.String({ minLength: 1, maxLength: 12e3, description: "The user's subscription-management request verbatim." })
        }),
        outputSchema: Type.Object({}, { additionalProperties: true }),
        async execute(_id, params) {
          const result = await gatewayRequest("/v1/openclaw/intake", {
            sourceMessageId: sourceMessageId(sessionKey, params.message),
            senderId,
            channel,
            message: params.message,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
          const text = result.status === "pending_confirmation" ? `${result.draft.summary}

\u786E\u8BA4\u547D\u4EE4\uFF1A${result.approval.command}
\u8BE5\u547D\u4EE4\u4F1A\u7ED5\u8FC7\u6A21\u578B\u5E76\u5728 ${result.approval.expiresAt} \u524D\u6709\u6548\u3002` : result.status === "needs_clarification" ? `API Hub \u9700\u8981\u8865\u5145\u4FE1\u606F\uFF1A${result.issues.map((item) => item.message).join("\uFF1B")}` : result.status === "query_completed" ? JSON.stringify(result.results, null, 2) : `API Hub \u72B6\u6001\uFF1A${result.status}`;
          return { content: [{ type: "text", text }], details: result };
        }
      };
    }, { optional: true, name: "apihub_submit_message" });
    api.registerCommand({
      name: "apihub-confirm",
      description: "Confirm one API Hub draft using its one-time approval code.",
      acceptsArgs: true,
      requireAuth: true,
      exposeSenderIsOwner: true,
      handler: async (ctx) => {
        if (!ctx.senderIsOwner) return { text: "\u6B64\u547D\u4EE4\u4EC5\u9650 OpenClaw \u6240\u6709\u8005\u4F7F\u7528\u3002" };
        const [draftId, approvalCode, ...extra] = (ctx.args || "").trim().split(/\s+/);
        if (!draftId || !/^\d{6}$/.test(approvalCode || "") || extra.length) {
          return { text: "\u7528\u6CD5\uFF1A/apihub-confirm <\u8349\u7A3FID> <6\u4F4D\u786E\u8BA4\u7801>" };
        }
        try {
          const result = await gatewayRequest(`/v1/openclaw/drafts/${draftId}/commit`, { approvalCode });
          return { text: `\u5DF2\u786E\u8BA4\u5199\u5165\uFF1A${result.subscription.name}` };
        } catch (error) {
          return { text: `\u786E\u8BA4\u5931\u8D25\uFF1A${error instanceof Error ? error.message : "\u672A\u77E5\u9519\u8BEF"}` };
        }
      }
    });
    api.registerCommand({
      name: "apihub-cancel",
      description: "Cancel one pending API Hub draft.",
      acceptsArgs: true,
      requireAuth: true,
      exposeSenderIsOwner: true,
      handler: async (ctx) => {
        if (!ctx.senderIsOwner) return { text: "\u6B64\u547D\u4EE4\u4EC5\u9650 OpenClaw \u6240\u6709\u8005\u4F7F\u7528\u3002" };
        const [draftId, ...extra] = (ctx.args || "").trim().split(/\s+/);
        if (!draftId || extra.length) return { text: "\u7528\u6CD5\uFF1A/apihub-cancel <\u8349\u7A3FID>" };
        try {
          await gatewayRequest(`/v1/openclaw/drafts/${draftId}/cancel`, {});
          return { text: "\u8349\u7A3F\u5DF2\u53D6\u6D88\uFF0C\u6CA1\u6709\u5199\u5165\u8BA2\u9605\u6570\u636E\u3002" };
        } catch (error) {
          return { text: `\u53D6\u6D88\u5931\u8D25\uFF1A${error instanceof Error ? error.message : "\u672A\u77E5\u9519\u8BEF"}` };
        }
      }
    });
  }
});
export {
  index_default as default
};
