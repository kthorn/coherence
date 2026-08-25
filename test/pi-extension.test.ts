import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { PI_EXTENSION_ID } from "../src/pi-control.ts";
import { loadConfig } from "../src/config.ts";
import { readCalibrationSamples } from "../src/calibration.ts";
import { PI_COHERENCE_EXTENSION_ACK, default as registerPiHooks } from "../src/pi-extension.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "coherence-pi-"));
  const extension = join(process.cwd(), "src/pi-extension.ts");
  await mkdir(join(root, ".pi"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: PI_EXTENSION_ID, pi: { extensions: [relative(root, extension)] } }));
  await writeFile(join(root, "coherence.config.json"), "{}\n");
  await writeFile(join(root, ".pi", "coherence-root"), "./\n");
  return root;
}

function fakePi(root: string, sessionId: string) {
  const handlers = new Map<string, Function>();
  const sent: any[] = [];
  const emitted: any[] = [];
  const pi: any = {
    on(name: string, handler: Function) { handlers.set(name, handler); },
    events: { emit(name: string, payload: unknown) { emitted.push({ name, payload }); } },
    sendMessage(message: unknown, options: unknown) { sent.push({ message, options }); },
  };
  const ctx: any = {
    cwd: root, hasUI: false, ui: { notify() {} },
    sessionManager: { getSessionId: () => sessionId },
  };
  return {
    pi, sent, emitted,
    setContext(nextRoot: string, nextSession: string) { ctx.cwd = nextRoot; ctx.sessionManager.getSessionId = () => nextSession; },
    async fire(name: string, event: unknown) { return handlers.get(name)?.(event, ctx); },
  };
}

