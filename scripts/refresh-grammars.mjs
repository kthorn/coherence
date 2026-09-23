#!/usr/bin/env node
// Refresh shipped WASM from exact npm tarballs without installing native grammar
// bindings. Change these pins deliberately, then commit the binaries and provenance.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const GRAMMARS = [
  { pkg: "tree-sitter-typescript", version: "0.23.2", wasm: "tree-sitter-typescript.wasm" },
  { pkg: "tree-sitter-python", version: "0.25.0", wasm: "tree-sitter-python.wasm" },
  { pkg: "tree-sitter-ruby", version: "0.23.1", wasm: "tree-sitter-ruby.wasm" },
];

const provenance = ["# Vendored tree-sitter grammar binaries", "",
  "Prebuilt wasm shipped by each grammar package, copied verbatim by",
  "`node scripts/refresh-grammars.mjs`. Runtime: web-tree-sitter (see package.json).", ""];
const temp = mkdtempSync(join(tmpdir(), "coherence-grammars-"));
try {
  for (const { pkg, version, wasm } of GRAMMARS) {
    const packed = JSON.parse(execFileSync("npm", ["pack", `${pkg}@${version}`, "--ignore-scripts", "--json"], {
      cwd: temp, encoding: "utf8",
    }));
    const bytes = execFileSync("tar", ["-xOf", join(temp, packed[0].filename), `package/${wasm}`], { maxBuffer: 16 * 1024 * 1024 });
    writeFileSync(join(root, "grammars", wasm), bytes);
    provenance.push(`- ${wasm} — ${pkg}@${version}`);
    console.log(`${wasm} <- ${pkg}@${version}`);
  }
  writeFileSync(join(root, "grammars", "PROVENANCE.md"), provenance.join("\n") + "\n");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
