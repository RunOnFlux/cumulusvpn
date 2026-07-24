/**
 * Connect — the one screen the whole product is about (mockup shot #1).
 *
 * Orb + tier pill + a country selector row + the big connect/disconnect button,
 * plus live down/up/ping stats when connected. Everything is driven by `useVpn`.
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { RouteStyle } from '@cumulusvpn/core';
import type { Country } from '../lib/gateways';
import type { VpnActions, VpnModel } from '../state/useVpn';
import { Orb } from '../components/Orb';
import { TierPill } from '../components/TierPill';
import { Toggle } from '../components/Toggle';
import { color, font, radius, space } from '../theme/tokens';

interface Props {
  readonly vpn: VpnModel & VpnActions;
  readonly onOpenCountries: () => void;
  readonly onOpenUpgrade: () => void;
  /** Open the picker to choose the multi-hop entry country. */
  readonly onOpenEntry: () => void;
  /** Open the picker to choose the multi-hop exit country. */
  readonly onOpenExit: () => void;
  /** Open the settings screen. */
  readonly onOpenSettings: () => void;
}

/** The multi-hop route styles offered in the UI (excludes single-hop). */
const MULTIHOP_STYLES: readonly {
  readonly style: Extract<RouteStyle, `multihop-${string}`>;
  readonly title: string;
  readonly sub: string;
}[] = [
  {
    style: 'multihop-same-country',
    title: 'Balanced — same country',
    sub: 'Entry ≠ exit, one jurisdiction · ~1.3–1.6× ping',
  },
  {
    style: 'multihop-cross-jurisdiction',
    title: 'Max privacy — cross-jurisdiction',
    sub: 'Two countries, two operators · highest ping',
  },
];

