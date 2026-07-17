// Prevents an extra console window on Windows in release. Keep at crate root.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cumulusvpn_desktop_lib::run();
}
