#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_ROOT="${OPENRUSH_SOURCE_ROOT:-$(cd "$TARGET_ROOT/../.." && pwd)}"
CONTROLLER_ROOT="${AO04_CONTROLLER_ROOT:-$(cd "$TARGET_ROOT/../../.." && pwd)/ao04-fastlane-controller}"
AGENT_ENV_FILE="${AO04_AGENT_ENV_FILE:-$SOURCE_ROOT/apps/agent-worker/.env.local}"

if [[ ! -d "$SOURCE_ROOT/node_modules/.pnpm" ]]; then
  echo "prepare-isolated-runtime: source pnpm store is missing: $SOURCE_ROOT/node_modules/.pnpm" >&2
  exit 1
fi
if [[ ! -f "$CONTROLLER_ROOT/src/reliability/control_app.py" ]]; then
  echo "prepare-isolated-runtime: controller not found: $CONTROLLER_ROOT" >&2
  exit 1
fi

RUNTIME_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ao04-m3-runtime.XXXXXX")"
# Retain this uniquely allocated build root for inspection; do not delete files.
printf 'M3 build root retained: %s\n' "$RUNTIME_ROOT"

mkdir -p \
  "$RUNTIME_ROOT/repo/packages/workflow/node_modules/.bin" \
  "$RUNTIME_ROOT/repo/packages/dsh-tool-ao04/node_modules/.bin" \
  "$RUNTIME_ROOT/repo/packages/dsh-tool-workflow-run/node_modules/.bin" \
  "$RUNTIME_ROOT/repo/packages/dsh-tool-workflow-run/node_modules/@open-rush"

copy_package() {
  local name="$1"
  rsync -a \
    --exclude='node_modules/' \
    --exclude='dist/' \
    --exclude='coverage/' \
    --exclude='.turbo/' \
    --exclude='.env' \
    --exclude='.env.*' \
    "$TARGET_ROOT/packages/$name/" "$RUNTIME_ROOT/repo/packages/$name/"
}

copy_package workflow
copy_package dsh-tool-ao04
copy_package dsh-tool-workflow-run
cp "$TARGET_ROOT/tsconfig.base.json" "$RUNTIME_ROOT/repo/tsconfig.base.json"

link_dep() {
  local package_dir="$1"
  local dep="$2"
  ln -s "$SOURCE_ROOT/packages/workflow/node_modules/$dep" "$RUNTIME_ROOT/repo/packages/$package_dir/node_modules/$dep"
}

for dep in vitest zod tsup tsx typescript; do
  link_dep workflow "$dep"
done
ln -s "$SOURCE_ROOT/packages/workflow/node_modules/@types" \
  "$RUNTIME_ROOT/repo/packages/workflow/node_modules/@types"
ln -s "$SOURCE_ROOT/packages/workflow/node_modules/.bin/vitest" \
  "$RUNTIME_ROOT/repo/packages/workflow/node_modules/.bin/vitest"
ln -s "$SOURCE_ROOT/packages/workflow/node_modules/.bin/tsup" \
  "$RUNTIME_ROOT/repo/packages/workflow/node_modules/.bin/tsup"

for dep in vitest tsup typescript; do
  link_dep dsh-tool-ao04 "$dep"
  link_dep dsh-tool-workflow-run "$dep"
done
ln -s "$SOURCE_ROOT/packages/workflow/node_modules/@types" \
  "$RUNTIME_ROOT/repo/packages/dsh-tool-ao04/node_modules/@types"
ln -s "$SOURCE_ROOT/packages/workflow/node_modules/@types" \
  "$RUNTIME_ROOT/repo/packages/dsh-tool-workflow-run/node_modules/@types"
ln -s "$SOURCE_ROOT/packages/workflow/node_modules/.bin/vitest" \
  "$RUNTIME_ROOT/repo/packages/dsh-tool-ao04/node_modules/.bin/vitest"
ln -s "$SOURCE_ROOT/packages/workflow/node_modules/.bin/tsup" \
  "$RUNTIME_ROOT/repo/packages/dsh-tool-ao04/node_modules/.bin/tsup"
ln -s "$SOURCE_ROOT/packages/workflow/node_modules/.bin/vitest" \
  "$RUNTIME_ROOT/repo/packages/dsh-tool-workflow-run/node_modules/.bin/vitest"
ln -s "$SOURCE_ROOT/packages/workflow/node_modules/.bin/tsup" \
  "$RUNTIME_ROOT/repo/packages/dsh-tool-workflow-run/node_modules/.bin/tsup"
ln -s "$RUNTIME_ROOT/repo/packages/workflow" \
  "$RUNTIME_ROOT/repo/packages/dsh-tool-workflow-run/node_modules/@open-rush/workflow"

(cd "$RUNTIME_ROOT/repo/packages/workflow" && pnpm build)
(cd "$RUNTIME_ROOT/repo/packages/dsh-tool-ao04" && pnpm build)
(cd "$RUNTIME_ROOT/repo/packages/dsh-tool-workflow-run" && pnpm build)

export M3_RUNTIME_ROOT="$RUNTIME_ROOT/repo"
export AO04_CONTROLLER_ROOT="$CONTROLLER_ROOT"
export AO04_WORKFLOW_RUN_PLUGIN="$RUNTIME_ROOT/repo/packages/dsh-tool-workflow-run/dist/index.js"
export AO04_READ_STATUS_PLUGIN="$RUNTIME_ROOT/repo/packages/dsh-tool-ao04/dist/index.js"

MODE="${M3_MODE:-deterministic}"
node \
  --env-file-if-exists="$AGENT_ENV_FILE" \
  --experimental-strip-types \
  "$SCRIPT_DIR/run-m3-fastlane.mjs" \
  --mode "$MODE"
