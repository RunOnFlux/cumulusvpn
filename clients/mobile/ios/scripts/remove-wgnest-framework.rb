#!/usr/bin/env ruby
# Reverse of add-wgnest-framework.rb: fully un-wire Wgnest.xcframework from the
# project (unlink from the app + extension, un-embed from the app, drop the file
# reference).
#
# WHY: the iOS Packet Tunnel extension links TWO independent Go runtimes —
# libwg-go (WireGuardKit, single-hop) and Wgnest (gomobile, multi-hop). Both load
# into the single extension process, and two Go runtimes in one process crash
# (they fight over signal handlers / scheduling) — the extension SIGSEGVs the
# instant a tunnel starts. Dropping Wgnest leaves exactly one Go runtime so
# single-hop works. With Wgnest gone, `#if canImport(Wgnest)` is false, so
# PacketTunnelProvider.startMultihop returns .notImplemented (multi-hop is
# temporarily unavailable on iOS until it's reworked onto the single runtime).
#
# Idempotent. Requires the `xcodeproj` gem.  ruby scripts/remove-wgnest-framework.rb
require "xcodeproj"

PROJECT = File.expand_path(File.join(__dir__, "..", "CumulusVPN.xcodeproj"))
FW_REL  = "Frameworks/Wgnest.xcframework"

proj = Xcodeproj::Project.open(PROJECT)

def strip_ref_from_phase(phase, ref)
  phase.files.dup.each do |bf|
    next unless bf.file_ref == ref
    phase.files.delete(bf)
    bf.remove_from_project
  end
end

proj.targets.each do |t|
  ref = t.frameworks_build_phase.files_references.find { |r| r&.path == FW_REL }
  # Unlink from the target.
  strip_ref_from_phase(t.frameworks_build_phase, ref) if ref
  # Un-embed (and drop the copy phase if Wgnest was its only entry).
  t.copy_files_build_phases.dup.each do |p|
    next unless p.symbol_dst_subfolder_spec == :frameworks
    embedded = p.files_references.find { |r| r&.path == FW_REL }
    strip_ref_from_phase(p, embedded) if embedded
    if p.files.empty?
      t.build_phases.delete(p)
      p.remove_from_project
    end
  end
end

# Drop the file reference itself.
group = proj.main_group.find_subpath("Frameworks", false)
if group
  group.files.select { |f| f&.path == FW_REL }.each(&:remove_from_project)
end

proj.save
puts "un-wired Wgnest.xcframework (single Go runtime; multi-hop disabled on iOS)"
