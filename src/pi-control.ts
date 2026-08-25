import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { mkdir, rm, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./types.ts";

export const PI_EXTENSION_ID = "@danilocampos/coherence";
export const PI_HOOK_PROTOCOL_VERSION = 1 as const;
export const PI_HOOK_BUNDLE_FINGERPRINT = `pi-${PI_HOOK_PROTOCOL_VERSION}`;

type JsonObject = Record<string, unknown>;
interface SettingsRead {
  path: string; exists: boolean; valid: boolean; value: JsonObject;
  indent: string | number; newline: boolean; mode?: number; error?: string;
}

function object(value: unknown): value is JsonObject { return !!value && typeof value === "object" && !Array.isArray(value); }
function packageManifest(root: string): JsonObject | null {
  try { const value = JSON.parse(readFileSync(join(root, "package.json"), "utf8")); return object(value) ? value : null; } catch { return null; }
}
function packageRoot(cfg: Config): string {
  const declared = packageManifest(resolve(cfg.root));
  if (declared?.name === PI_EXTENSION_ID) return resolve(cfg.root);
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (packageManifest(dir)?.name === PI_EXTENSION_ID) return dir;
    const parent = dirname(dir); if (parent === dir) break; dir = parent;
  }
  return resolve(cfg.root);
}
function manifestExtension(root: string): string | null {
  const manifest = packageManifest(root);
  const extensions = object(manifest?.pi) && Array.isArray(manifest.pi.extensions) ? manifest.pi.extensions : [];
  const extension = extensions.length === 1 && typeof extensions[0] === "string" ? extensions[0] : null;
  return extension ? resolve(root, extension) : null;
}
function projectRoot(cfg: Config): string { return resolve(cfg.root, cfg.piProjectRoot ?? "."); }
function settingsPath(cfg: Config): string { return join(projectRoot(cfg), ".pi", "settings.json"); }
function mappingPath(cfg: Config): string { return join(projectRoot(cfg), ".pi", "coherence-root"); }
function canonicalEntry(cfg: Config): string { return relative(join(projectRoot(cfg), ".pi"), packageRoot(cfg)).replaceAll("\\", "/") || "."; }
function expectedMapping(cfg: Config): string { return `${relative(projectRoot(cfg), resolve(cfg.root)).replaceAll("\\", "/") || "."}\n`; }

