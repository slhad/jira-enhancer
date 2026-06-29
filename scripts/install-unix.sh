#!/usr/bin/env bash
set -euo pipefail

DEFAULT_SITES=("https://*.atlassian.net/*" "https://*.jira.com/*")
EXTENSION_ID=""
NO_BUILD=0
NO_ENV_WRITE=0
DEFAULTS_ONLY=0
ADDITIONAL_SITES=()

usage() {
  cat <<'USAGE'
Usage: scripts/install-unix.sh [options]

Builds Jira Enhancer for Linux/macOS and installs the Chrome native messaging host
when an extension ID is provided.

Options:
  -e, --extension-id ID       Chrome extension ID from chrome://extensions
  -a, --additional-site SITE  Additional Chrome match pattern/domain (repeatable)
      --defaults-only         Do not prompt for additional domains
      --no-build              Skip pnpm build
      --no-env-write          Do not prompt to save ALLOWED_SITES to .env
  -h, --help                  Show this help

Examples:
  scripts/install-unix.sh
  scripts/install-unix.sh --extension-id abcdefghijklmnopqrstuvwxyzabcdef
  scripts/install-unix.sh -a jira.example.com -e abcdefghijklmnopqrstuvwxyzabcdef
USAGE
}

normalize_match_pattern() {
  local site
  site="$(printf '%s' "$1" | xargs)"
  [[ -z "$site" ]] && return 0

  if [[ ! "$site" =~ ^[A-Za-z][A-Za-z0-9+.-]*:// ]]; then
    site="https://$site"
  fi

  if [[ "$site" != */* ]]; then
    site="$site/*"
  elif [[ "$site" != */ && "$site" != *\* ]]; then
    site="$site/*"
  fi

  printf '%s\n' "$site"
}

append_unique_site() {
  local candidate="$1"
  local existing
  [[ -z "$candidate" ]] && return 0
  for existing in "${ALLOWED_SITES[@]}"; do
    [[ "$existing" == "$candidate" ]] && return 0
  done
  ALLOWED_SITES+=("$candidate")
}

update_env_file() {
  local env_path="$1"
  local value="$2"

  if [[ -f "$env_path" ]]; then
    if grep -qE '^\s*ALLOWED_SITES\s*=' "$env_path"; then
      python - "$env_path" "$value" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
value = sys.argv[2]
lines = path.read_text().splitlines()
lines = [f"ALLOWED_SITES={value}" if line.strip().startswith("ALLOWED_SITES=") else line for line in lines]
path.write_text("\n".join(lines) + "\n")
PY
    else
      printf 'ALLOWED_SITES=%s\n' "$value" >> "$env_path"
    fi
  else
    printf 'ALLOWED_SITES=%s\n' "$value" > "$env_path"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -e|--extension-id)
      EXTENSION_ID="${2:-}"
      shift 2
      ;;
    -a|--additional-site)
      ADDITIONAL_SITES+=("${2:-}")
      shift 2
      ;;
    --defaults-only)
      DEFAULTS_ONLY=1
      shift
      ;;
    --no-build)
      NO_BUILD=1
      shift
      ;;
    --no-env-write)
      NO_ENV_WRITE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument '$1'" >&2
      usage
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_DIR="$REPO_ROOT/packages/bridge/config"
BRIDGE_JS="$REPO_ROOT/packages/bridge/dist/index.js"
EXTENSION_DIST="$REPO_ROOT/packages/extension/dist"
ENV_PATH="$REPO_ROOT/.env"
MANIFEST_NAME="com.jira_enhancer.bridge.json"

case "$(uname -s)" in
  Linux)
    TARGET_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    SOURCE_MANIFEST="$CONFIG_DIR/native-host-manifest.linux.json"
    ;;
  Darwin)
    TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    SOURCE_MANIFEST="$CONFIG_DIR/native-host-manifest.macos.json"
    ;;
  *)
    echo "Error: unsupported OS. Use scripts/install-windows.ps1 on Windows." >&2
    exit 1
    ;;
esac

