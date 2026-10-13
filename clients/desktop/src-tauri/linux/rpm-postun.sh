# %postun (.rpm): $1 is 0 on erase, 1 on upgrade. Forget a removed unit; on
# upgrade, make sure the running helper is the new binary. The `cumulusvpn`
# group is left in place, as system groups conventionally are.
UNIT=cumulusvpn-helper.service

if [ -d /run/systemd/system ]; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  if [ "$1" -ge 1 ] 2>/dev/null; then
    systemctl try-restart "$UNIT" >/dev/null 2>&1 || true
  else
    systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
  fi
fi

exit 0
