#!/usr/bin/env bash
# dogfood.sh — End-to-end venpm workflow against a fresh Discord Canary install.
#
# Uses an isolated config dir so it doesn't touch your existing venpm state.
# Clones a fresh Vencord, configures venpm, installs plugins, rebuilds, launches.
#
# Usage:
#   ./scripts/dogfood.sh              # Full workflow (published GitHub index)
#   ./scripts/dogfood.sh --clean      # Remove dogfood state and exit
#
# Environment variables:
#   LOCAL_INDEX=path/to/plugins.json  # Use a local index + local git repo (pre-push testing)
#   DISCORD_BINARY=/usr/bin/discord   # Override Discord binary (default: discord-canary)
#   VENPM_BIN=/path/to/venpm          # Override venpm binary
#   DOGFOOD_DIR=/tmp/custom-dir       # Override working directory (must be under /tmp/)
#
# Examples:
#   ./scripts/dogfood.sh                                              # Published index
#   LOCAL_INDEX=~/src/vencord-plugins/plugins.json ./scripts/dogfood.sh  # Local index

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

DOGFOOD_DIR="${DOGFOOD_DIR:-/tmp/venpm-dogfood}"
VENCORD_DIR="$DOGFOOD_DIR/Vencord"
CONFIG_DIR="$DOGFOOD_DIR/config"
DISCORD_BINARY="${DISCORD_BINARY:-/usr/bin/discord-canary}"
VENPM_BIN="${VENPM_BIN:-venpm}"
# Optional: serve a local plugins.json instead of fetching from GitHub
LOCAL_INDEX="${LOCAL_INDEX:-}"
# Plugins from the kamaras repo (theokyr/vencord-plugins)
PLUGINS_TO_INSTALL=(settingsHub bsNoMore channelTabs hotkeyNav)

