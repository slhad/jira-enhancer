#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$(cd "$SCRIPT_DIR/../config" && pwd)"
MANIFEST_NAME="com.jira_enhancer.bridge.json"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <chrome-extension-id>"
  echo ""
  echo "Installs the native messaging host manifest for Jira Enhancer Bridge."
  echo "The extension ID can be found on chrome://extensions."
  echo ""
  echo "Example: $0 abcdefghijklmnopqrstuvwxyzabcdef"
  exit 1
fi

EXTENSION_ID="$1"

# Detect OS and set paths
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
    echo "Error: Unsupported OS. This script supports Linux and macOS only."
    echo "For Windows, manually copy the manifest to the registry."
    exit 1
    ;;
esac

# Verify source manifest exists
if [[ ! -f "$SOURCE_MANIFEST" ]]; then
  echo "Error: Source manifest not found at $SOURCE_MANIFEST"
  exit 1
fi

# Create target directory if needed
mkdir -p "$TARGET_DIR"

# Copy manifest, replacing the placeholder with the actual extension ID
sed "s/EXTENSION_ID_PLACEHOLDER/$EXTENSION_ID/g" "$SOURCE_MANIFEST" > "$TARGET_DIR/$MANIFEST_NAME"

echo "Installed manifest to $TARGET_DIR/$MANIFEST_NAME"

# Set permissions on the bridge binary if it exists
BRIDGE_BIN="/usr/local/bin/jira-enhancer-bridge"
if [[ -f "$BRIDGE_BIN" ]]; then
  chmod 755 "$BRIDGE_BIN"
  echo "Set permissions on $BRIDGE_BIN"
else
  echo "Warning: Bridge binary not found at $BRIDGE_BIN"
  echo "Make sure to build and install the bridge before using the extension."
fi

echo "Native messaging host installed successfully."
