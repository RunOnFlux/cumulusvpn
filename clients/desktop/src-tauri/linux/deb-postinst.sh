#!/bin/sh
# postinst (.deb): set up the CumulusVPN privileged helper.
#
# 1. The `cumulusvpn` group: its members may use the helper (the socket is
#    root:cumulusvpn mode 0660). Created once, never removed by us.
# 2. The installing user joins it, when we can tell who that is: `sudo apt
#    install ./CumulusVPN.deb` sets SUDO_USER, pkexec sets PKEXEC_UID. A
#    graphical installer (PackageKit) sets neither; the app then explains how
#    to join (sudo usermod -aG cumulusvpn "$USER"). Group membership applies to
#    sessions started after it, so the user logs out and back in once.
# 3. The systemd unit is enabled and (re)started, which also picks up an
#    upgraded binary. Without systemd (a container) this is skipped and the app
#    falls back to running elevated.
set -e

GROUP=cumulusvpn
UNIT=cumulusvpn-helper.service

case "$1" in
  configure | abort-upgrade | abort-remove | abort-deconfigure) ;;
  *) exit 0 ;;
esac

if ! getent group "$GROUP" >/dev/null 2>&1; then
  groupadd --system "$GROUP" 2>/dev/null || addgroup --system "$GROUP" || true
fi

INSTALL_USER="${SUDO_USER:-}"
if [ -z "$INSTALL_USER" ] && [ -n "${PKEXEC_UID:-}" ]; then
  INSTALL_USER="$(getent passwd "$PKEXEC_UID" | cut -d: -f1)"
fi
if [ -n "$INSTALL_USER" ] && [ "$INSTALL_USER" != root ] && id "$INSTALL_USER" >/dev/null 2>&1; then
  if ! id -nG "$INSTALL_USER" | tr ' ' '\n' | grep -qx "$GROUP"; then
    usermod -aG "$GROUP" "$INSTALL_USER" 2>/dev/null || gpasswd -a "$INSTALL_USER" "$GROUP" >/dev/null || true
    echo "CumulusVPN: added $INSTALL_USER to the $GROUP group. Log out and back in once so the app can reach its helper."
  fi
fi

if [ -d /run/systemd/system ]; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable "$UNIT" >/dev/null 2>&1 || true
  systemctl restart "$UNIT" || echo "CumulusVPN: could not start $UNIT (see: journalctl -u $UNIT)"
fi

exit 0