test("Pi extension — main settlement stays silent and child settlement triggers exactly one final report without pi-subagents", { concurrency: false }, async () => {
  const root = await fixture();
  const runtime = fakePi(root, "pi-child-session");
  const old = { ...process.env };
  process.env.PI_SUBAGENT_CHILD = "1";
  process.env.PI_SUBAGENT_CHILD_AGENT = "worker";
  try {
    registerPiHooks(runtime.pi);
    await runtime.fire("session_start", { reason: "startup" });
    const started = await runtime.fire("before_agent_start", { systemPrompt: "base", prompt: "work" });
    assert.match(started.systemPrompt, /YOUR SESSION ID IS pi-child-session/);
    await runtime.fire("agent_settled", {});
    await runtime.fire("agent_settled", {});
  } finally {
    process.env = old;
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(runtime.sent.length, 1);
  assert.equal(runtime.sent[0].options.triggerTurn, true);
  assert.equal(runtime.sent[0].options.deliverAs, "followUp");
  assert.match(runtime.sent[0].message.content, /YOUR REPLY MUST RESTATE YOUR FINAL REPORT/);
});

test("Pi extension — acknowledgement and tool results use native telemetry without patching", { concurrency: false }, async () => {
  const root = await fixture();
  const runtime = fakePi(root, "pi-main-session");
  const old = { ...process.env };
  delete process.env.PI_SUBAGENT_CHILD;
  try {
    registerPiHooks(runtime.pi);
    await runtime.fire("session_start", {});
    const readResult = await runtime.fire("tool_result", { type: "tool_result", toolCallId: "call-read", toolName: "read", input: { file_path: "package.json" }, content: [{ type: "text", text: "{}" }], isError: false, details: undefined });
    assert.equal(readResult, undefined);
    const writeResult = await runtime.fire("tool_result", { type: "tool_result", toolCallId: "call-write", toolName: "write", input: { file_path: "observed.txt" }, content: [], isError: false, details: undefined });
    assert.equal(writeResult, undefined);
    const success = await runtime.fire("tool_result", { type: "tool_result", toolCallId: "call-1", toolName: "bash", input: { command: "coherence verify" }, content: [{ type: "text", text: "ok" }], isError: false, details: { exitCode: 0 } });
    assert.equal(success, undefined);
    const failure = await runtime.fire("tool_result", { type: "tool_result", toolCallId: "call-2", toolName: "bash", input: { command: "coherence verify" }, content: [], isError: false, details: { exitCode: 1 } });
    assert.equal(failure, undefined);
    const unknown = await runtime.fire("tool_result", { type: "tool_result", toolCallId: "call-3", toolName: "bash", input: { command: "coherence verify" }, content: [{ type: "text", text: "failed" }], isError: true, details: {} });
    assert.equal(unknown, undefined);
    assert.deepEqual(runtime.emitted, [{ name: "subagent:acknowledge-extension", payload: { id: PI_COHERENCE_EXTENSION_ACK } }]);
    const activity = await readFile(join(root, ".coherence/activity/pi-main-session.jsonl"), "utf8");
    assert.match(activity, /"host":"pi"/);
    assert.match(activity, /"transport":"native"/);
    assert.match(activity, /"result":"success"/);
    assert.match(activity, /"result":"failure"/);
    assert.match(activity, /"result":"unknown"/);
    const traces = await readFile(join(root, ".coherence/read-traces/pi-main-session.jsonl"), "utf8");
    assert.match(traces, /"path":"package.json"/);
  } finally {
    process.env = old;
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi extension — an inactive later session cannot reuse prior activation state", { concurrency: false }, async () => {
  const activeRoot = await fixture();
  const dormantRoot = await mkdtemp(join(tmpdir(), "coherence-pi-dormant-"));
  const runtime = fakePi(activeRoot, "pi-child-session");
  const old = { ...process.env };
  process.env.PI_SUBAGENT_CHILD = "1";
  try {
    registerPiHooks(runtime.pi);
    await runtime.fire("session_start", {});
    runtime.setContext(dormantRoot, "pi-unowned-session");
    delete process.env.PI_SUBAGENT_CHILD;
    await runtime.fire("session_start", {});
    const started = await runtime.fire("before_agent_start", { systemPrompt: "base", prompt: "work" });
    assert.equal(started, undefined);
    await runtime.fire("agent_settled", {});
    assert.equal(runtime.sent.length, 0);
  } finally {
    process.env = old;
    await rm(activeRoot, { recursive: true, force: true });
    await rm(dormantRoot, { recursive: true, force: true });
  }
});

test("Pi extension — main settlement records exact-session evidence without sending a model message", { concurrency: false }, async () => {
  const root = await fixture();
  const runtime = fakePi(root, "pi-main-settlement");
  const old = { ...process.env };
  delete process.env.PI_SUBAGENT_CHILD;
  delete process.env.PI_SUBAGENT_CHILD_AGENT;
  try {
    registerPiHooks(runtime.pi);
    await writeFile(join(root, "observed.txt"), "baseline\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "baseline"], { cwd: root });
    await writeFile(join(root, "observed.txt"), "changed\n");
    await runtime.fire("session_start", {});
    await runtime.fire("tool_result", { type: "tool_result", toolCallId: "call-write-main", toolName: "write", input: { file_path: "observed.txt" }, content: [], isError: false, details: undefined });
    await runtime.fire("tool_result", { type: "tool_result", toolCallId: "call-read-main", toolName: "read", input: { file_path: "package.json" }, content: [{ type: "text", text: "{}" }], isError: false, details: undefined });
    await runtime.fire("agent_settled", {});
    assert.equal(runtime.sent.length, 0);
    const cfg = await loadConfig(root);
    const samples = readCalibrationSamples(cfg);
    assert.equal(samples.length, 1);
    assert.equal(samples[0].session, "pi-main-settlement");
    assert.deepEqual(samples[0].changed, ["observed.txt"]);
    assert.deepEqual(samples[0].observed, ["package.json"]);
  } finally {
    process.env = old;
    await rm(root, { recursive: true, force: true });
  }
});
