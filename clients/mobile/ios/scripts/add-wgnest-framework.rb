#!/usr/bin/env ruby
# Wire Wgnest.xcframework (the gomobile-built nested-tunnel core) into the
# PacketTunnelExtension target: link it, embed+sign it, and add the framework
# search path. Idempotent — safe to re-run. Requires the `xcodeproj` gem.
#
#   ruby scripts/add-wgnest-framework.rb
require "xcodeproj"

PROJECT = File.expand_path(File.join(__dir__, "..", "CumulusVPN.xcodeproj"))
FW_REL  = "Frameworks/Wgnest.xcframework"

proj = Xcodeproj::Project.open(PROJECT)
ext  = proj.targets.find { |t| t.name == "PacketTunnelExtension" } or abort "no PacketTunnelExtension target"

# File reference (under a Frameworks group, project-relative).
group = proj.main_group.find_subpath("Frameworks", true)
group.set_source_tree("SOURCE_ROOT")
ref = group.files.find { |f| f.path == FW_REL } ||
      group.new_reference(FW_REL).tap { |r| r.set_source_tree("SOURCE_ROOT") }
ref.set_last_known_file_type("wrapper.xcframework")

# Link.
unless ext.frameworks_build_phase.files_references.include?(ref)
  ext.frameworks_build_phase.add_file_reference(ref)
end

# Embed + sign (dynamic gomobile framework must ship in the bundle).
embed = ext.copy_files_build_phases.find { |p| p.name == "Embed Frameworks" }
unless embed
  embed = ext.new_copy_files_build_phase("Embed Frameworks")
  embed.symbol_dst_subfolder_spec = :frameworks
end
unless embed.files_references.include?(ref)
  bf = embed.add_file_reference(ref)
  bf.settings = { "ATTRIBUTES" => %w[CodeSignOnCopy RemoveHeadersOnCopy] }
end

# Search path so the linker finds it.
ext.build_configurations.each do |cfg|
  paths = Array(cfg.build_settings["FRAMEWORK_SEARCH_PATHS"] || ["$(inherited)"])
  entry = "$(PROJECT_DIR)/Frameworks"
  cfg.build_settings["FRAMEWORK_SEARCH_PATHS"] = (paths | [entry])
end

proj.save
puts "wired Wgnest.xcframework into PacketTunnelExtension (link + embed + search path)"