export function ConnectScreen({
  vpn,
  onOpenCountries,
  onOpenUpgrade,
  onOpenEntry,
  onOpenExit,
  onOpenSettings,
}: Props): React.JSX.Element {
  const connected = vpn.state === 'connected';
  // No explicit single-hop location chosen → Automatic (route to the nearest).
  const auto = vpn.selected === null;
  const target: Country | null = vpn.selected ?? vpn.locations[0] ?? null;
  const busy = vpn.state === 'connecting' || vpn.state === 'disconnecting';

  // Tick every second while connected so the session timer stays live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!connected) {
      return undefined;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [connected]);
  const elapsed = vpn.connectedSince ? formatDuration(now - vpn.connectedSince) : null;

  return (
    <ScrollView
      style={styles.rootScroll}
      contentContainerStyle={styles.root}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      <View style={styles.top}>
        <Text style={styles.brand}>CumulusVPN</Text>
        <View style={styles.topRight}>
          <Pressable
            onPress={onOpenUpgrade}
            accessibilityRole="button"
            accessibilityLabel={vpn.tier === 'premium' ? 'View your plan' : 'Upgrade to Premium'}
            hitSlop={8}
          >
            <TierPill tier={vpn.tier} />
          </Pressable>
          <Pressable onPress={onOpenSettings} accessibilityRole="button" hitSlop={10}>
            <Text style={styles.gear}>⚙</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.orbWrap}>
        <Orb
          state={vpn.state}
          onPress={() => (connected ? void vpn.disconnect() : void vpn.connect())}
        />

        {connected && vpn.activeExit && vpn.activeEntry ? (
          /* Multi-hop: show the real entry → exit route + both gateway IPs. */
          <View style={styles.loc}>
            <Text style={styles.route}>
              {vpn.activeEntry.flag} {vpn.activeEntry.name}
              <Text style={styles.routeArrow}>{'  →  '}</Text>
              {vpn.activeExit.flag} {vpn.activeExit.name}
            </Text>
            <Text style={styles.ip}>
              Entry {vpn.activeEntry.city} · {vpn.activeEntry.ip}
            </Text>
            <Text style={styles.ip}>
              Exit {vpn.activeExit.city} · {vpn.activeExit.ip}
            </Text>
            <Text style={styles.ip}>{elapsed ? `Protected · ${elapsed}` : 'Protected'}</Text>
          </View>
        ) : connected && vpn.activeEntry ? (
          /* Single-hop: the entry gateway is also the egress. */
          <View style={styles.loc}>
            <Text style={styles.flag}>{vpn.activeEntry.flag}</Text>
            <Text style={styles.country}>{vpn.activeEntry.name}</Text>
            <Text style={styles.ip}>
              {vpn.activeEntry.city} · {vpn.activeEntry.ip}
            </Text>
            <Text style={styles.ip}>{elapsed ? `Protected · ${elapsed}` : 'Protected'}</Text>
          </View>
        ) : (
          <View style={styles.loc}>
            <Text style={styles.notConnected}>
              {vpn.booting || (vpn.discovering && vpn.countries.length === 0)
                ? 'Finding fastest servers…'
                : 'Not connected'}
            </Text>
          </View>
        )}

        {connected ? (
          <>
            <View style={styles.statRow}>
              <Stat k="Download" v={`${formatBytes(vpn.speed.down)}/s`} />
              <Stat k="Upload" v={`${formatBytes(vpn.speed.up)}/s`} />
              <Stat k="Ping" v={vpn.pingMs === null ? '—' : `${vpn.pingMs} ms`} />
            </View>
            {vpn.status ? (
              <Text style={styles.dataLine}>
                Data used ↓ {formatBytes(vpn.status.rxBytes)} · ↑ {formatBytes(vpn.status.txBytes)}
              </Text>
            ) : null}
          </>
        ) : null}

        {/* Serving the cached fleet while a background refresh fetches fresh. */}
        {vpn.discovering && vpn.countries.length > 0 ? (
          <View style={styles.updating}>
            <ActivityIndicator size="small" color={color.inkFaint} />
            <Text style={styles.updatingText}>Updating servers from the Flux network…</Text>
          </View>
        ) : null}
      </View>

      {/* Fast / Multi-hop toggle — multi-hop is OFF by default (docs/11 §UX). */}
      <ModeToggle
        multihop={vpn.multihop}
        disabled={connected || busy}
        onFast={() => void vpn.setRouteStyle('single')}
        onMultihop={() =>
          void vpn.setRouteStyle(
            vpn.routeStyle === 'single' ? 'multihop-same-country' : vpn.routeStyle,
          )
        }
      />

      {vpn.multihop ? (
        <MultihopControls
          vpn={vpn}
          disabled={connected || busy}
          onOpenEntry={onOpenEntry}
          onOpenExit={onOpenExit}
        />
      ) : (
        /* Single-hop country selector row (mockup .loc-btn). `auto` = no explicit
           country chosen → we route to the nearest (`target`). */
        <Pressable style={styles.locBtn} onPress={onOpenCountries} accessibilityRole="button">
          <Text style={styles.locBtnFlag}>{auto ? '⚡' : (target?.flag ?? '🌐')}</Text>
          <View style={styles.locBtnMeta}>
            <Text style={styles.locBtnTitle}>
              {auto ? 'Automatic' : (target?.name ?? 'Choose location')}
            </Text>
            <Text style={styles.locBtnSub}>
              {target
                ? auto
                  ? `Nearest: ${target.name} · ${target.latencyMs ?? '—'} ms`
                  : `${target.city} · ${target.latencyMs ?? '—'} ms · ${target.nodeCount} nodes`
                : 'Tap to pick a country'}
            </Text>
          </View>
          <Text style={styles.chev}>›</Text>
        </Pressable>
      )}

      {/* Stealth mode — obfuscate the tunnel to bypass DPI/VPN-blocking
          (docs/15). iOS + Android run the obfuscated engine natively; desktop
          follows. Falls back to the fastest transport where a gateway doesn't
          offer an obfuscated one. */}
      {Platform.OS === 'ios' || Platform.OS === 'android' ? (
        <View style={[styles.divRow, (connected || busy) && styles.divRowDisabled]}>
          <View style={styles.divMeta}>
            <Text style={styles.divTitle}>Stealth mode</Text>
            <Text style={styles.divSub}>
              {vpn.transportMode === 'stealth'
                ? 'On — disguise VPN traffic to bypass blocking'
                : 'Off — fastest connection'}
            </Text>
          </View>
          <Toggle
            value={vpn.transportMode === 'stealth'}
            disabled={connected || busy}
            onValueChange={(v) => void vpn.setTransportMode(v ? 'stealth' : 'auto')}
          />
        </View>
      ) : null}

      {/* Kill switch — block all traffic if the tunnel drops (docs/05). */}
      <KillSwitchRow
        enabled={vpn.killSwitch}
        disabled={connected || busy}
        onToggle={(v) => {
          void vpn.setKillSwitch(v);
          // Android can't force lockdown from code — send the user to the OS
          // toggle the moment they turn it on so the intent is obvious.
          if (v && Platform.OS === 'android') {
            void vpn.openVpnSettings();
          }
        }}
        onOpenSettings={() => void vpn.openVpnSettings()}
      />

      {/* Free-tier upsell line — store-compliant, no purchase UI (docs/05). */}
      {vpn.tier === 'free' ? <UpgradeLine onPress={onOpenUpgrade} /> : null}

      <Pressable
        style={[
          styles.bigBtn,
          connected ? styles.bigDisc : styles.bigConnect,
          busy && styles.bigBtnBusy,
        ]}
        onPress={busy ? undefined : () => (connected ? void vpn.disconnect() : void vpn.connect())}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
      >
        <Text
          style={[styles.bigBtnLabel, connected ? styles.bigDiscLabel : styles.bigConnectLabel]}
        >
          {busy
            ? vpn.state === 'disconnecting'
              ? 'Disconnecting…'
              : 'Connecting…'
            : connected
              ? 'Disconnect'
              : 'Connect'}
        </Text>
      </Pressable>

      {vpn.error ? <Text style={styles.error}>{vpn.error}</Text> : null}
    </ScrollView>
  );
}

