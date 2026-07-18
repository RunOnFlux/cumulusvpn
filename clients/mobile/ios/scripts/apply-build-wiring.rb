#!/usr/bin/env ruby
# Apply the documented iOS build-wiring so a plain `xcodebuild` / the signed build
# "just works" (docs/13). Idempotent. Requires the `xcodeproj` gem.
#
#   1. SWIFT_ENABLE_EXPLICIT_MODULES = NO on both targets (WireGuardKit compiles
#      under the iOS 26 SDK).
#   2. Repoint the WireGuardKit SPM ref from the remote git URL to the local
#      vendored, header-patched copy (vendor/wireguard-apple).
#   3. A pre-link Run Script phase on PacketTunnelExtension that builds
#      libwg-go.a from the vendored WireGuardKitGo Makefile (needs Go 1.22).
#   4. LIBRARY_SEARCH_PATHS so the linker finds the built archive.
require "xcodeproj"

PROJECT = File.expand_path(File.join(__dir__, "..", "CumulusVPN.xcodeproj"))
p = Xcodeproj::Project.open(PROJECT)

# 1. SWIFT_ENABLE_EXPLICIT_MODULES = NO on every config of every target.
p.targets.each do |t|
  t.build_configurations.each { |c| c.build_settings["SWIFT_ENABLE_EXPLICIT_MODULES"] = "NO" }
end

# 2. Repoint the WireGuardKit package from remote git → local vendored path.
remote = p.root_object.package_references.find { |r| r.isa == "XCRemoteSwiftPackageReference" }
if remote
  local = p.root_object.package_references.find do |r|
    r.isa == "XCLocalSwiftPackageReference" && r.relative_path == "vendor/wireguard-apple"
  end
  unless local
    local = p.new(Xcodeproj::Project::Object::XCLocalSwiftPackageReference)
    local.relative_path = "vendor/wireguard-apple"
    p.root_object.package_references << local
  end
  # Point every WireGuardKit product dependency at the local package.
  p.targets.each do |t|
    t.package_product_dependencies.each do |dep|
      dep.package = local if dep.product_name == "WireGuardKit"
    end
  end
  p.root_object.package_references.delete(remote)
  remote.remove_from_project
end

ext = p.targets.find { |t| t.name == "PacketTunnelExtension" } or abort "no PacketTunnelExtension"

# 3. Run Script build phase that builds libwg-go.a before linking.
unless ext.shell_script_build_phases.any? { |ph| ph.name == "Build libwg-go.a" }
  phase = ext.new_shell_script_build_phase("Build libwg-go.a")
  phase.shell_script = <<~SH
    # Build the wireguard-go c-archive (libwg-go.a) that WireGuardKit links.
    # Needs Go 1.22 on PATH (Go 1.26 breaks the pinned build — see docs/13);
    # Xcode Cloud's ci_post_clone.sh provisions it. Xcode passes ARCHS / SDKROOT /
    # PLATFORM_NAME / CONFIGURATION_BUILD_DIR into the Makefile's env.
    set -e
    WG_GO_DIR="$SRCROOT/vendor/wireguard-apple/Sources/WireGuardKitGo"
    if [ -d "$WG_GO_DIR" ]; then
      make -C "$WG_GO_DIR" build
    else
      echo "warning: $WG_GO_DIR missing — skipping libwg-go.a build"
    fi
  SH
  # Run before the Frameworks (link) phase.
  ext.build_phases.unshift(ext.build_phases.delete(phase))
end

# 4. LIBRARY_SEARCH_PATHS on the extension so -lwg-go resolves.
ext.build_configurations.each do |c|
  paths = Array(c.build_settings["LIBRARY_SEARCH_PATHS"] || ["$(inherited)"])
  c.build_settings["LIBRARY_SEARCH_PATHS"] = (paths | ["$(CONFIGURATION_BUILD_DIR)"])
end

p.save
puts "applied: explicit-modules=NO, SPM→vendored, libwg-go.a build phase, LIBRARY_SEARCH_PATHS"
