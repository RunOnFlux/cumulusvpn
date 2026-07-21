"""Config loading for the store screenshot compositor."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
VALID_LAYOUTS = {"hero", "brand"}
VALID_STORES = {"apple", "google", "both"}


@dataclass
class ScreenDef:
    key: str
    raw_filename: str
    layout: str
    order: int
    breakout_prompt: Optional[str] = None


@dataclass
class DeviceSpec:
    name: str
    width: int
    height: int
    master: bool = False


@dataclass
class ScreenCopy:
    label: str
    headline: str


@dataclass
class LocaleConfig:
    locale: str
    curated: bool
    screens: dict[str, ScreenCopy] = field(default_factory=dict)


@dataclass
class CompositorConfig:
    screens: list[ScreenDef]
    stores: dict[str, list[DeviceSpec]]
    master_device: DeviceSpec

    def get_screen(self, key: str) -> Optional[ScreenDef]:
        return next((s for s in self.screens if s.key == key), None)

    def get_devices(self, store: str) -> list[DeviceSpec]:
        if store == "both":
            devices = []
            for store_devices in self.stores.values():
                devices.extend(store_devices)
            return devices
        return self.stores.get(store, [])


def load_screens(path: Optional[Path] = None) -> list[ScreenDef]:
    path = path or CONFIG_DIR / "screens.yaml"
    with open(path) as f:
        data = yaml.safe_load(f)
    screens = []
    for entry in data["screens"]:
        if entry["layout"] not in VALID_LAYOUTS:
            raise ValueError(f"Invalid layout '{entry['layout']}' for screen '{entry['key']}'")
        screens.append(ScreenDef(
            key=entry["key"],
            raw_filename=entry["raw_filename"],
            layout=entry["layout"],
            order=entry["order"],
            breakout_prompt=entry.get("breakout_prompt"),
        ))
    return sorted(screens, key=lambda s: s.order)


def load_devices(path: Optional[Path] = None) -> tuple[dict[str, list[DeviceSpec]], DeviceSpec]:
    path = path or CONFIG_DIR / "devices.yaml"
    with open(path) as f:
        data = yaml.safe_load(f)
    stores: dict[str, list[DeviceSpec]] = {}
    master = None
    for store_name, devices in data["stores"].items():
        specs = []
        for d in devices:
            spec = DeviceSpec(
                name=d["name"],
                width=d["width"],
                height=d["height"],
                master=d.get("master", False),
            )
            specs.append(spec)
            if spec.master:
                master = spec
        stores[store_name] = specs
    if master is None:
        first_store = next(iter(stores.values()))
        master = first_store[0]
    return stores, master


def load_locale(locale: str, config_dir: Optional[Path] = None) -> Optional[LocaleConfig]:
    config_dir = config_dir or CONFIG_DIR
    locale_path = config_dir / "locales" / f"{locale}.yaml"
    if not locale_path.exists():
        return None
    with open(locale_path) as f:
        data = yaml.safe_load(f)
    screens = {}
    for key, copy_data in data.get("screens", {}).items():
        screens[key] = ScreenCopy(
            label=copy_data["label"],
            headline=copy_data["headline"],
        )
    return LocaleConfig(
        locale=data["locale"],
        curated=data.get("curated", False),
        screens=screens,
    )


def list_curated_locales(config_dir: Optional[Path] = None) -> list[str]:
    config_dir = config_dir or CONFIG_DIR
    locales_dir = config_dir / "locales"
    if not locales_dir.exists():
        return []
    return [f.stem for f in sorted(locales_dir.glob("*.yaml"))]


def load_compositor_config() -> CompositorConfig:
    screens = load_screens()
    stores, master = load_devices()
    return CompositorConfig(screens=screens, stores=stores, master_device=master)
