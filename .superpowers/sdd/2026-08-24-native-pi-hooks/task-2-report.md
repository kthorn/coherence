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

## Fix Round 1 — restore non-tool lifecycle activity

### Changed files
- `src/hooks.ts`: restored one guarded top-level `recordActivity` append for every event except `PostToolUse`; the shared `recordLifecycleToolResult` remains the sole PostToolUse append.
- `test/hook-stop.test.ts`: added a real hook CLI SessionStart test proving one persisted non-tool activity row.
- `.superpowers/sdd/2026-08-24-native-pi-hooks/task-2-report.md`: this evidence.

### TDD evidence
- RED command: `node --test test/hook-stop.test.ts --test-name-pattern='non-tool lifecycle'`
- RED output: `1..9`, `# pass 8`, `# fail 1`; expected one activity row, received zero.
- GREEN command: `node --test test/hook-stop.test.ts --test-name-pattern='non-tool lifecycle'`
- GREEN output: `1..9`, `# pass 9`, `# fail 0`.
- Amended focused command: `node --test test/activity.test.ts test/hook-stop.test.ts test/hooks-cli.test.ts`
- Amended focused output: `1..21`, `# pass 21`, `# fail 0`.
- Typecheck command: `npm run typecheck`
- Typecheck output: exit 0.

### Concerns
None for this fix round. The deferred broader-wiring coverage remains out of scope.