ALLOWED_SITES=()
for site in "${DEFAULT_SITES[@]}"; do
  append_unique_site "$site"
done
for site in "${ADDITIONAL_SITES[@]}"; do
  append_unique_site "$(normalize_match_pattern "$site")"
done

echo "Jira Enhancer Linux/macOS installer"
echo "Repository: $REPO_ROOT"
echo
echo "Default extension domains:"
for site in "${DEFAULT_SITES[@]}"; do echo "  - $site"; done

if [[ "$DEFAULTS_ONLY" -eq 0 ]]; then
  echo
  echo "Optional: add private Jira domains for this local build."
  echo "Examples: https://jira.example.com/*, jira.example.com, https://*.example.atlassian.net/*"
  read -r -p "Additional domains or match patterns (comma-separated, blank for none): " raw_sites
  if [[ -n "${raw_sites// }" ]]; then
    IFS=',' read -ra prompted_sites <<< "$raw_sites"
    for site in "${prompted_sites[@]}"; do
      append_unique_site "$(normalize_match_pattern "$site")"
    done
  fi
fi

ALLOWED_SITES_VALUE="$(IFS=','; echo "${ALLOWED_SITES[*]}")"

echo
echo "ALLOWED_SITES for this build:"
for site in "${ALLOWED_SITES[@]}"; do echo "  - $site"; done

if [[ "$NO_ENV_WRITE" -eq 0 ]]; then
  read -r -p "Save these domains to gitignored .env for future builds? [Y/n]: " save_env
  if [[ -z "$save_env" || "$save_env" =~ ^[Yy]([Ee][Ss])?$ ]]; then
    update_env_file "$ENV_PATH" "$ALLOWED_SITES_VALUE"
    echo "Updated gitignored .env: $ENV_PATH"
  fi
fi

if [[ "$NO_BUILD" -eq 0 ]]; then
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "Error: required command 'pnpm' was not found on PATH." >&2
    exit 1
  fi
  echo
  echo "Building packages..."
  (cd "$REPO_ROOT" && ALLOWED_SITES="$ALLOWED_SITES_VALUE" pnpm build)
fi

if [[ -d "$EXTENSION_DIST" ]]; then
  echo
  echo "Chrome extension build: $EXTENSION_DIST"
  echo "Load this directory via chrome://extensions -> Developer mode -> Load unpacked."
else
  echo "Warning: extension dist not found at $EXTENSION_DIST. Run without --no-build or run 'pnpm build'." >&2
fi

if [[ -z "$EXTENSION_ID" ]]; then
  echo
  echo "Native host not installed yet because no extension ID was provided."
  echo "After loading the unpacked extension, copy its ID from chrome://extensions and rerun:"
  echo "scripts/install-unix.sh --extension-id <YOUR_EXTENSION_ID>"
  exit 0
fi

if [[ ! "$EXTENSION_ID" =~ ^[a-p]{32}$ ]]; then
  echo "Error: extension ID '$EXTENSION_ID' does not look like a Chrome extension ID (32 chars a-p)." >&2
  exit 1
fi

if [[ ! -f "$SOURCE_MANIFEST" ]]; then
  echo "Error: source manifest not found at $SOURCE_MANIFEST" >&2
  exit 1
fi

if [[ ! -f "$BRIDGE_JS" ]]; then
  echo "Error: bridge build not found at $BRIDGE_JS. Run without --no-build or run 'pnpm build'." >&2
  exit 1
fi

chmod +x "$BRIDGE_JS"
mkdir -p "$TARGET_DIR"

sed \
  -e "s|EXTENSION_ID_PLACEHOLDER|$EXTENSION_ID|g" \
  -e "s|BRIDGE_PATH_PLACEHOLDER|$BRIDGE_JS|g" \
  "$SOURCE_MANIFEST" > "$TARGET_DIR/$MANIFEST_NAME"

echo
echo "Native messaging host installed."
echo "Bridge script : $BRIDGE_JS"
echo "Manifest      : $TARGET_DIR/$MANIFEST_NAME"
echo "Reload the extension in chrome://extensions to pick up the native host."
