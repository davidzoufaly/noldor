#!/bin/sh
# Native smoke for a built noldor binary (spec Unit 6).
# Usage: scripts/smoke-binary.sh <binary> <expected-version>
# Proves self-containment: PATH stripped of node/npm/pnpm/bun, fixture-local cache.
set -eu

BIN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
EXPECTED_VERSION="$2"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

# npm-channel baseline (tree-equality oracle) — BEFORE the PATH strip, while
# node is still reachable. Same command the binary will run in its fixture.
BASELINE="$WORK/baseline"; mkdir -p "$BASELINE"
( cd "$BASELINE" && git init -q . && node "$REPO_ROOT/bin/noldor.mjs" init >/dev/null 2>&1 ) \
  || { echo "smoke: FAIL — npm-channel baseline init failed" >&2; exit 1; }

# Minimal PATH: symlink git + coreutils, never node/npm/pnpm/bun.
TOOLDIR="$WORK/tools"
mkdir -p "$TOOLDIR"
for t in git sh mkdir rm cp mv ls cat diff grep uname mktemp dirname basename curl find head tr printf sleep pkill; do
  p="$(command -v "$t" || true)"
  [ -n "$p" ] && ln -s "$p" "$TOOLDIR/$t" 2>/dev/null || true
done
export PATH="$TOOLDIR"
export NOLDOR_CACHE_DIR="$WORK/cache"

fail() { echo "smoke: FAIL — $1" >&2; exit 1; }

FIX="$WORK/fixture"; mkdir -p "$FIX"; cd "$FIX"; git init -q .

# 1. --version (also the first run: extraction happens here)
V="$("$BIN" --version 2>"$WORK/first-stderr")" || fail "--version exited non-zero"
case "$V" in *"$EXPECTED_VERSION"*) ;; *) fail "--version printed '$V', expected '$EXPECTED_VERSION'";; esac

# 3. extraction oracle: first run extracted + marker present
grep -q "noldor: extracted assets to" "$WORK/first-stderr" || fail "first run did not log extraction"
find "$NOLDOR_CACHE_DIR" -name .noldor-pack-ok | grep -q . || fail "no cache marker written"

# 2. --help
"$BIN" --help >/dev/null 2>&1 || fail "--help exited non-zero"

# 6. cache-hit: no re-extraction on a later run
"$BIN" --help >/dev/null 2>"$WORK/second-stderr" || fail "second --help exited non-zero"
grep -q "noldor: extracted assets to" "$WORK/second-stderr" && fail "second run re-extracted"

# 4. init materializes templates; adopt refuses; tree matches the npm channel
"$BIN" init >/dev/null 2>&1 || fail "init exited non-zero"
[ -f lefthook.yml ] || fail "init did not materialize lefthook.yml"
diff -r -x .git "$FIX" "$BASELINE" >/dev/null 2>&1 || {
  diff -r -x .git "$FIX" "$BASELINE" | head -10 >&2
  fail "binary init tree differs from npm-channel init tree"
}
if "$BIN" init --adopt >/dev/null 2>"$WORK/adopt-stderr"; then
  fail "init --adopt unexpectedly succeeded on the binary channel"
fi
grep -q "npm channel" "$WORK/adopt-stderr" || fail "adopt refusal lacks the npm-channel pointer"

# 5. minimum toolchain-free workflow (git-only repo value proposition)
"$BIN" validate features >/dev/null 2>&1 || fail "validate features exited non-zero"
set +e
"$BIN" next-priority >/dev/null 2>&1; NP=$?
set -e
[ "$NP" -eq 0 ] || [ "$NP" -eq 2 ] || fail "next-priority exited $NP (expected 0 or 2)"

# 7. detached dashboard self-exec (ensure -> spawnDetachedServer -> re-exec)
PORT=51735
"$BIN" dashboard ensure --port "$PORT" >/dev/null 2>&1 || fail "dashboard ensure exited non-zero"
i=0; ok=""
while [ $i -lt 10 ]; do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then ok=1; break; fi
  i=$((i+1)); sleep 1
done
pkill -f "dashboard server" 2>/dev/null || true
[ -n "$ok" ] || fail "dashboard /health did not serve HTTP 200 within 10s"

echo "smoke: OK ($BIN, $EXPECTED_VERSION)"
