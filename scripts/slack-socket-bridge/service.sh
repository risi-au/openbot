#!/usr/bin/env bash
set -euo pipefail

bridge=openbot-slack-bridge.service
desktop=openbot-personal-autostart.service
bundle="$HOME/.local/opt/openbot-personal/current/resources/slack-socket-bridge"
destination="${XDG_DATA_HOME:-$HOME/.local/share}/systemd/user"

case "${1:-status}" in
  enable|enable-bridge-only)
    test -r "$HOME/.local/state/openbot-slack-bridge.env" || {
      echo "Configure OpenBot Slack before enabling the service." >&2
      exit 1
    }
    install -Dm644 "$bundle/$bridge" "$destination/$bridge"
    install -Dm644 "$bundle/$desktop" "$destination/$desktop"
    systemctl --user daemon-reload
    systemctl --user enable --now "$bridge"
    if [ "$1" = enable ]; then
      systemctl --user enable "$desktop"
    fi
    ;;
  disable)
    systemctl --user disable --now "$bridge"
    systemctl --user disable "$desktop"
    ;;
  status)
    systemctl --user status --no-pager "$bridge"
    ;;
  *)
    echo "Usage: service.sh [enable|enable-bridge-only|disable|status]" >&2
    exit 2
    ;;
esac