/** Segmented Fast | Multi-hop control. Fast is the default (multi-hop off). */
function ModeToggle({
  multihop,
  disabled,
  onFast,
  onMultihop,
}: {
  readonly multihop: boolean;
  readonly disabled: boolean;
  readonly onFast: () => void;
  readonly onMultihop: () => void;
}): React.JSX.Element {
  return (
    <View style={[styles.segment, disabled && styles.segmentDisabled]}>
      <Pressable
        style={[styles.segBtn, !multihop && styles.segBtnFast]}
        onPress={disabled ? undefined : onFast}
        accessibilityRole="button"
        accessibilityState={{ selected: !multihop, disabled }}
      >
        <Text style={[styles.segLabel, !multihop && styles.segLabelFast]}>Fast</Text>
      </Pressable>
      <Pressable
        style={[styles.segBtn, multihop && styles.segBtnMulti]}
        onPress={disabled ? undefined : onMultihop}
        accessibilityRole="button"
        accessibilityState={{ selected: multihop, disabled }}
      >
        <Text style={[styles.segLabel, multihop && styles.segLabelMulti]}>Multi-hop</Text>
      </Pressable>
    </View>
  );
}

/**
 * Multi-hop panel: route-style chooser, entry/exit pickers, and the honest
 * speed/privacy tradeoff line.
 */
function MultihopControls({
  vpn,
  disabled,
  onOpenEntry,
  onOpenExit,
}: {
  readonly vpn: VpnModel & VpnActions;
  readonly disabled: boolean;
  readonly onOpenEntry: () => void;
  readonly onOpenExit: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.mhWrap}>
      {/* Route-style chooser */}
      {MULTIHOP_STYLES.map((opt) => {
        const active = vpn.routeStyle === opt.style;
        return (
          <Pressable
            key={opt.style}
            style={[styles.styleRow, active && styles.styleRowActive]}
            onPress={disabled ? undefined : () => void vpn.setRouteStyle(opt.style)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled }}
          >
            <View style={[styles.radio, active && styles.radioActive]}>
              {active ? <View style={styles.radioDot} /> : null}
            </View>
            <View style={styles.styleMeta}>
              <Text style={styles.styleTitle}>{opt.title}</Text>
              <Text style={styles.styleSub}>{opt.sub}</Text>
            </View>
          </Pressable>
        );
      })}

      {/* Entry → Exit pickers (reuse CountryPickerScreen via the parent). */}
      <View style={styles.hopRow}>
        <HopButton
          role="Entry"
          country={vpn.entry}
          hint="sees your IP"
          onPress={disabled ? undefined : onOpenEntry}
        />
        <Text style={styles.hopArrow}>→</Text>
        <HopButton
          role="Exit"
          country={vpn.exit}
          hint="sees your dest"
          onPress={disabled ? undefined : onOpenExit}
        />
      </View>

      {/* Node diversity — force entry and exit onto different subnets so the two
          hops can't be the same rack. Off by default (docs/11); a small fleet
          may make it impossible, in which case connecting fails with a note. */}
      <View style={[styles.divRow, disabled && styles.divRowDisabled]}>
        <View style={styles.divMeta}>
          <Text style={styles.divTitle}>Node diversity</Text>
          <Text style={styles.divSub}>
            {vpn.nodeDiversity
              ? 'On — entry and exit forced onto different networks'
              : 'Off — entry and exit may share a network'}
          </Text>
        </View>
        <Toggle
          value={vpn.nodeDiversity}
          disabled={disabled}
          onValueChange={(v) => void vpn.setNodeDiversity(v)}
        />
      </View>

      {/* Honest tradeoff (docs/11 §Performance). */}
      <Text style={styles.tradeoff}>
        Slower — expect roughly 2× ping and lower peak speed. In return, no single server sees both
        who you are and where you go.
      </Text>
    </View>
  );
}

