import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import registerPiHooks from "../src/pi-extension.ts";
import { HOOK_HOSTS, type HookHost } from "../src/types.ts";

const run = promisify(execFile);

async function filesUnder(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === ".coherence") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else result.push(relative(root, path));
    }
  }
  await visit(root);
  return result.sort();
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "coherence-protected-hosts-"));
  await writeFile(join(root, "coherence.config.json"), '{"protectPrimaryCheckout":true}\n');
  await run("git", ["init", "-q"], { cwd: root });
  await run("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  await run("git", ["config", "user.name", "Test"], { cwd: root });
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["commit", "-qm", "baseline"], { cwd: root });
  return root;
}

type Handler = (event: any, context: any) => unknown;
async function runProtectedPi(root: string): Promise<void> {
  const handlers = new Map<string, Handler>();
  const runtime = {
    on(name: string, handler: Handler) { handlers.set(name, handler); },
    events: { emit() {} },
    sendMessage() {},
  };
  const context = { cwd: root, hasUI: false, ui: { notify() {} }, sessionManager: { getSessionId: () => "pi-cross-host" } };
  registerPiHooks(runtime as any);
  await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, context);
  await handlers.get("before_agent_start")?.({ type: "before_agent_start", systemPrompt: "base", prompt: "work" }, context);
  await handlers.get("tool_result")?.({ type: "tool_result", toolCallId: "cross", toolName: "read", input: { file_path: "coherence.config.json" }, details: undefined, isError: false }, context);
  await handlers.get("agent_settled")?.({ type: "agent_settled" }, context);
}

async function runProtectedLifecycle(host: HookHost): Promise<string[]> {
  const root = await fixture();
  try {
    const baseline = await filesUnder(root);
    if (host === "pi") await runProtectedPi(root);
    else {
      const env = { ...process.env, COHERENCE_PROJECT_ROOT: root, COHERENCE_HOOK_HOST: host, COHERENCE_SESSION: `${host}-cross-host` };
      for (const event of ["SessionStart", "PostToolUse", "Stop"] as const) {
        execFileSync(process.execPath, [join(process.cwd(), "src/hook-cli.ts"), event], {
          cwd: root, env, input: event === "PostToolUse" ? JSON.stringify({ tool_name: "Read", tool_input: { file_path: "coherence.config.json" } }) : "{}",
          stdio: ["pipe", "pipe", "pipe"],
        });
      }
    }
    return (await filesUnder(root)).filter(file => !baseline.includes(file));
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("protected primary checkout stays read-only across CLI, Claude, Codex, and Pi", async () => {
  const observed = new Map<HookHost, string[]>();
  for (const host of HOOK_HOSTS) observed.set(host, await runProtectedLifecycle(host));
  assert.deepEqual([...observed.keys()], [...HOOK_HOSTS]);
  for (const files of observed.values()) assert.deepEqual(files, []);
});
