# %post (.rpm): set up the CumulusVPN privileged helper. $1 is 1 on install,
# 2 on upgrade. Same steps as the .deb postinst (deb-postinst.sh):
#
# 1. The `cumulusvpn` group: its members may use the helper (the socket is
#    root:cumulusvpn mode 0660). Created once, never removed by us.
# 2. The installing user joins it when we can tell who that is (sudo sets
#    SUDO_USER, pkexec sets PKEXEC_UID; a graphical installer sets neither, and
#    the app then explains how to join). It applies to sessions started after
#    it, so the user logs out and back in once.
# 3. The unit is enabled and (re)started, picking up an upgraded binary.
GROUP=cumulusvpn
UNIT=cumulusvpn-helper.service

if ! getent group "$GROUP" >/dev/null 2>&1; then
  groupadd --system "$GROUP" 2>/dev/null || true
fi

INSTALL_USER="${SUDO_USER:-}"
if [ -z "$INSTALL_USER" ] && [ -n "${PKEXEC_UID:-}" ]; then
  INSTALL_USER="$(getent passwd "$PKEXEC_UID" | cut -d: -f1)"
fi
if [ -n "$INSTALL_USER" ] && [ "$INSTALL_USER" != root ] && id "$INSTALL_USER" >/dev/null 2>&1; then
  if ! id -nG "$INSTALL_USER" | tr ' ' '\n' | grep -qx "$GROUP"; then
    usermod -aG "$GROUP" "$INSTALL_USER" 2>/dev/null || gpasswd -a "$INSTALL_USER" "$GROUP" >/dev/null 2>&1 || true
    echo "CumulusVPN: added $INSTALL_USER to the $GROUP group. Log out and back in once so the app can reach its helper."
  fi
fi

if [ -d /run/systemd/system ]; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable "$UNIT" >/dev/null 2>&1 || true
  systemctl restart "$UNIT" || echo "CumulusVPN: could not start $UNIT (see: journalctl -u $UNIT)"
fi

exit 0
