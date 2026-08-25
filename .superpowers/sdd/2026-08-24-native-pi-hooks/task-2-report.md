# Task 2 report — shared lifecycle seams and native telemetry

## Implementation
- Extended strict activity and read-trace host/transport vocabularies with `pi` and `native`.
- Added explicit `ActivityContext` support to `recordHookReads`, retaining environment fallback when omitted.
- Added reusable startup, tool-result, main-settlement, and child-settlement lifecycle helpers.
- Rewired `runHook` to use the shared startup and settlement operations and to record PostToolUse activity exactly once with independent telemetry failure containment.
- Preserved Claude/Codex envelopes, malformed stdin handling, main Stop silence, child feedback, and dependency-light PostToolUse imports.

## Changed files
- `src/activity.ts`
- `src/read-trace.ts`
- `src/hooks.ts`
- `test/activity.test.ts`
- `test/hook-stop.test.ts`

## Self-review
- Native provenance is explicit `host: pi`, `transport: native`; no launcher relabeling was added.
- `currentSessionSummary.launcher` remains launcher-only.
- Existing explicit temporary Pi refusals in external control paths were not changed.
- PostToolUse no longer receives the old unconditional activity append, avoiding duplicate physical rows.
- No new dependency was added; `pi-subagents` remains absent.

## TDD evidence
1. RED telemetry:
   - Command: `node --test test/activity.test.ts`
   - Output: `1..9`, `# pass 8`, `# fail 1`; Pi native row expected `native`, received `undefined`.
2. GREEN telemetry:
   - Command: `node --test test/activity.test.ts`
   - Output: `1..9`, `# pass 9`, `# fail 0`.
3. RED lifecycle:
   - Command: `node --test test/hook-stop.test.ts`
   - Output: module import failure: `does not provide an export named 'prepareChildSettlement'`.
4. Focused GREEN:
   - Command: `node --test test/activity.test.ts test/hook-stop.test.ts test/hooks-cli.test.ts`
   - Output: `1..20`, `# pass 20`, `# fail 0`.
5. Typecheck:
   - Command: `npm run typecheck`
   - Output: exit 0.
6. Full suite attempt:
   - Command: `npm test`
   - Output: suite progressed through at least test 533 with no reported failures before the 300-second execution timeout; focused tests and typecheck passed afterward.

## Concerns
The repository-wide suite exceeds the available execution timeout in this environment; it was not observed to completion. No focused regressions or type errors remain.
