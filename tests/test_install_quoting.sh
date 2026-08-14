#!/usr/bin/env bash
# Quoting helpers in install/proxmox-install.sh, checked against real parsers.
#
# Guards the failure these helpers exist for: an unquoted
# `Environment=SYNC_API_TOKEN=$TOKEN` line lets systemd split the value on
# whitespace and read % as a specifier prefix, so a token with a space or a %
# reaches server.py truncated or rewritten. The server then falls back to its
# default token and rejects the very token the installer printed.
#
# Run: bash tests/test_install_quoting.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$REPO_ROOT/install/proxmox-install.sh"

failures=0
checks=0

check(){
  local label="$1" actual="$2" expected="$3"
  checks=$((checks + 1))
  if [[ "$actual" == "$expected" ]]; then
    echo "  ok   $label"
  else
    echo "  FAIL $label"
    echo "         expected: $expected"
    echo "         actual:   $actual"
    failures=$((failures + 1))
  fi
}

# Pull the helpers out of the installer rather than sourcing it — sourcing would
# run main() and try to build a container.
extract_function(){
  awk -v fn="$1" '$0 ~ "^" fn "\\(\\)\\{" {inside=1} inside {print} inside && /^\}$/ {exit}' "$INSTALLER"
}

for fn in shell_squote systemd_env_value; do
  body="$(extract_function "$fn")"
  if [[ -z "$body" ]]; then
    echo "  FAIL could not extract $fn() from $INSTALLER"
    failures=$((failures + 1))
  else
    eval "$body"
  fi
done
if (( failures > 0 )); then
  echo
  echo "FAILED — installer helpers missing or renamed"
  exit 1
fi

# systemd resolves %% to a literal % and strips the surrounding quotes. Reproduce
# that reading here, so the test asserts what the service actually receives.
systemd_reads(){
  local line="$1"
  line="${line#Environment=\"}"
  line="${line%\"}"
  line="${line//\\\"/\"}"
  line="${line//\\\\/\\}"
  line="${line//%%/%}"
  printf '%s' "${line#SYNC_API_TOKEN=}"
}

echo "systemd Environment= values"
for token in \
  'plain-hex-0123456789abcdef' \
  'token with spaces' \
  'token-with-%-specifier' \
  '100%%sure' \
  'token"with"quotes' \
  'token\with\backslashes' \
  'tökén-ünïcode' \
  "token'with'singlequotes"
do
  line="Environment=\"SYNC_API_TOKEN=$(systemd_env_value "$token")\""
  check "systemd receives [$token] intact" "$(systemd_reads "$line")" "$token"
done

# The bug this replaced: unquoted, systemd stops the value at the first space.
echo
echo "the unquoted form these helpers replaced"
checks=$((checks + 1))
unquoted='Environment=SYNC_API_TOKEN=token with spaces'
truncated="${unquoted#Environment=SYNC_API_TOKEN=}"
truncated="${truncated%% *}"
if [[ "$truncated" != "token with spaces" ]]; then
  echo "  ok   unquoted form loses the value at the first space (got [$truncated])"
else
  echo "  FAIL unquoted form unexpectedly survived — this test no longer proves anything"
  failures=$((failures + 1))
fi

echo
if command -v systemd-analyze >/dev/null 2>&1; then
  echo "real systemd parsing (systemd-analyze verify)"
  unit_dir="$(mktemp -d)"
  trap 'rm -rf "$unit_dir"' EXIT
  hostile='pa ss%50 "quoted" back\slash'

  write_unit(){
    printf '[Unit]\nDescription=t\n\n[Service]\nType=simple\n%s\nExecStart=/bin/true\n' "$1" > "$2"
  }
  # systemd-analyze exits 0 either way, so the warnings on stderr are the signal.
  env_warnings(){
    systemd-analyze verify "$1" 2>&1 \
      | grep -cE 'Invalid environment assignment|Failed to resolve specifiers' || true
  }

  write_unit "Environment=\"SYNC_API_TOKEN=$(systemd_env_value "$hostile")\"" "$unit_dir/new.service"
  check "systemd parses the quoted form without complaint" "$(env_warnings "$unit_dir/new.service")" "0"

  # If systemd ever stopped mangling the old form, these helpers would be pointless —
  # so assert it still does.
  write_unit "Environment=SYNC_API_TOKEN=$hostile" "$unit_dir/old.service"
  old_warnings="$(env_warnings "$unit_dir/old.service")"
  checks=$((checks + 1))
  if [[ "$old_warnings" -gt 0 ]]; then
    echo "  ok   systemd still mangles the unquoted form ($old_warnings warnings)"
  else
    echo "  FAIL systemd no longer mangles the unquoted form — this test proves nothing"
    failures=$((failures + 1))
  fi
else
  echo "real systemd parsing — skipped (systemd-analyze not installed)"
fi

echo
echo "shell single-quoting"
# The $, ` and " below are literal token characters, not expansions — that is the point.
# shellcheck disable=SC2016
for token in \
  'plain-hex-0123456789abcdef' \
  'token with spaces' \
  "token'with'singlequotes" \
  'token$with$dollars' \
  'token`with`backticks' \
  'token"with"doublequotes'
do
  quoted="$(shell_squote "$token")"
  # eval is the point: the value must survive a real shell round trip.
  roundtrip="$(eval "printf '%s' $quoted")"
  check "shell re-reads [$token] intact" "$roundtrip" "$token"
done

echo
if (( failures > 0 )); then
  echo "FAILED — $failures of $checks checks"
  exit 1
fi
echo "PASSED — $checks checks"
