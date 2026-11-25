# %postun (.rpm): $1 is 0 on erase, 1 on upgrade. Forget a removed unit. On
# upgrade there is nothing to restart: the NEW package's %post runs before this
# (old) %postun and has already restarted the helper onto the new binary. A
# second restart here only spent the unit's start budget. The `cumulusvpn`
# group is left in place, as system groups conventionally are.
UNIT=cumulusvpn-helper.service

if [ -d /run/systemd/system ]; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  if [ "$1" = 0 ]; then
    systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
  fi
fi

# Erase (not upgrade): drop the repo file %post added; only ours, by its marker.
REPO=/etc/yum.repos.d/cumulusvpn.repo
if [ "$1" = 0 ] && [ -f "$REPO" ] && grep -q '^# Added by the cumulus-vpn package' "$REPO"; then
  rm -f "$REPO"
fi

exit 0