/** One end of the route (entry or exit) as a compact picker button. */
function HopButton({
  role,
  country,
  hint,
  onPress,
}: {
  readonly role: string;
  readonly country: Country | null;
  readonly hint: string;
  readonly onPress?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <Pressable style={styles.hopBtn} onPress={onPress} accessibilityRole="button">
      <Text style={styles.hopRole}>
        {role} · {hint}
      </Text>
      <View style={styles.hopMain}>
        <Text style={styles.hopFlag}>{country?.flag ?? '🎯'}</Text>
        <Text style={styles.hopName} numberOfLines={1}>
          {country?.name ?? 'Auto'}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Kill-switch row: a glass card with a shield, a plain-language explanation, and
 * a toggle. On iOS the toggle fully controls it (on-demand + includeAllNetworks
 * applied on the next connect); on Android — where apps can't force lockdown — it
 * additionally hands the user to the OS VPN settings.
 */
function KillSwitchRow({
  enabled,
  disabled,
  onToggle,
  onOpenSettings,
}: {
  readonly enabled: boolean;
  readonly disabled: boolean;
  readonly onToggle: (value: boolean) => void;
  readonly onOpenSettings: () => void;
}): React.JSX.Element {
  const isAndroid = Platform.OS === 'android';
  const sub = enabled
    ? isAndroid
      ? 'On — finish setup in Android VPN settings'
      : 'On — blocks all traffic if the VPN drops'
    : 'Blocks all traffic if the VPN ever drops';
  return (
    <View style={[styles.ksRow, disabled && styles.ksRowDisabled]}>
      <Text style={styles.ksIcon}>🛡️</Text>
      <View style={styles.ksMeta}>
        <Text style={styles.ksTitle}>Kill switch</Text>
        <Text style={styles.ksSub}>{sub}</Text>
        {enabled && isAndroid ? (
          <Pressable onPress={onOpenSettings} accessibilityRole="link" hitSlop={6}>
            <Text style={styles.ksLink}>Open VPN settings ›</Text>
          </Pressable>
        ) : null}
      </View>
      <Toggle value={enabled} disabled={disabled} onValueChange={onToggle} />
    </View>
  );
}

function UpgradeLine({ onPress }: { readonly onPress: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.upsell}>
      <Text style={styles.upsellText}>
        Free · 100 KB/s — <Text style={styles.upsellAccent}>Go Premium for full speed ›</Text>
      </Text>
    </Pressable>
  );
}

function Stat({ k, v }: { readonly k: string; readonly v: string }): React.JSX.Element {
  return (
    <View style={styles.stat}>
      <Text style={styles.statK}>{k}</Text>
      <Text style={styles.statV}>{v}</Text>
    </View>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) {
    // Round: speeds are fractional bytes/sec, so `${n}` would print a long tail
    // of decimals (e.g. "523.7481 B/s").
    return `${Math.round(n)} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** Compact elapsed duration: "45s", "12m 03s", "2h 09m". */
function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  if (m > 0) {
    return `${m}m ${String(sec).padStart(2, '0')}s`;
  }
  return `${sec}s`;
}

const styles = StyleSheet.create({
  // ScrollView so short screens scroll instead of the orb overlapping the
  // Fast/Multi-hop toggle. `root` is the content container: flexGrow lets it
  // fill (and vertically centre the orb) on tall screens, and grow past the
  // viewport — scrolling — on short ones.
  rootScroll: { flex: 1 },
  root: {
    flexGrow: 1,
    paddingHorizontal: space.xl,
    paddingBottom: space.xxl,
    paddingTop: space.sm,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
  brand: { color: color.ink, fontWeight: '700', fontSize: 15, letterSpacing: -0.2 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  gear: { color: color.inkMuted, fontSize: 20 },
  // minHeight floors the orb area (orb 168 + gap + label) so a short screen
  // can't squeeze it into the toggle below; flex:1 still centres it when there
  // is spare room. paddingVertical keeps breathing space at the floor height.
  orbWrap: {
    flex: 1,
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xl,
    paddingVertical: space.md,
  },
  loc: { alignItems: 'center', paddingHorizontal: space.md },
  updating: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  updatingText: { color: color.inkFaint, fontSize: 11.5 },
  route: {
    fontSize: 18,
    fontWeight: '700',
    color: color.ink,
    textAlign: 'center',
    marginBottom: 4,
  },
  routeArrow: { color: color.cyan, fontWeight: '600' },
  flag: { fontSize: 30, lineHeight: 34 },
  country: { fontSize: 21, fontWeight: '700', color: color.ink, marginTop: space.xs },
  ip: { fontFamily: font.mono, fontSize: 11.5, color: color.inkDim, marginTop: 3 },
  notConnected: { fontSize: 16, color: color.inkMuted },
  statRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: space.xs },
  dataLine: {
    fontFamily: font.mono,
    fontSize: 11.5,
    color: color.inkFaint,
    textAlign: 'center',
    marginTop: space.sm,
  },
  stat: {
    flex: 1,
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  statK: {
    fontSize: 10,
    color: color.inkFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  statV: { fontFamily: font.mono, fontSize: 15, fontWeight: '600', color: color.ink, marginTop: 3 },
  // Fast / Multi-hop segmented toggle.
  segment: {
    flexDirection: 'row',
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 3,
    marginBottom: space.md,
  },
  segmentDisabled: { opacity: 0.5 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.sm - 3 },
  segBtnFast: { backgroundColor: color.cyan },
  segBtnMulti: { backgroundColor: color.amber },
  segLabel: { fontSize: 13, fontWeight: '600', color: color.inkMuted },
  segLabelFast: { color: '#05201E' },
  segLabelMulti: { color: color.premiumInk },

  // Multi-hop panel.
  mhWrap: { marginBottom: space.md, gap: space.sm },
  styleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: space.md,
    gap: space.md,
  },
  styleRowActive: { borderColor: 'rgba(245,178,61,0.55)' },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: color.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: color.amber },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.amber },
  styleMeta: { flex: 1 },
  styleTitle: { color: color.ink, fontSize: 14, fontWeight: '600' },
  styleSub: { color: color.inkDim, fontSize: 11.5, marginTop: 2 },
  hopRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  hopArrow: { color: color.amber, fontSize: 18, fontWeight: '700' },
  hopBtn: {
    flex: 1,
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  hopRole: {
    fontSize: 9.5,
    color: color.inkFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  hopMain: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  hopFlag: { fontSize: 18 },
  hopName: { flex: 1, color: color.ink, fontSize: 14, fontWeight: '600' },
  divRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: space.md,
    gap: space.md,
    marginTop: space.xs,
  },
  divRowDisabled: { opacity: 0.6 },
  divMeta: { flex: 1 },
  divTitle: { color: color.ink, fontSize: 14, fontWeight: '600' },
  divSub: { color: color.inkDim, fontSize: 11.5, marginTop: 2 },
  tradeoff: { color: color.inkMuted, fontSize: 12, lineHeight: 17, marginTop: space.xs },
  locBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.md,
    marginBottom: space.md,
  },
  locBtnFlag: { fontSize: 24 },
  locBtnMeta: { flex: 1 },
  locBtnTitle: { color: color.ink, fontWeight: '600', fontSize: 15 },
  locBtnSub: { color: color.inkDim, fontSize: 12, marginTop: 2 },
  chev: { color: color.inkDim, fontSize: 22 },
  // Kill-switch row.
  ksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.md,
    marginBottom: space.md,
  },
  ksRowDisabled: { opacity: 0.5 },
  ksIcon: { fontSize: 20 },
  ksMeta: { flex: 1 },
  ksTitle: { color: color.ink, fontWeight: '600', fontSize: 15 },
  ksSub: { color: color.inkDim, fontSize: 12, marginTop: 2 },
  ksLink: { color: color.cyan, fontSize: 12, fontWeight: '600', marginTop: 5 },
  upsell: { alignItems: 'center', marginBottom: space.md },
  upsellText: { color: color.inkMuted, fontSize: 13 },
  upsellAccent: { color: color.amber, fontWeight: '600' },
  bigBtn: { borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  // Clearly-disabled look while connecting/disconnecting (was too subtle before).
  bigBtnBusy: { opacity: 0.45 },
  bigConnect: { backgroundColor: color.cyan },
  bigDisc: { backgroundColor: color.glass, borderColor: color.hairlineStrong, borderWidth: 1 },
  bigBtnLabel: { fontSize: 16, fontWeight: '700' },
  bigConnectLabel: { color: '#05201E' },
  bigDiscLabel: { color: color.ink },
  error: { color: color.red, fontSize: 12, textAlign: 'center', marginTop: space.md },
});
