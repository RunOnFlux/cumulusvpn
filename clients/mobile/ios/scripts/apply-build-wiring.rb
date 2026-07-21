#!/usr/bin/env ruby
# Apply the documented iOS build-wiring so a plain `xcodebuild` / the signed build
# "just works" (docs/13). Idempotent. Requires the `xcodeproj` gem.
#
#   1. SWIFT_ENABLE_EXPLICIT_MODULES = NO on both targets (WireGuardKitC compiles
#      under the iOS 26 SDK).
#   2. Repoint the WireGuardKit SPM ref from the remote git URL to the local
#      vendored, header-patched copy (vendor/wireguard-apple).
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

# NOTE: steps 3–4 (the "Build libwg-go.a" run-script phase + LIBRARY_SEARCH_PATHS)
# are GONE. The tunnel extension no longer links WireGuardKit's libwg-go — both
# single- and multi-hop run on the one wgnest Go core, so there is no second Go
# runtime to crash the extension. The WireGuardKit→WireGuardKitC swap + Wgnest
# wiring is applied by scripts/consolidate-ios-runtime.rb + add-wgnest-framework.rb.

p.save
puts "applied: explicit-modules=NO, SPM→vendored local package"
