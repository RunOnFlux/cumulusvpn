# %preun (.rpm): $1 is 0 on erase, 1 on upgrade. On erase, stop and disable the
# CumulusVPN helper (stopping disconnects first: DNS, devices, kill switch),
# then --cleanup anything a crashed session left behind. On upgrade, nothing:
# the new package's %post has already restarted it.
UNIT=cumulusvpn-helper.service

if [ "$1" = 0 ]; then
  if [ -d /run/systemd/system ]; then
    systemctl stop "$UNIT" >/dev/null 2>&1 || true
    systemctl disable "$UNIT" >/dev/null 2>&1 || true
  fi
  if [ -x /usr/bin/cumulusvpn-helper ]; then
    /usr/bin/cumulusvpn-helper --cleanup >/dev/null 2>&1 || true
  fi
fi

exit 0
