#!/usr/bin/env ruby
# Wire Wgnest.xcframework (the gomobile-built nested-tunnel core) into the app.
#
# App extensions are NOT allowed to embed their own frameworks — an .appex with a
# Frameworks/ dir is rejected by the App Store (ITMS-90205 "disallowed nested
# bundles" / ITMS-90206 "disallowed file 'Frameworks'"). So the standard layout
# is:
#   - the MAIN APP (CumulusVPN) embeds + signs Wgnest → it ships in
#     CumulusVPN.app/Frameworks, and
#   - the PacketTunnelExtension only LINKS it (it calls Wgmobile* at runtime) and
#     resolves it from the app bundle via @executable_path/../../Frameworks.
#
# Idempotent + corrective: re-running fixes a project that previously embedded
# Wgnest into the extension. Requires the `xcodeproj` gem.
#
#   ruby scripts/add-wgnest-framework.rb
require "xcodeproj"

PROJECT = File.expand_path(File.join(__dir__, "..", "CumulusVPN.xcodeproj"))
FW_REL  = "Frameworks/Wgnest.xcframework"

proj = Xcodeproj::Project.open(PROJECT)
app  = proj.targets.find { |t| t.name == "CumulusVPN" } or abort "no CumulusVPN target"
ext  = proj.targets.find { |t| t.name == "PacketTunnelExtension" } or abort "no PacketTunnelExtension target"

# File reference (under a Frameworks group, project-relative).
group = proj.main_group.find_subpath("Frameworks", true)
group.set_source_tree("SOURCE_ROOT")
ref = group.files.find { |f| f.path == FW_REL } ||
      group.new_reference(FW_REL).tap { |r| r.set_source_tree("SOURCE_ROOT") }
ref.set_last_known_file_type("wrapper.xcframework")

# --- Extension: LINK only (needs the symbols), never embed. ---
unless ext.frameworks_build_phase.files_references.include?(ref)
  ext.frameworks_build_phase.add_file_reference(ref)
end
# Strip any prior embed-in-extension (the ITMS-90205/90206 cause). Drop the whole
# "Embed Frameworks" copy phase if Wgnest was its only entry.
ext.copy_files_build_phases.dup.each do |p|
  next unless p.symbol_dst_subfolder_spec == :frameworks
  p.files.dup.each do |bf|
    next unless bf.file_ref == ref
    p.files.delete(bf)
    bf.remove_from_project
  end
  if p.files.empty?
    ext.build_phases.delete(p)
    p.remove_from_project
  end
end

# --- App: LINK + EMBED + SIGN (Xcode's "Embed & Sign"). The app must LINK the
#     xcframework, not merely list it in a copy phase — linking is what resolves
#     the correct device slice for the app target so the embed can copy it.
#     Embed-only left Wgnest unresolved for the app and broke the archive. ---
unless app.frameworks_build_phase.files_references.include?(ref)
  app.frameworks_build_phase.add_file_reference(ref)
end
embed = app.copy_files_build_phases.find do |p|
  p.symbol_dst_subfolder_spec == :frameworks && p.name == "Embed Frameworks"
end
unless embed
  embed = app.new_copy_files_build_phase("Embed Frameworks")
  embed.symbol_dst_subfolder_spec = :frameworks
end
unless embed.files_references.include?(ref)
  bf = embed.add_file_reference(ref)
  bf.settings = { "ATTRIBUTES" => %w[CodeSignOnCopy RemoveHeadersOnCopy] }
end

# --- Search path (both targets) + runtime rpath (extension). ---
[app, ext].each do |t|
  t.build_configurations.each do |cfg|
    paths = Array(cfg.build_settings["FRAMEWORK_SEARCH_PATHS"] || ["$(inherited)"])
    cfg.build_settings["FRAMEWORK_SEARCH_PATHS"] = (paths | ["$(PROJECT_DIR)/Frameworks"])
  end
end
# The extension loads Wgnest from the containing app's Frameworks dir at runtime:
# @executable_path (…/App.app/PlugIns/Ext.appex) + ../../Frameworks = App.app/Frameworks.
ext.build_configurations.each do |cfg|
  rpaths = Array(cfg.build_settings["LD_RUNPATH_SEARCH_PATHS"] || ["$(inherited)"])
  cfg.build_settings["LD_RUNPATH_SEARCH_PATHS"] = (rpaths | ["@executable_path/../../Frameworks"])
end

proj.save
puts "wired Wgnest.xcframework: app embeds+signs, extension links only (no nested Frameworks)"
