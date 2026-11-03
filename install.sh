#!/usr/bin/env bash
set -euo pipefail

BOLD="\033[1m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

print_banner() {
  printf "${CYAN}${BOLD}"
  cat << 'EOF'
╔═══════════════════════════════════════════════════════════════════╗
║  ██████╗  █████╗ ███████╗██████╗  █████╗ ██╗     ██╗   ██╗███████╗║
║  ██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔══██╗██║     ██║   ██║██╔════╝║
║  ██║  ██║███████║█████╗  ██║  ██║███████║██║     ██║   ██║███████╗║
║  ██║  ██║██╔══██║██╔══╝  ██║  ██║██╔══██║██║     ██║   ██║╚════██║║
║  ██████╔╝██║  ██║███████╗██████╔╝██║  ██║███████╗╚██████╔╝███████║║
║  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═════╝ ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚══════╝║
║                                                                   ║
║  o  local-first · embedded router · multi-agent · not sentient o  ║
╚═══════════════════════════════════════════════════════════════════╝
EOF
  printf "${RESET}\n"
}

info() { printf "${CYAN}[daedalus]${RESET} %s\n" "$1"; }
ok()   { printf "${GREEN}[OK]${RESET} %s\n" "$1"; }
warn() { printf "${YELLOW}[WARN]${RESET} %s\n" "$1"; }
err()  { printf "${RED}[ERROR]${RESET} %s\n" "$1" >&2; }

print_banner

OS_NAME="$(uname -s)"
ARCH_NAME="$(uname -m)"
info "Detected platform: ${OS_NAME} (${ARCH_NAME})"

if ! command -v node >/dev/null 2>&1; then
  err "Node.js (>= 20.0.0) is required to run Daedalus."
  printf "\nInstall Node.js 20+ using one of the following:\n"
  printf "  • macOS (Homebrew):  brew install node\n"
  printf "  • fnm (Fast Node):   curl -fsSL https://fnm.vercel.app/install | bash && fnm install 22\n"
  printf "  • nvm:               curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install 22\n"
  printf "  • Official site:     https://nodejs.org/\n"
  exit 1
fi

NODE_VER="$(node -v | sed 's/^v//')"
NODE_MAJOR="$(echo "${NODE_VER}" | cut -d. -f1)"

if [ "${NODE_MAJOR}" -lt 20 ]; then
  err "Found Node.js v${NODE_VER}, but Daedalus requires Node.js >= 20.0.0."
  printf "Please upgrade Node.js (e.g., 'nvm install 22' or 'brew upgrade node') and re-run this installer.\n"
  exit 1
fi

ok "Node.js v${NODE_VER} verified."

if ! command -v npm >/dev/null 2>&1; then
  err "npm is required but was not found in PATH."
  exit 1
fi

PACKAGE_SPEC="${DAEDALUS_VERSION:-daedalus-cli@latest}"
info "Installing ${PACKAGE_SPEC} via npm..."

if npm install -g "${PACKAGE_SPEC}"; then
  ok "Successfully installed ${PACKAGE_SPEC}."
else
  if command -v sudo >/dev/null 2>&1; then
    warn "Global install required elevated permissions or custom prefix. Retrying with sudo..."
    sudo npm install -g "${PACKAGE_SPEC}"
    ok "Successfully installed ${PACKAGE_SPEC} with sudo."
  else
    err "Global install failed and sudo is not available. Please run with elevated permissions."
    exit 1
  fi
fi

if command -v daedalus >/dev/null 2>&1; then
  INSTALLED_VER="$(daedalus --version 2>/dev/null || echo 'latest')"
  ok "Daedalus CLI (${INSTALLED_VER}) is ready in PATH!"
else
  NPM_BIN="$(npm prefix -g)/bin"
  warn "'daedalus' binary installed to ${NPM_BIN}, which may not be in your shell PATH."
  printf "Add this to your ~/.zshrc or ~/.bashrc:\n"
  printf "  export PATH=\"%s:\$PATH\"\n" "${NPM_BIN}"
fi

printf "\n${BOLD}Quick Start:${RESET}\n"
printf "  ${CYAN}daedalus${RESET}                 Launch interactive REPL\n"
printf "  ${CYAN}daedalus --tui${RESET}           Launch interactive Terminal Dashboard (TUI)\n"
printf "  ${CYAN}daedalus --goal \"...\"${RESET}    Execute a one-shot autonomous goal\n\n"
