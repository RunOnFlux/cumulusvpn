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
# 4. Updates: dnf / yum are pointed at our signed repository, so an .rpm
#    installed by hand keeps updating like one installed from it. Skipped when
#    a repo file already names pkg.cumulusvpn.com; the key ships in this
#    package. Removed on erase (rpm-postun.sh). dnf asks once to import the
#    key on the first update: rpm cannot import it from inside its own
#    transaction.
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
  # Revive a helper an earlier release left `failed` (start-limit-hit).
  systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
  systemctl restart "$UNIT" || echo "CumulusVPN: could not start $UNIT (see: journalctl -u $UNIT)"
fi

REPO=/etc/yum.repos.d/cumulusvpn.repo
if [ -d /etc/yum.repos.d ] && ! grep -rqs 'pkg\.cumulusvpn\.com' /etc/yum.repos.d; then
  printf '%s\n' \
    "# Added by the cumulus-vpn package so it receives updates; removed with it." \
    "[cumulusvpn]" \
    "name=CumulusVPN" \
    "baseurl=https://pkg.cumulusvpn.com/rpm" \
    "enabled=1" \
    "gpgcheck=1" \
    "repo_gpgcheck=1" \
    "gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-cumulusvpn" \
    >"$REPO"
fi

exit 0
