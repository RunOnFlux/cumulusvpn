#!/bin/sh
# postrm (.deb): forget the removed unit. The `cumulusvpn` group is left in
# place, as system groups conventionally are: removing it could orphan files
# and would drop users' membership across a reinstall.
set -e

case "$1" in
  remove | purge)
    if [ -d /run/systemd/system ]; then
      systemctl daemon-reload >/dev/null 2>&1 || true
      systemctl reset-failed cumulusvpn-helper.service >/dev/null 2>&1 || true
    fi
    ;;
esac

exit 0
