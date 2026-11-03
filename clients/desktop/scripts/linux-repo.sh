#!/usr/bin/env bash
# Add new .deb/.rpm packages to the CumulusVPN Linux repositories and re-sign
# the metadata. Run by .github/workflows/desktop-linux-repo.yml on an Ubuntu
# runner; needs apt-utils (apt-ftparchive), rpm (rpmsign) and createrepo-c.
#
# Usage: linux-repo.sh <repo-dir> <incoming-dir> <gpg-key-fingerprint>
#
# Layout of <repo-dir> (served as https://pkg.cumulusvpn.com/):
#   cumulusvpn.asc                    public signing key
#   deb/pool/main/*.deb               every published .deb
#   deb/dists/stable/{Release,Release.gpg,InRelease}
#   deb/dists/stable/main/binary-amd64/Packages{,.gz}
#   rpm/*.rpm                         every published .rpm, each rpmsign'ed
#   rpm/repodata/ (+ repomd.xml.asc)  createrepo_c metadata, detached-signed
#   rpm/cumulusvpn.repo               the dnf repo file users install
#
# apt verifies the signed Release/InRelease (which pins every Packages hash,
# which pins every .deb hash); dnf verifies both the per-package signature
# (gpgcheck) and the signed repomd.xml (repo_gpgcheck). Re-running with the
# same packages is a no-op apart from fresh signatures.
set -euo pipefail

REPO="$(realpath "$1")"
INCOMING="$(realpath "$2")"
KEY="$3"
BASE_URL="${CVPN_PKG_BASE_URL:-https://pkg.cumulusvpn.com}"

mkdir -p "$REPO/deb/pool/main" "$REPO/deb/dists/stable/main/binary-amd64" "$REPO/rpm"
gpg --batch --yes --armor --export "$KEY" >"$REPO/cumulusvpn.asc"

shopt -s nullglob
debs=("$INCOMING"/*.deb)
rpms=("$INCOMING"/*.rpm)
if [ ${#debs[@]} -eq 0 ] && [ ${#rpms[@]} -eq 0 ]; then
  echo "no packages in $INCOMING" >&2
  exit 1
fi

# --- apt ---------------------------------------------------------------------
for f in "${debs[@]}"; do cp -f "$f" "$REPO/deb/pool/main/"; done
(
  cd "$REPO/deb"
  apt-ftparchive packages pool/main >dists/stable/main/binary-amd64/Packages
  gzip -9nkf dists/stable/main/binary-amd64/Packages
  apt-ftparchive \
    -o APT::FTPArchive::Release::Origin=CumulusVPN \
    -o APT::FTPArchive::Release::Label=CumulusVPN \
    -o APT::FTPArchive::Release::Suite=stable \
    -o APT::FTPArchive::Release::Codename=stable \
    -o APT::FTPArchive::Release::Architectures=amd64 \
    -o APT::FTPArchive::Release::Components=main \
    -o "APT::FTPArchive::Release::Description=CumulusVPN desktop" \
    release dists/stable >dists/stable/Release.tmp
  mv dists/stable/Release.tmp dists/stable/Release
  gpg --batch --yes --local-user "$KEY" --armor --detach-sign \
    -o dists/stable/Release.gpg dists/stable/Release
  gpg --batch --yes --local-user "$KEY" --clearsign \
    -o dists/stable/InRelease dists/stable/Release
)

# --- dnf / zypper ------------------------------------------------------------
for f in "${rpms[@]}"; do
  cp -f "$f" "$REPO/rpm/"
  # rpm's %__gpg default (/usr/bin/gpg2) does not exist on Ubuntu.
  rpmsign --define "__gpg $(command -v gpg)" \
    --define "_gpg_name $KEY" --define "_gpg_digest_algo sha256" \
    --addsign "$REPO/rpm/$(basename "$f")"
done
createrepo_c --update --general-compress-type=gz "$REPO/rpm"
gpg --batch --yes --local-user "$KEY" --armor --detach-sign \
  -o "$REPO/rpm/repodata/repomd.xml.asc" "$REPO/rpm/repodata/repomd.xml"
cat >"$REPO/rpm/cumulusvpn.repo" <<EOF
[cumulusvpn]
name=CumulusVPN
baseurl=$BASE_URL/rpm
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=$BASE_URL/cumulusvpn.asc
EOF

# --- self-check: what users' package managers will verify --------------------
gpg --batch --verify "$REPO/deb/dists/stable/InRelease"
gpg --batch --verify "$REPO/deb/dists/stable/Release.gpg" "$REPO/deb/dists/stable/Release"
gpg --batch --verify "$REPO/rpm/repodata/repomd.xml.asc" "$REPO/rpm/repodata/repomd.xml"
tmpdb="$(mktemp -d)"
rpm --dbpath "$tmpdb" --import "$REPO/cumulusvpn.asc"
# An unsigned rpm still passes -K ("digests OK"), so require the signature.
for f in "$REPO"/rpm/*.rpm; do
  out="$(rpm --dbpath "$tmpdb" -K "$f")"
  echo "$out"
  echo "$out" | grep -q 'signatures OK'
done
rm -rf "$tmpdb"
echo "repository updated: $(ls "$REPO/deb/pool/main" | wc -l) deb, $(ls "$REPO"/rpm/*.rpm | wc -l) rpm"
