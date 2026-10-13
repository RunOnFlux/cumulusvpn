#!/bin/sh
# prerm (.deb): stop the CumulusVPN helper before its files go away.
#
# Stopping it disconnects first (the daemon handles SIGTERM: DNS, devices, kill
# switch). On removal it is also disabled, and --cleanup undoes anything a
# crashed session left behind, so the machine is never left offline behind a
# kill switch nobody can lift. On upgrade the new postinst restarts it.
set -e

UNIT=cumulusvpn-helper.service

case "$1" in
  remove | deconfigure)
    if [ -d /run/systemd/system ]; then
      systemctl stop "$UNIT" >/dev/null 2>&1 || true
      systemctl disable "$UNIT" >/dev/null 2>&1 || true
    fi
    if [ -x /usr/bin/cumulusvpn-helper ]; then
      /usr/bin/cumulusvpn-helper --cleanup >/dev/null 2>&1 || true
    fi
    ;;
  upgrade | failed-upgrade) ;;
esac

exit 0
