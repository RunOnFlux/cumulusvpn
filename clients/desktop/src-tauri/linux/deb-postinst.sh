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
# 4. Updates: apt is pointed at our signed repository, so a .deb installed by
#    hand (double-click, `apt install ./CumulusVPN.deb`) keeps updating like
#    one installed from the repository, the way Chrome and VS Code do it.
#    Skipped when an apt source already names pkg.cumulusvpn.com (the user
#    followed pkg.cumulusvpn.com's instructions), so it is never listed twice.
#    The key ships in this package; nothing is downloaded here. The file goes
#    with the package (deb-postrm.sh).
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

LIST=/etc/apt/sources.list.d/cumulusvpn.list
KEYRING=/usr/share/keyrings/cumulusvpn-archive-keyring.asc
if [ "$1" = configure ] && [ -d /etc/apt/sources.list.d ] && [ -f "$KEYRING" ]; then
  if ! grep -rqs 'pkg\.cumulusvpn\.com' /etc/apt/sources.list /etc/apt/sources.list.d; then
    printf '%s\n' \
      "# Added by the cumulus-vpn package so it receives updates; removed with it." \
      "deb [arch=amd64 signed-by=$KEYRING] https://pkg.cumulusvpn.com/deb stable main" \
      >"$LIST"
  fi
fi

exit 0
