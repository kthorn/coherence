import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { recordActivity } from "./activity.ts";
import { newSessionId } from "./decisions.ts";
import { PI_HOOK_BUNDLE_FINGERPRINT, resolvePiRuntimeRoot } from "./pi-control.ts";
import {
  prepareChildSettlement,
  prepareSessionStart,
  recordLifecycleToolResult,
  recordMainSettlement,
  type LifecycleIdentity,
} from "./hooks.ts";
import type { Config } from "./types.ts";

export const PI_COHERENCE_EXTENSION_ACK = "@danilocampos.coherence";

function warning(ctx: ExtensionContext, error: unknown): void {
  if (ctx.hasUI) ctx.ui.notify(`Coherence lifecycle unavailable: ${error instanceof Error ? error.message : String(error)}`, "warning");
}

function toolName(name: string): string {
  return name === "bash" ? "Bash" : name === "read" ? "Read" : name === "write" ? "Write"
    : name === "edit" ? "Edit" : name === "grep" ? "Grep" : name === "find" ? "Glob" : name === "ls" ? "LS" : name;
}

function toolPayload(event: ToolResultEvent, identity: LifecycleIdentity): Record<string, unknown> {
  const details = event.details && typeof event.details === "object" ? event.details as Record<string, unknown> : {};
  const response: Record<string, unknown> = { ...details };
  if (typeof details.exitCode === "number" && Number.isInteger(details.exitCode)) response.exitCode = details.exitCode;
  return {
    session_id: identity.session,
    agent_id: identity.agent === "main" ? undefined : identity.session,
    tool_name: toolName(event.toolName),
    tool_use_id: event.toolCallId,
    tool_input: event.input,
    tool_response: response,
    isError: event.isError,
  };
}

export default function registerPiHooks(pi: ExtensionAPI): void {
  let config: Config | null = null;
  let identity: LifecycleIdentity | null = null;
  let childFeedbackSent = false;

  pi.on("session_start", async (_event, ctx) => {
    config = null;
    identity = null;
    childFeedbackSent = false;
    try {
      const selected = resolvePiRuntimeRoot(ctx.cwd, fileURLToPath(import.meta.url));
      if (!selected.active) return;
      const loaded = await loadConfig(selected.root);
      if (!loaded.declared) return;
      config = loaded;
      const session = ctx.sessionManager.getSessionId()?.trim() || newSessionId();
      const child = process.env.PI_SUBAGENT_CHILD === "1";
      identity = {
        session,
        agent: process.env.PI_SUBAGENT_CHILD_AGENT?.trim() || (child ? "subagent" : "main"),
        job: process.env.PI_SUBAGENT_RUN_ID?.trim() || session,
        host: "pi", transport: "native", bundleHash: PI_HOOK_BUNDLE_FINGERPRINT,
      };
      childFeedbackSent = false;
      recordActivity(config, "SessionStart", { session_id: session, ...(child ? { agent_id: session } : {}) }, {
        host: "pi", transport: "native", bundleHash: PI_HOOK_BUNDLE_FINGERPRINT, experimentId: null,
      });
      await prepareSessionStart(config, "SessionStart", identity);
      pi.events.emit("subagent:acknowledge-extension", { id: PI_COHERENCE_EXTENSION_ACK });
    } catch (error) { warning(ctx, error); }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!config || !identity) return;
    try {
      const systemPrompt = await prepareSessionStart(config, "SessionStart", identity);
      return { systemPrompt: `${event.systemPrompt}\n${systemPrompt}` };
    } catch (error) { warning(ctx, error); return undefined; }
  });

  pi.on("tool_result", async (event, _ctx) => {
    if (!config || !identity) return undefined;
    recordLifecycleToolResult(config, toolPayload(event, identity), { host: "pi", transport: "native", bundleHash: PI_HOOK_BUNDLE_FINGERPRINT, experimentId: null });
    return undefined;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!config || !identity) return;
    try {
      recordActivity(config, identity.agent === "main" ? "Stop" : "SubagentStop", { session_id: identity.session, ...(identity.agent === "main" ? {} : { agent_id: identity.session }) }, { host: "pi", transport: "native", bundleHash: PI_HOOK_BUNDLE_FINGERPRINT, experimentId: null });
      if (identity.agent === "main") {
        await recordMainSettlement(config, identity.session);
      } else if (!childFeedbackSent) {
        childFeedbackSent = true;
        const feedback = await prepareChildSettlement(config, identity.session);
        pi.sendMessage({ customType: "coherence-subagent-stop", content: feedback, display: true }, { deliverAs: "followUp", triggerTurn: true });
      }
    } catch (error) { warning(ctx, error); }
  });
}
