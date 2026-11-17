#!/bin/sh
# postrm (.deb): forget the removed unit, and drop the apt source the
# postinst added (only that file, recognised by its marker line; a source the
# user added themselves is theirs). It goes on `remove` too, not only `purge`:
# the keyring it points at belongs to the package and is already gone, so a
# leftover entry would fail every `apt update`. The `cumulusvpn` group is left
# in place, as system groups conventionally are: removing it could orphan
# files and would drop users' membership across a reinstall.
set -e

case "$1" in
  remove | purge)
    if [ -d /run/systemd/system ]; then
      systemctl daemon-reload >/dev/null 2>&1 || true
      systemctl reset-failed cumulusvpn-helper.service >/dev/null 2>&1 || true
    fi
    LIST=/etc/apt/sources.list.d/cumulusvpn.list
    if [ -f "$LIST" ] && grep -q '^# Added by the cumulus-vpn package' "$LIST"; then
      rm -f "$LIST"
    fi
    ;;
esac

exit 0
