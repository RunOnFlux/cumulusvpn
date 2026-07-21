#!/usr/bin/env ruby
# Consolidate the iOS tunnel extension onto a SINGLE Go runtime (wgnest), so both
# single- and multi-hop work. Previously the extension linked WireGuardKit
# (libwg-go, single-hop) AND Wgnest (gomobile, multi-hop) — two Go runtimes in
# one process crash (docs/13). Now wgnest handles both; WireGuardKit's Go engine
# is dropped, keeping only its C module (WireGuardKitC, the utun-fd types).
#
# Does the Xcode surgery (idempotent). Pair with add-wgnest-framework.rb (re-link
# Wgnest). Requires the `xcodeproj` gem.
require "xcodeproj"

PROJECT = File.expand_path(File.join(__dir__, "..", "CumulusVPN.xcodeproj"))
p = Xcodeproj::Project.open(PROJECT)
ext = p.targets.find { |t| t.name == "PacketTunnelExtension" } or abort "no PacketTunnelExtension"

# 1. Repoint the SPM product dependency WireGuardKit → WireGuardKitC (C only, no
#    Go). The vendored Package.swift now exposes WireGuardKitC as a product.
p.targets.each do |t|
  t.package_product_dependencies.each do |dep|
    dep.product_name = "WireGuardKitC" if dep.product_name == "WireGuardKit"
  end
end

# 2. Drop the "Build libwg-go.a" run script phase — no libwg-go anymore.
ext.shell_script_build_phases.select { |ph| ph.name == "Build libwg-go.a" }.each do |ph|
  ext.build_phases.delete(ph)
  ph.remove_from_project
end

# 3. Remove the WireGuardKit-dependent wg-quick parser files (replaced by the
#    local WgQuick parser in PacketTunnelProvider.swift).
DEAD = ["String+ArrayConversion.swift", "TunnelConfiguration+WgQuickConfig.swift"]
ext.source_build_phase.files.dup.each do |bf|
  ref = bf.file_ref
  next unless ref && DEAD.include?(ref.display_name)
  ext.source_build_phase.files.delete(bf)
  bf.remove_from_project
end
p.main_group.recursive_children.select { |c| c.isa == "PBXFileReference" && DEAD.include?(c.display_name) }.each(&:remove_from_project)

p.save
puts "consolidated: WireGuardKit→WireGuardKitC, dropped libwg-go phase + WgQuick parser files"
