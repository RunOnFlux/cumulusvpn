//! The menu-bar / system-tray icon and its menu.
//!
//! The frontend owns the connection (country list, sweep, reconnect logic), so
//! it pushes what the menu should show through [`set_tray`] and the menu sends
//! clicks back as a `tray-action` event. Rust never connects or disconnects on
//! its own from here: a tunnel dropped behind the frontend's back would read as
//! an unexpected drop and be auto-reconnected.
//!
//! macOS gets a *template* glyph (black + alpha, tinted by the system like every
//! other menu-bar icon) that switches between an outlined cloud (off) and a
//! solid one (on). Windows and Linux keep the colour app icon, which is what
//! their trays expect.
//!
//! Live text (status, speed) is updated in place with `set_text`, so the menu
//! can stay open while it ticks; the menu is rebuilt only when its *shape*
//! changes (connected vs not, or the country list).

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::image::Image;
use tauri::menu::{
    CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItem, MenuItemBuilder,
    SubmenuBuilder,
};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, Wry};

const TRAY_ID: &str = "main";
const COUNTRY_PREFIX: &str = "country:";

/// One selectable location in the "Connect to" submenu.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct TrayCountry {
    pub code: String,
    /// Display label, e.g. "🇩🇪 Germany".
    pub label: String,
    pub favorite: bool,
}

/// What the menu shows, pushed by the frontend whenever it changes.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayState {
    /// `idle` | `connecting` | `connected` | `error` | `loading`.
    pub phase: String,
    /// First line, e.g. "Connected — 🇩🇪 Germany".
    pub headline: String,
    /// Second line (location · IP), when there is one.
    pub detail: Option<String>,
    /// Third line (speed · session time), when connected.
    pub stats: Option<String>,
    /// The currently selected country code.
    pub selected: Option<String>,
    pub kill_switch: bool,
    pub countries: Vec<TrayCountry>,
}

/// A click in the menu, delivered to the frontend as the `tray-action` event.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TrayAction {
    Connect,
    Disconnect,
    ConnectTo { code: String },
    ToggleKillSwitch,
}

/// Handles to the items whose text changes without a rebuild.
struct Live {
    headline: MenuItem<Wry>,
    detail: Option<MenuItem<Wry>>,
    stats: Option<MenuItem<Wry>>,
    kill_switch: CheckMenuItem<Wry>,
}

#[derive(Default)]
pub struct TrayUi {
    inner: Mutex<TrayInner>,
}

#[derive(Default)]
struct TrayInner {
    /// The state the current menu was built for (shape + text).
    last: Option<TrayState>,
    live: Option<Live>,
}

/// Whether two states need different menu *structure* (vs. only new text).
fn same_shape(a: &TrayState, b: &TrayState) -> bool {
    a.phase == b.phase
        && a.detail.is_some() == b.detail.is_some()
        && a.stats.is_some() == b.stats.is_some()
        && a.selected == b.selected
        && a.countries == b.countries
}

fn glyph(connected: bool) -> Option<Image<'static>> {
    let bytes: &[u8] = if connected {
        include_bytes!("../icons/tray/connected.png")
    } else {
        include_bytes!("../icons/tray/disconnected.png")
    };
    Image::from_bytes(bytes).ok()
}

