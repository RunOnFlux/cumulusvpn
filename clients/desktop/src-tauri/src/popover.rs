//! The menu-bar popover: a small window that drops down from the tray icon on a
//! left click, so connecting doesn't mean opening the main window.
//!
//! It is a VIEW, not a second app. The main window's frontend owns the
//! connection (discovery, the transport sweep, auto-reconnect); two copies of
//! that would fight. So the popover renders the same [`TrayState`] the tray
//! menu shows — pushed to it as the `tray-state` event, and readable on open
//! through [`popover_state`] — and sends clicks back as the same `tray-action`
//! events the menu does (`src/components/Popover.tsx`).

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Rect, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

use crate::tray::{TrayState, TrayUi};

pub const LABEL: &str = "popover";
const WIDTH: f64 = 300.0;
const HEIGHT: f64 = 340.0;
/// Gap between the icon and the popover, in logical px.
const GAP: f64 = 6.0;

/// Create the (hidden) popover window once, at startup.
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("CumulusVPN")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    // Like any menu-bar popover: clicking elsewhere dismisses it.
    let w = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            let _ = w.hide();
        }
    });
    Ok(())
}

/// Where the popover goes for an icon at `icon` (physical px): centred under
/// it — or above it when the icon is in the lower half of the screen (a
/// Windows taskbar) — and kept on the monitor.
fn place(
    icon: (f64, f64, f64, f64),
    pop: (f64, f64),
    monitor: (f64, f64, f64, f64),
    gap: f64,
) -> (f64, f64) {
    let (ix, iy, iw, ih) = icon;
    let (pw, ph) = pop;
    let (mx, my, mw, mh) = monitor;
    let below = iy + ih / 2.0 < my + mh / 2.0;
    let y = if below { iy + ih + gap } else { iy - ph - gap };
    let x = (ix + iw / 2.0 - pw / 2.0).clamp(mx, (mx + mw - pw).max(mx));
    (x, y.clamp(my, (my + mh - ph).max(my)))
}

fn show_at(window: &WebviewWindow, rect: &Rect) -> tauri::Result<()> {
    let scale = window.scale_factor()?;
    let pos = rect.position.to_physical::<f64>(scale);
    let size = rect.size.to_physical::<f64>(scale);
    let pop = window.outer_size()?;
    let monitor = window
        .monitor_from_point(pos.x, pos.y)?
        .or(window.current_monitor()?);
    let bounds = match &monitor {
        Some(m) => (
            f64::from(m.position().x),
            f64::from(m.position().y),
            f64::from(m.size().width),
            f64::from(m.size().height),
        ),
        None => (0.0, 0.0, f64::MAX / 4.0, f64::MAX / 4.0),
    };
    let (x, y) = place(
        (pos.x, pos.y, size.width, size.height),
        (f64::from(pop.width), f64::from(pop.height)),
        bounds,
        GAP * scale,
    );
    window.set_position(PhysicalPosition::new(x, y))?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

/// Left click on the tray icon: open the popover under it, or close it.
pub fn toggle(app: &AppHandle, rect: &Rect) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = show_at(&window, rect);
    }
}

/// Forward the latest tray state to the popover (no-op while it doesn't exist).
pub fn push(app: &AppHandle, state: &TrayState) {
    let _ = app.emit_to(LABEL, "tray-state", state);
}

/// The state to render when the popover opens.
#[tauri::command]
pub fn popover_state(ui: State<'_, TrayUi>) -> Option<TrayState> {
    ui.last()
}

/// "Open CumulusVPN" in the popover.
#[tauri::command]
pub fn popover_open_main(app: AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
    }
    crate::show_main_window(&app);
}

/// "Quit" in the popover — the same path as the tray menu's Quit, which
/// raises `RunEvent::Exit` and tears the tunnel down.
#[tauri::command]
pub fn popover_quit(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::place;

    const SCREEN: (f64, f64, f64, f64) = (0.0, 0.0, 2000.0, 1200.0);

    #[test]
    fn drops_down_centred_under_a_menu_bar_icon() {
        let (x, y) = place((1000.0, 0.0, 40.0, 30.0), (300.0, 340.0), SCREEN, 6.0);
        assert_eq!((x, y), (870.0, 36.0));
    }

    #[test]
    fn opens_upwards_from_a_bottom_taskbar() {
        let (_, y) = place((1000.0, 1160.0, 40.0, 40.0), (300.0, 340.0), SCREEN, 6.0);
        assert_eq!(y, 1160.0 - 340.0 - 6.0);
    }

    #[test]
    fn stays_on_screen_next_to_the_edge() {
        let (x, _) = place((1990.0, 0.0, 10.0, 30.0), (300.0, 340.0), SCREEN, 6.0);
        assert_eq!(x, 1700.0);
    }
}
