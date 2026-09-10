# AO-04 M3 fast-lane integration

This directory is the isolated M3 acceptance driver. It owns only fresh dated
evidence under `results/`; the old AO-04 compositions and result directories
remain untouched.

## What the integration means

The fast lane remains a generic DAG executor. AO-04 is injected as one
runtime-owned protected tool, `ao04_read_status`, rather than embedded into the
workflow engine or exposed as a second agent loop. A valid AO-04 `ok` result
commits the protected graph node and lets its dependent nodes run. Recovery,
degradation, handoff, cancellation, stale leases, and malformed evidence fail
that node while retaining facts from nodes that already completed.

The standalone AO-04 research platform and its frozen experiments remain the
evidence for the reliability policy itself. M3 demonstrates the product use of
that policy: OpenRush/DSH can execute the same protected controller inside a
normal fast-lane Run without calling the bare Flask dependency or replaying the
whole graph.

The deterministic path uses a runtime-tools substitute. It is deliberately not
a model-driven DeepSeek Harness run: the substitute supplies `read` and
`ao04_read_status` schemas, while `ao04_read_status` is the built TypeScript
tool and performs a real HTTP request to the Python control service. The
control service starts the real `src.tool_app` Python subprocess for each
experiment. The graph itself is the real OpenRush workflow engine via
`runWorkflowFromLoop`.

The protected call path exercised by the driver is:

```text
bindSessionRun (real lease JSON)
  -> executeReadStatus({ query }, { agent: { sessionId }, callId, signal })
  -> POST /experiments/:id/read_status (real HTTP)
  -> ProtectedTool -> real tool_app subprocess
```

The graph path adds `ao04_read_status` through
`eligibleToolNames: ['ao04_read_status']`; the normal safe read-only policy
still admits runtime-injected Keenable search and Amap MCP tools. The protected
tool's runtime host returns a `{ text: JSON }` envelope, so the AO-04 adapter is
exercised at its configured boundary. Normal `read` calls use an ordinary object result.
If a graph fails, the outer agent may temporarily see ordinary read-only tools
to fill a missing fact. The explicitly protected `ao04_read_status` tool stays
hidden from the outer catalog, so the agent cannot bypass its fast-lane node.

## Isolated runtime setup

`prepare-isolated-runtime.sh` copies the three target packages to a temporary
build root, links only the already-installed source toolchain read-only, and
writes all TypeScript build output into that temporary root. It never installs
into either `open-rush/` or the AO04 worktree.

The controller is started with an independent port and data root. The script
uses `AO04_PYTHON` when supplied, then the existing AO-04 project virtualenv,
and finally `python3`; it does not read or print any key values.

For the optional model-driven DSH turn, the wrapper uses Node's
`--env-file-if-exists` to inherit the ignored
`apps/agent-worker/.env.local` from `OPENRUSH_SOURCE_ROOT`. The file is neither
copied into the temporary runtime nor written to evidence. Override its location
with `AO04_AGENT_ENV_FILE`; existing process environment variables take
precedence.

After building the packages, the new composition can be mounted without making a model request:

```bash
DSH_ROOT=/Users/chenxuanchong/projects/CMCC_internship/deepseek-harness \
  node apps/agent-worker/dsh/launch.mjs \
  apps/agent-worker/dsh/cordis-ao04-fastlane.yml </dev/null
```

```bash
cd /Users/chenxuanchong/projects/CMCC_internship/open-rush/.worktrees/ao04-fastlane
ao04-integration/m3-fastlane/prepare-isolated-runtime.sh
```

The default run executes the deterministic matrix and writes a new
`results/run-YYYYMMDDTHHMMSSZ/` directory. To also attempt a model-driven DSH
JSON-RPC run using the available `deepseek-harness` checkout, pass
`M3_MODE=all` through the environment:

```bash
M3_MODE=all ao04-integration/m3-fastlane/prepare-isolated-runtime.sh
```

Verify full runtime acceptance from its raw evidence and SHA-256
manifest:

```bash
node ao04-integration/m3-fastlane/verify-m3.mjs \
  ao04-integration/m3-fastlane/results/run-YYYYMMDDTHHMMSSZ --require-real-dsh --current-source
```

The DSH attempt always starts the same new composition
`apps/agent-worker/dsh/cordis-ao04-fastlane.yml`, the same real lease and
control service, and the existing process configuration from the environment.
It records raw DSH stdout/stderr chunks plus parsed JSON-RPC messages. Missing
model credentials, composition failures, or model non-compliance fail the
requested `all`/`real-dsh` run; they are never represented as deterministic
success. The real DSH case uses existing fixture files with the runtime's
`file_path` schema and injects an exit before the protected call. Acceptance
requires a matching Run, workflow operation and incident, a changed PID, three
consecutive successful recovery probes, a successful protected node, and a
completed DSH turn. Session persistence stays inside the evidence directory.
Omit `--require-real-dsh` only to verify partial coverage, which is labeled explicitly.
`--current-source` additionally checks both review worktrees against the recorded
source hashes. Omit that flag when reviewing a portable evidence-only copy.
The runner checks that temporary package sources match this checkout and rejects
alternative module/plugin overrides for acceptance.

## Acceptance matrix

Each row gets its own experiment, lease file, controller event snapshot, tool
call log, graph result/error, and assertion JSON:

| Scenario | Required evidence |
| --- | --- |
| healthy | graph `read -> ao04_read_status -> read` completes; post node runs once |
| exit-auto | old/new PID differ; `incident.verify` has three consecutive health/business/ownership successes; graph prefix is not replayed |
| timeout-alert | one protected attempt, failed result, no post node, no auto restart |
| timeout-auto | three total timeout attempts, then circuit lock; follow-up skips the dependency without another tool_app call |
| missing-artifact | claimed completion is rejected as `human_required`/`artifact_missing`; handoff evidence exists; post node is blocked |
| concurrent-cancel | overlapping protected calls share the instance; cancellation is accepted without waiting for queued work; results and event order are preserved |

The driver does not intentionally record control tokens or model keys. It stops
only test children it created, by their owned process handles. Temporary build
roots and diagnostic copies are retained for inspection; there is no cleanup
command. Local dependency probes bypass system proxies so a refused loopback
connection cannot be mistaken for a remote proxy timeout.

Verifier negative checks (retain modified copies; never edit the passing run):

```bash
node --test ao04-integration/m3-fastlane/dsh-proof.test.mjs
node ao04-integration/m3-fastlane/check-verifier-attacks.mjs \
  ao04-integration/m3-fastlane/results/run-20260909T033313Z
```

## Evidence files

```text
results/run-.../
  run.json
  manifest.json
  controller.stderr.log
  scenarios/<name>/
    assertions.json
    graph-result.json
    lease.json
    runtime-tool-calls.json
    controller-events.json
    tool-state.json
  dsh-real-attempt/
    status.json
    protocol-messages.json
    stdout-chunks.json
    stderr-chunks.json
    controller-events.json
```

The optional DSH directory is present only when `M3_MODE=all` is selected.