fn build_menu(app: &AppHandle, s: &TrayState) -> tauri::Result<(Menu<Wry>, Live)> {
    let connected = s.phase == "connected";
    let busy = s.phase == "connecting";

    let headline = MenuItemBuilder::with_id("status", &s.headline)
        .enabled(false)
        .build(app)?;
    let mut menu = MenuBuilder::new(app).item(&headline);

    let detail = match &s.detail {
        Some(text) => {
            let item = MenuItemBuilder::with_id("detail", text)
                .enabled(false)
                .build(app)?;
            menu = menu.item(&item);
            Some(item)
        }
        None => None,
    };
    let stats = match &s.stats {
        Some(text) => {
            let item = MenuItemBuilder::with_id("stats", text)
                .enabled(false)
                .build(app)?;
            menu = menu.item(&item);
            Some(item)
        }
        None => None,
    };
    menu = menu.separator();

    let toggle = if connected || busy {
        MenuItemBuilder::with_id("disconnect", if busy { "Cancel" } else { "Disconnect" })
            .accelerator("CmdOrCtrl+D")
            .build(app)?
    } else {
        MenuItemBuilder::with_id("connect", "Connect")
            .enabled(s.selected.is_some() && s.phase != "loading")
            .build(app)?
    };
    menu = menu.item(&toggle);

    if !s.countries.is_empty() {
        let mut sub = SubmenuBuilder::new(app, "Connect to");
        let (favs, rest): (Vec<_>, Vec<_>) = s.countries.iter().partition(|c| c.favorite);
        for (i, group) in [favs, rest].into_iter().enumerate() {
            if group.is_empty() {
                continue;
            }
            if i == 1 && sub_has_items(&s.countries) {
                sub = sub.separator();
            }
            for c in group {
                let mark = if s.selected.as_deref() == Some(c.code.as_str()) {
                    "✓ "
                } else {
                    ""
                };
                let item = MenuItemBuilder::with_id(
                    format!("{COUNTRY_PREFIX}{}", c.code),
                    format!("{mark}{}", c.label),
                )
                .build(app)?;
                sub = sub.item(&item);
            }
        }
        menu = menu.item(&sub.build()?);
    }

    let kill_switch = CheckMenuItemBuilder::with_id("kill-switch", "Kill switch")
        .checked(s.kill_switch)
        .build(app)?;
    let show = MenuItemBuilder::with_id("show", "Open CumulusVPN…").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit CumulusVPN")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let menu = menu
        .separator()
        .item(&kill_switch)
        .separator()
        .item(&show)
        .item(&quit)
        .build()?;

    Ok((
        menu,
        Live {
            headline,
            detail,
            stats,
            kill_switch,
        },
    ))
}

/// A separator between favourites and the rest only when both groups exist.
fn sub_has_items(countries: &[TrayCountry]) -> bool {
    countries.iter().any(|c| c.favorite) && countries.iter().any(|c| !c.favorite)
}

fn apply(app: &AppHandle, ui: &TrayUi, s: TrayState) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let mut inner = ui.inner.lock().unwrap_or_else(|e| e.into_inner());
    if inner.last.as_ref() == Some(&s) {
        return Ok(());
    }

    let rebuild = match (&inner.last, &inner.live) {
        (Some(last), Some(_)) => !same_shape(last, &s),
        _ => true,
    };
    if rebuild {
        let (menu, live) = build_menu(app, &s)?;
        tray.set_menu(Some(menu))?;
        inner.live = Some(live);
    } else if let Some(live) = &inner.live {
        live.headline.set_text(&s.headline)?;
        if let (Some(item), Some(text)) = (&live.detail, &s.detail) {
            item.set_text(text)?;
        }
        if let (Some(item), Some(text)) = (&live.stats, &s.stats) {
            item.set_text(text)?;
        }
        live.kill_switch.set_checked(s.kill_switch)?;
    }

    let connected = s.phase == "connected";
    let was_connected = inner.last.as_ref().map(|l| l.phase == "connected");
    if cfg!(target_os = "macos") && was_connected != Some(connected) {
        tray.set_icon(glyph(connected))?;
        tray.set_icon_as_template(true)?;
    }
    tray.set_tooltip(Some(format!("CumulusVPN — {}", s.headline)))?;
    inner.last = Some(s);
    Ok(())
}

/// Push the menu's content. Cheap to call often: unchanged state is a no-op,
/// and text-only changes do not rebuild the menu.
#[tauri::command]
pub fn set_tray(app: AppHandle, ui: State<'_, TrayUi>, state: TrayState) -> Result<(), String> {
    apply(&app, &ui, state).map_err(|e| e.to_string())
}

