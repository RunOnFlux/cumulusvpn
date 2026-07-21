"""Copy resolution from curated locale YAMLs.

The source skill's auto-translate fallbacks were removed with the multi-locale
machinery: a locale renders only if config/locales/<locale>.yaml exists and
covers the screen key. Anything else is a hard, named error — never silent
fallback copy.
"""

from pathlib import Path
from typing import Optional

from .config import ScreenCopy, load_locale


def resolve_copy(
    screen_key: str,
    locale: str,
    screenshot_path: Optional[Path] = None,
) -> ScreenCopy:
    """Resolve copy for a screen from the curated locale file."""
    locale_config = load_locale(locale)
    if locale_config is None:
        raise SystemExit(
            f"ERROR: no curated copy for locale '{locale}' — "
            f"create config/locales/{locale}.yaml"
        )
    if screen_key not in locale_config.screens:
        raise SystemExit(
            f"ERROR: screen '{screen_key}' missing from config/locales/{locale}.yaml"
        )
    return locale_config.screens[screen_key]
