# Task 3 report — Native Pi extension and optional child completion

## Implementation

Implemented the native Pi extension using only the public `@earendil-works/pi-coding-agent` API. The extension:

- resolves and validates the mapped project runtime root;
- remains dormant when the project configuration is absent or Pi control is not mapped to this package;
- initializes exact Pi session identity and native host/transport telemetry;
- performs shared startup preparation on `session_start` and fresh instruction composition on `before_agent_start`;
- records read/write/bash tool telemetry without returning result patches;
- classifies verification only from an explicit integer `details.exitCode`;
- emits the documented acknowledgement event with the stable extension ID;
- keeps main settlement model-silent;
- sends one child `followUp`/`triggerTurn` report with the guard set before awaiting composition.

No `pi-subagents` import or dependency was added.

## Changed files

- `src/pi-extension.ts` — native extension registration and event-to-payload mapping.
- `test/pi-extension.test.ts` — public-shape fake and observable lifecycle/telemetry tests.
- `package.json` — optional Pi peer contract, dev dependency, Pi extension manifest, and `pi-package` keyword.
- `package-lock.json` — npm-generated dependency lock updates.

## Self-review

- Scope is limited to the four requested package/source/test files; this report is the required task artifact.
- The extension uses the established `resolvePiRuntimeRoot`, fingerprint, lifecycle identity, and shared lifecycle helpers.
- Main settlement sends no message; repeated child settlement sends exactly one.
- The tool handler returns `undefined` and does not mutate successful tool results.
- Telemetry persistence failures are contained by the shared helper; lifecycle boundary failures notify only when UI is available.
- The fake exposes the public event registration, event bus, `sendMessage`, session manager, and UI shape needed by the adapter; assertions inspect filesystem/event/message side effects rather than mock-call counts.

## TDD evidence

RED command (before `src/pi-extension.ts` existed):

```text
$ node --test test/pi-extension.test.ts
not ok 1 - test/pi-extension.test.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/pi-extension.ts'
```

GREEN command:

```text
$ node --test test/pi-extension.test.ts
ok 1 - Pi extension — main settlement stays silent and child settlement triggers exactly one final report without pi-subagents
ok 2 - Pi extension — acknowledgement and tool results use native telemetry without patching
1..2
# tests 2
# pass 2
# fail 0
```

The tests cover one child report despite two settlements, silent main settlement behavior, fresh startup instructions, acknowledgement payload, native activity, read trace, explicit `exitCode` success/failure, and unknown result when only prose/`isError` is present.

## Packaging/typecheck/build evidence

```text
$ npm run typecheck
$ npm run build
$ test -f dist/pi-extension.js
```

All commands exited 0. `dist/pi-extension.js` exists.

## Full-suite evidence

```text
$ npm test
```

The full suite exceeded the 300-second outer timeout. The last visible completed test was subtest 519, `orientation priority: resolve-conflict dominates synthesize`; the process was still running when the timeout terminated it. No full-suite pass is claimed.

## Concerns

- Full-suite completion is unverified because of the outer timeout; focused tests, typecheck, and build passed.
- The extension deliberately relies on the host-provided Pi dependency at runtime; consumers without Pi remain unaffected because the peer is optional and the extension is dormant unless mapped.