function readSettings(cfg: Config): SettingsRead {
  const path = settingsPath(cfg);
  if (!existsSync(path)) return { path, exists: false, valid: true, value: {}, indent: 2, newline: true };
  try {
    const raw = readFileSync(path, "utf8");
    const value = JSON.parse(raw);
    if (!object(value)) throw new Error("settings must be a JSON object");
    const match = raw.match(/^\s+"/m);
    return { path, exists: true, valid: true, value, indent: match ? match[0].length - 1 : 2, newline: raw.endsWith("\n"), mode: statSync(path).mode & 0o777 };
  } catch (error) { return { path, exists: true, valid: false, value: {}, indent: 2, newline: true, error: error instanceof Error ? error.message : String(error) }; }
}
function managedEntry(entry: unknown, cfg: Config, extension: string | null): boolean {
  if (typeof entry !== "string" || entry.startsWith("npm:") || entry.startsWith("@")) return false;
  const resolved = resolve(join(projectRoot(cfg), ".pi"), entry);
  return packageManifest(resolved)?.name === PI_EXTENSION_ID || resolved === extension;
}
function format(value: JsonObject, read: SettingsRead): string {
  const text = JSON.stringify(value, null, read.indent) + (read.newline ? "\n" : "");
  return text;
}
async function atomic(path: string, content: string, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.coherence-${process.pid}-${Date.now()}`;
  await writeFile(temp, content, mode === undefined ? undefined : { mode });
  await rename(temp, path);
}

export function resolvePiProjectRoot(cfg: Config): string { return projectRoot(cfg); }

export interface PiLifecycleInspection {
  host: "pi"; present: boolean; configured: boolean; valid: boolean;
  settings: { path: string; exists: boolean; valid: boolean; canonicalEntries: number; managedEntries: number; error?: string };
  mapping: { path: string; present: boolean; expected: string; actual?: string };
  target: { packageRoot: string; extensionPath: string; present: boolean };
  bundleFingerprint: string; warnings: string[];
}
export interface PiLifecycleMutation { inspection: PiLifecycleInspection; changed: string[]; errors: string[]; }

export function inspectPiLifecycleHook(cfg: Config): PiLifecycleInspection {
  const read = readSettings(cfg), root = packageRoot(cfg), extension = manifestExtension(root), entry = canonicalEntry(cfg);
  const packages = read.valid && (read.value.packages === undefined || Array.isArray(read.value.packages)) ? (read.value.packages as unknown[] | undefined) ?? [] : [];
  const managedEntries = packages.filter((value) => managedEntry(value, cfg, extension)).length;
  const canonicalEntries = packages.filter((value) => value === entry).length;
  const mapPath = mappingPath(cfg), actual = existsSync(mapPath) ? readFileSync(mapPath, "utf8") : undefined;
  const targetPresent = !!extension && existsSync(extension) && statSafeFile(extension);
  const valid = read.valid && (read.value.packages === undefined || Array.isArray(read.value.packages));
  const present = valid && canonicalEntries === 1 && managedEntries === 1 && actual === expectedMapping(cfg) && targetPresent && !!extension;
  return { host: "pi", present, configured: valid && canonicalEntries === 1 && actual === expectedMapping(cfg), valid,
    settings: { path: read.path, exists: read.exists, valid, canonicalEntries, managedEntries, ...(read.error ? { error: read.error } : {}) },
    mapping: { path: mapPath, present: actual !== undefined, expected: expectedMapping(cfg), ...(actual === undefined ? {} : { actual }) },
    target: { packageRoot: root, extensionPath: extension ?? "", present: targetPresent }, bundleFingerprint: PI_HOOK_BUNDLE_FINGERPRINT, warnings: [] };
}
function statSafeFile(path: string): boolean { try { return lstatSync(path).isFile(); } catch { return false; } }

export async function setPiLifecycleHook(cfg: Config, present: boolean): Promise<PiLifecycleMutation> {
  const before = inspectPiLifecycleHook(cfg), changed: string[] = [], errors: string[] = [], read = readSettings(cfg);
  if (!read.valid) return { inspection: before, changed, errors: [`${read.path}: ${read.error}`] };
  const root = packageRoot(cfg), extension = manifestExtension(root);
  if (present && !extension) return { inspection: before, changed, errors: ["Pi extension target is missing from the package manifest"] };
  if (present && !statSafeFile(extension!)) return { inspection: before, changed, errors: ["Pi extension target is missing"] };
  const packages = read.value.packages === undefined ? [] : read.value.packages;
  if (!Array.isArray(packages)) return { inspection: before, changed, errors: [`${read.path}: packages must be an array`] };
  const entry = canonicalEntry(cfg), managed = packages.filter((value) => managedEntry(value, cfg, extension));
  const next = structuredClone(read.value);
  if (present) {
    if (!packages.includes(entry)) next.packages = [...packages, entry];
    if (!packages.includes(entry)) { await atomic(read.path, format(next, read), read.mode); changed.push(read.path); }
    const expected = expectedMapping(cfg), current = existsSync(mappingPath(cfg)) ? readFileSync(mappingPath(cfg), "utf8") : undefined;
    if (current !== expected) { await atomic(mappingPath(cfg), expected); changed.push(mappingPath(cfg)); }
  } else {
    const filtered = packages.filter((value) => value !== entry);
    if (filtered.length !== packages.length) { next.packages = filtered; await atomic(read.path, format(next, read), read.mode); changed.push(read.path); }
    const current = existsSync(mappingPath(cfg)) ? readFileSync(mappingPath(cfg), "utf8") : undefined;
    if (current === expectedMapping(cfg)) { await rm(mappingPath(cfg)); changed.push(mappingPath(cfg)); }
  }
  return { inspection: inspectPiLifecycleHook(cfg), changed: [...new Set(changed)], errors };
}

export function resolvePiRuntimeRoot(cwd: string, extensionPath: string): { active: true; root: string } | { active: false; reason: string } {
  let dir = resolve(cwd);
  while (true) {
    const map = join(dir, ".pi", "coherence-root");
    if (existsSync(map)) {
      const rel = readFileSync(map, "utf8"); if (!rel.endsWith("\n") || rel.slice(0, -1).includes("\n")) return { active: false, reason: "invalid Pi coherence mapping" };
      const root = resolve(dir, rel.trim());
      const target = manifestExtension(root); if (target && resolve(extensionPath) === target) return { active: true, root };
      return { active: false, reason: "extension is not the mapped coherence package" };
    }
    const parent = dirname(dir); if (parent === dir) break; dir = parent;
  }
  return { active: false, reason: "Pi project control is absent" };
}