# ─── Helpers ──────────────────────────────────────────────────────────────────

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
red()   { printf '\033[1;31m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }
step()  { printf '\n\033[1;36m── %s ──\033[0m\n' "$*"; }

venpm_cmd() {
    XDG_CONFIG_HOME="$CONFIG_DIR" VENPM_VENCORD_PATH="$VENCORD_DIR" \
        "$VENPM_BIN" "$@"
}

die() { red "FATAL: $*" >&2; exit 1; }

# ─── Clean mode ───────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--clean" ]]; then
    step "Cleaning dogfood state"
    [[ "$DOGFOOD_DIR" == /tmp/* ]] || die "DOGFOOD_DIR '$DOGFOOD_DIR' is outside /tmp — refusing to rm -rf"
    rm -rf "$DOGFOOD_DIR"
    green "Removed $DOGFOOD_DIR"
    exit 0
fi

# ─── Preflight ────────────────────────────────────────────────────────────────

step "Preflight checks"

command -v "$VENPM_BIN" >/dev/null 2>&1 || die "venpm not found (set VENPM_BIN or run: npm run dev)"
command -v git          >/dev/null 2>&1 || die "git not found"
command -v pnpm         >/dev/null 2>&1 || die "pnpm not found"
[[ -x "$DISCORD_BINARY" ]]              || die "Discord binary not found at $DISCORD_BINARY"

VENPM_VERSION=$("$VENPM_BIN" --version 2>&1) || die "venpm --version failed: $VENPM_VERSION"
bold "venpm:    $VENPM_VERSION"
bold "git:      $(git --version | head -1)"
bold "pnpm:     $(pnpm --version)"
bold "discord:  $DISCORD_BINARY"
bold "workdir:  $DOGFOOD_DIR"

# ─── Prepare fresh state ─────────────────────────────────────────────────────

step "Preparing fresh dogfood directory"

[[ "$DOGFOOD_DIR" == /tmp/* ]] || die "DOGFOOD_DIR '$DOGFOOD_DIR' is outside /tmp — refusing to rm -rf"
if [[ -d "$DOGFOOD_DIR" ]]; then
    dim "Removing previous dogfood state..."
    rm -rf "$DOGFOOD_DIR"
fi
mkdir -p "$DOGFOOD_DIR" "$CONFIG_DIR"
green "Created $DOGFOOD_DIR"

# ─── Clone Vencord ────────────────────────────────────────────────────────────

step "Cloning Vencord"

git clone --depth 1 https://github.com/Vendicated/Vencord.git "$VENCORD_DIR"
green "Cloned Vencord to $VENCORD_DIR"

# ─── Install Vencord dependencies ────────────────────────────────────────────

step "Installing Vencord dependencies (pnpm install)"

(cd "$VENCORD_DIR" && pnpm install --frozen-lockfile)
green "Dependencies installed"

# ─── Configure venpm ──────────────────────────────────────────────────────────

step "Configuring venpm (fresh config)"

venpm_cmd config set vencord.path "$VENCORD_DIR"       || die "failed to set vencord.path"
venpm_cmd config set discord.binary "$DISCORD_BINARY"  || die "failed to set discord.binary"
venpm_cmd config set discord.restart never             || die "failed to set discord.restart"
venpm_cmd config set rebuild always                    || die "failed to set rebuild"

# If a local index is provided, serve it over HTTP and point venpm at it
INDEX_SERVER_PID=""
if [[ -n "$LOCAL_INDEX" ]]; then
    [[ -f "$LOCAL_INDEX" ]] || die "LOCAL_INDEX file not found: $LOCAL_INDEX"
    INDEX_PORT=18739
    SERVED_DIR="$DOGFOOD_DIR/served-index"
    mkdir -p "$SERVED_DIR"
    # Rewrite git URLs to the local repo so we don't need a pushed remote
    LOCAL_REPO_DIR="$(dirname "$(realpath "$LOCAL_INDEX")")"
    sed "s|https://github.com/theokyr/vencord-plugins.git|${LOCAL_REPO_DIR}|g" \
        "$LOCAL_INDEX" > "$SERVED_DIR/plugins.json"
    # Serve the rewritten index over HTTP
    python3 -m http.server "$INDEX_PORT" -d "$SERVED_DIR" --bind 127.0.0.1 >/dev/null 2>&1 &
    INDEX_SERVER_PID=$!
    sleep 0.3
    kill -0 "$INDEX_SERVER_PID" 2>/dev/null || die "failed to start local index server"
    LOCAL_INDEX_URL="http://127.0.0.1:${INDEX_PORT}/plugins.json"
    bold "Serving local index: $LOCAL_INDEX_URL (git → $LOCAL_REPO_DIR)"
    # Replace the default repo with our local one
    venpm_cmd repo remove kamaras 2>/dev/null || true
    venpm_cmd repo add "$LOCAL_INDEX_URL" --name kamaras || die "failed to add local repo"
fi

# Ensure local index server is cleaned up on exit
cleanup() {
    [[ -n "$INDEX_SERVER_PID" ]] && kill "$INDEX_SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo
dim "Config written to $CONFIG_DIR/venpm/"
venpm_cmd config path
echo
bold "Current config:"
venpm_cmd doctor

# ─── Install plugins ─────────────────────────────────────────────────────────

step "Installing plugins"

for plugin in "${PLUGINS_TO_INSTALL[@]}"; do
    bold "Installing: $plugin"
    venpm_cmd install "$plugin" --yes --no-build || die "failed to install plugin: $plugin"
    echo
done

green "All plugins installed"

# ─── Verify installed plugins ────────────────────────────────────────────────

step "Verifying installation"

venpm_cmd list
echo

# Check userplugins directory
bold "Userplugins on disk:"
if [[ -d "$VENCORD_DIR/src/userplugins" ]]; then
    ls -la "$VENCORD_DIR/src/userplugins/"
else
    die "userplugins directory missing — installs may have written to wrong path"
fi
echo

# ─── Rebuild Vencord ──────────────────────────────────────────────────────────

step "Rebuilding Vencord (pnpm build)"

venpm_cmd rebuild --no-restart
green "Vencord rebuilt successfully"

# ─── Launch Discord Canary ────────────────────────────────────────────────────

step "Launching Discord Canary"

bold "Starting: $DISCORD_BINARY"
nohup "$DISCORD_BINARY" >/dev/null 2>&1 &
disown
dim "Discord Canary launched"

# ─── Summary ──────────────────────────────────────────────────────────────────

step "Dogfood complete"

green "Workflow summary:"
bold "  Config:     $CONFIG_DIR/venpm/"
bold "  Vencord:    $VENCORD_DIR"
bold "  Plugins:    ${PLUGINS_TO_INSTALL[*]}"
bold "  Discord:    $DISCORD_BINARY"
echo
dim "To clean up:  ./scripts/dogfood.sh --clean"
dim "To re-run:    ./scripts/dogfood.sh"
