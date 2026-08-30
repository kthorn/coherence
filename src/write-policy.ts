import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { Config } from "./types.ts";

export type CheckoutKind = "primary" | "linked" | "unknown";
export interface CheckoutIdentity {
  kind: CheckoutKind;
  topLevel: string | null;
  reason?: string;
}
export type WritePolicyState = "disabled" | "linked" | "protected-primary" | "unprovable";
export interface ProjectWritePolicy {
  state: WritePolicyState;
  writable: boolean;
  identity: CheckoutIdentity;
}

export type GitRunner = (args: readonly string[], cwd: string) => string;

const productionRunner: GitRunner = (args, cwd) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 });
  } catch (error) {
    // Older Git releases do not support worktree-list's -z option.
    if (!args.includes("-z")) throw error;
    return execFileSync("git", args.filter(arg => arg !== "-z"), { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 });
  }
};

function canonical(path: string): string {
  return realpathSync(resolve(path));
}

export function classifyGitCheckout(root: string, runGit: GitRunner = productionRunner): CheckoutIdentity {
  try {
    const reportedTop = runGit(["rev-parse", "--show-toplevel"], root).trim();
    if (!reportedTop) return { kind: "unknown", topLevel: null, reason: "Git did not report a top-level checkout" };
    const topLevel = canonical(reportedTop);
    const currentRoot = canonical(root);
    const escaped = relative(topLevel, currentRoot);
    if (escaped === ".." || escaped.startsWith("../") || isAbsolute(escaped)) {
      return { kind: "unknown", topLevel, reason: "configured root is outside Git's reported top-level" };
    }
    const listing = runGit(["worktree", "list", "--porcelain", "-z"], root);
    const fields = listing.split(/\0|\r?\n/);
    const worktrees: string[] = [];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field.startsWith("worktree ")) continue;
      const path = field.slice("worktree ".length).trim();
      const next = fields.findIndex((value, j) => j > i && value.startsWith("worktree "));
      const record = fields.slice(i + 1, next < 0 ? fields.length : next);
      if (!path || !record.some(value => value.startsWith("HEAD "))) {
        return { kind: "unknown", topLevel, reason: "Git returned a malformed worktree identity" };
      }
      worktrees.push(canonical(path));
    }
    if (!worktrees.length) return { kind: "unknown", topLevel, reason: "Git returned no registered worktrees" };
    const index = worktrees.indexOf(topLevel);
    if (index < 0) {
      // A submodule's worktree list identifies its administrative gitdir, not its checkout.
      try {
        const gitFile = readFileSync(resolve(root, ".git"), "utf8").trim();
        const gitdir = gitFile.startsWith("gitdir:") ? canonical(resolve(root, gitFile.slice("gitdir:".length).trim())) : null;
        if (gitdir && worktrees.length === 1 && worktrees[0] === gitdir) return { kind: "primary", topLevel };
      } catch { /* not a submodule or its identity is damaged */ }
      return { kind: "unknown", topLevel, reason: "current checkout is absent from Git's registered worktrees" };
    }
    return { kind: index === 0 ? "primary" : "linked", topLevel };
  } catch {
    return { kind: "unknown", topLevel: null, reason: "Git checkout identity could not be established" };
  }
}

export function projectWritePolicy(cfg: Pick<Config, "root" | "protectPrimaryCheckout">): ProjectWritePolicy {
  if (!cfg.protectPrimaryCheckout) {
    return { state: "disabled", writable: true, identity: { kind: "unknown", topLevel: null, reason: "protection disabled" } };
  }
  const identity = classifyGitCheckout(cfg.root);
  if (identity.kind === "linked") return { state: "linked", writable: true, identity };
  if (identity.kind === "primary") return { state: "protected-primary", writable: false, identity };
  return { state: "unprovable", writable: false, identity };
}

export function writeRefusal(policy: ProjectWritePolicy, operation: string): string[] | null {
  if (policy.writable) return null;
  return [
    `Cannot ${operation}: checkout write policy is ${policy.state}${policy.identity.topLevel ? ` (${policy.identity.topLevel})` : ""}.`,
    "Run from a registered linked worktree.",
  ];
}

export function lifecyclePersistenceNotice(policy: ProjectWritePolicy): string | null {
  if (policy.writable) return null;
  return "COHERENCE PERSISTENCE unavailable: read-only guidance remains active and no evidence will be recorded in this checkout.";
}
