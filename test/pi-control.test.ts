import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { cfg, tmpProject } from "./_helpers.ts";
import { inspectPiLifecycleHook, resolvePiRuntimeRoot, setPiLifecycleHook } from "../src/pi-control.ts";

test("Pi control — install is exact, idempotent, preserving, and nested-root aware", async () => {
  const host = await tmpProject({
    ".pi/settings.json": JSON.stringify({ packages: ["npm:other"], theme: "dark" }, null, 2) + "\n",
  });
  const root = join(host, "app");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "@danilocampos/coherence",
    pi: { extensions: ["./dist/pi-extension.js"] },
  }));
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist/pi-extension.js"), "export default () => {};\n");
  const config = cfg(root, { piProjectRoot: ".." });

  const first = await setPiLifecycleHook(config, true);
  assert.equal(first.inspection.present, true);
  assert.deepEqual(JSON.parse(await readFile(join(host, ".pi/settings.json"), "utf8")), {
    packages: ["npm:other", "../app"],
    theme: "dark",
  });
  assert.equal(await readFile(join(host, ".pi/coherence-root"), "utf8"), "app\n");
  assert.deepEqual((await setPiLifecycleHook(config, true)).changed, []);
});

test("Pi control — malformed and competing settings fail closed", async () => {
  const host = await tmpProject({ ".pi/settings.json": "{broken\n" });
  assert.equal(inspectPiLifecycleHook(cfg(host)).valid, false);
  const root = join(host, "app");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "@danilocampos/coherence", pi: { extensions: ["./dist/pi-extension.js"] } }));
  await writeFile(join(root, "dist/pi-extension.js"), "x");
  await writeFile(join(host, ".pi/settings.json"), JSON.stringify({ packages: ["../app", "../app"] }));
  assert.equal(inspectPiLifecycleHook(cfg(root, { piProjectRoot: ".." })).present, false);
});

test("Pi control — missing target refuses and uninstall preserves mapping drift", async () => {
  const host = await tmpProject();
  const root = join(host, "app");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "@danilocampos/coherence", pi: { extensions: ["./dist/pi-extension.js"] } }));
  const config = cfg(root, { piProjectRoot: ".." });
  assert.match((await setPiLifecycleHook(config, true)).errors.join("\n"), /extension target is missing/i);
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist/pi-extension.js"), "x");
  await setPiLifecycleHook(config, true);
  await writeFile(join(host, ".pi/coherence-root"), "operator changed this\n");
  await setPiLifecycleHook(config, false);
  assert.equal(await readFile(join(host, ".pi/coherence-root"), "utf8"), "operator changed this\n");
});

test("Pi control — runtime activates only the mapped extension", async () => {
  const host = await tmpProject();
  const root = join(host, "app");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "@danilocampos/coherence", pi: { extensions: ["./dist/pi-extension.js"] } }));
  const extension = join(root, "dist/pi-extension.js");
  await writeFile(extension, "x");
  const config = cfg(root, { piProjectRoot: ".." });
  await setPiLifecycleHook(config, true);
  await mkdir(join(host, "nested"), { recursive: true });
  assert.deepEqual(resolvePiRuntimeRoot(join(host, "nested"), extension), { active: true, root });
  assert.equal(resolvePiRuntimeRoot(join(host, "nested"), join(root, "other.js")).active, false);
});