fn emit(app: &AppHandle, action: TrayAction) {
    let _ = app.emit("tray-action", action);
}

/// Create the tray icon with a placeholder menu until the frontend's first
/// `set_tray`; template glyph on macOS.
pub fn install(app: &tauri::App, show_main_window: fn(&AppHandle)) -> tauri::Result<()> {
    let handle = app.handle();
    let initial = TrayState {
        phase: "loading".into(),
        headline: "Starting…".into(),
        detail: None,
        stats: None,
        selected: None,
        kill_switch: false,
        countries: Vec::new(),
    };
    let (menu, live) = build_menu(handle, &initial)?;

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("CumulusVPN")
        .menu(&menu)
        // Left click belongs to the window, not the menu — the menu is the
        // right-click affordance.
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            match id {
                "show" => show_main_window(app),
                "connect" => emit(app, TrayAction::Connect),
                "disconnect" => emit(app, TrayAction::Disconnect),
                "kill-switch" => emit(app, TrayAction::ToggleKillSwitch),
                // `exit` raises RunEvent::Exit, which tears the tunnel down.
                "quit" => app.exit(0),
                _ => {
                    if let Some(code) = id.strip_prefix(COUNTRY_PREFIX) {
                        emit(
                            app,
                            TrayAction::ConnectTo {
                                code: code.to_string(),
                            },
                        );
                    }
                }
            }
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if cfg!(target_os = "macos") {
        if let Some(icon) = glyph(false) {
            tray = tray.icon(icon).icon_as_template(true);
        }
    } else if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    tray.build(app)?;

    let ui = app.state::<TrayUi>();
    let mut inner = ui.inner.lock().unwrap_or_else(|e| e.into_inner());
    inner.last = Some(initial);
    inner.live = Some(live);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(phase: &str) -> TrayState {
        TrayState {
            phase: phase.into(),
            headline: "Not connected".into(),
            detail: None,
            stats: None,
            selected: Some("DE".into()),
            kill_switch: true,
            countries: vec![TrayCountry {
                code: "DE".into(),
                label: "🇩🇪 Germany".into(),
                favorite: false,
            }],
        }
    }

    #[test]
    fn text_only_changes_keep_the_menu() {
        let mut a = state("connected");
        a.stats = Some("↓ 1 Mbit/s".into());
        let mut b = a.clone();
        b.headline = "Connected — 🇩🇪 Germany".into();
        b.stats = Some("↓ 9 Mbit/s".into());
        b.kill_switch = false;
        assert!(same_shape(&a, &b));
    }

    #[test]
    fn phase_selection_or_countries_rebuild() {
        let a = state("idle");
        assert!(!same_shape(&a, &state("connected")));
        let mut b = a.clone();
        b.selected = Some("FR".into());
        assert!(!same_shape(&a, &b));
        let mut c = a.clone();
        c.countries[0].favorite = true;
        assert!(!same_shape(&a, &c));
        let mut d = a.clone();
        d.stats = Some("x".into());
        assert!(!same_shape(&a, &d));
    }

    #[test]
    fn actions_serialise_as_the_frontend_expects() {
        let json = |a: TrayAction| serde_json::to_string(&a).expect("json");
        assert_eq!(json(TrayAction::Connect), r#"{"kind":"connect"}"#);
        assert_eq!(json(TrayAction::Disconnect), r#"{"kind":"disconnect"}"#);
        assert_eq!(
            json(TrayAction::ConnectTo { code: "DE".into() }),
            r#"{"kind":"connectTo","code":"DE"}"#
        );
        assert_eq!(
            json(TrayAction::ToggleKillSwitch),
            r#"{"kind":"toggleKillSwitch"}"#
        );
    }

    #[test]
    fn both_glyphs_decode() {
        assert!(glyph(true).is_some());
        assert!(glyph(false).is_some());
    }
}
