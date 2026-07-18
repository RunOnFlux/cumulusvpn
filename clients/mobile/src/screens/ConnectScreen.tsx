/**
 * Connect — the one screen the whole product is about (mockup shot #1).
 *
 * Orb + tier pill + a country selector row + the big connect/disconnect button,
 * plus live down/up/ping stats when connected. Everything is driven by `useVpn`.
 */
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { RouteStyle } from '@cumulusvpn/core';
import type { Country } from '../lib/gateways';
import type { PaymentIdentity, VpnActions, VpnModel } from '../state/useVpn';
import { Orb } from '../components/Orb';
import { TierPill } from '../components/TierPill';
import { color, font, radius, space } from '../theme/tokens';

interface Props {
  readonly vpn: VpnModel & VpnActions;
  readonly onOpenCountries: () => void;
  readonly onOpenUpgrade: () => void;
  /** Open the picker to choose the multi-hop entry country. */
  readonly onOpenEntry: () => void;
  /** Open the picker to choose the multi-hop exit country. */
  readonly onOpenExit: () => void;
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
}: Props): React.JSX.Element {
  const connected = vpn.state === 'connected';
  const target: Country | null = vpn.selected ?? vpn.countries[0] ?? null;
  const busy = vpn.state === 'connecting' || vpn.state === 'disconnecting';

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Text style={styles.brand}>CumulusVPN</Text>
        <TierPill tier={vpn.tier} />
      </View>

      <View style={styles.orbWrap}>
        <Orb
          state={vpn.state}
          onPress={() => (connected ? void vpn.disconnect() : void vpn.connect())}
        />

        {connected && target ? (
          <View style={styles.loc}>
            <Text style={styles.flag}>{target.flag}</Text>
            <Text style={styles.country}>{target.name}</Text>
            <Text style={styles.ip}>
              exit {vpn.status ? formatBytes(vpn.status.rxBytes) : '—'} · {target.city}
            </Text>
          </View>
        ) : (
          <View style={styles.loc}>
            <Text style={styles.notConnected}>
              {vpn.booting ? 'Finding nearest gateway…' : 'Not connected'}
            </Text>
          </View>
        )}

        {connected && vpn.status ? (
          <View style={styles.statRow}>
            <Stat k="Rx" v={formatBytes(vpn.status.rxBytes)} />
            <Stat k="Tx" v={formatBytes(vpn.status.txBytes)} />
            <Stat
              k="Handshake"
              v={vpn.status.lastHandshake ? `${sinceSec(vpn.status.lastHandshake)}s` : '—'}
            />
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
        /* Single-hop country selector row (mockup .loc-btn) */
        <Pressable style={styles.locBtn} onPress={onOpenCountries} accessibilityRole="button">
          <Text style={styles.locBtnFlag}>{target?.flag ?? '🌐'}</Text>
          <View style={styles.locBtnMeta}>
            <Text style={styles.locBtnTitle}>{target?.name ?? 'Choose location'}</Text>
            <Text style={styles.locBtnSub}>
              {target
                ? `${target.city} · ${target.latencyMs ?? '—'} ms · ${target.nodeCount} nodes`
                : 'Tap to pick a country'}
            </Text>
          </View>
          <Text style={styles.chev}>›</Text>
        </Pressable>
      )}

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
      {vpn.tier === 'free' ? <UpgradeLine payment={vpn.payment} onPress={onOpenUpgrade} /> : null}

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
    </View>
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
 * tradeoff + v1 same-key caveat copy required by docs/11.
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

      {/* Honest tradeoff (docs/11 §Performance). */}
      <Text style={styles.tradeoff}>
        Slower — expect roughly 2× ping and lower peak speed. In return, no single server sees both
        who you are and where you go.
      </Text>

      {/* v1 same-key caveat (docs/11 §Entitlement & cost). */}
      <Text style={styles.caveat}>
        v1: both hops use the same key. A single payment covers both, but an adversary who controls
        both of your chosen hops could still correlate you via that shared key. Distinct-key-per-hop
        lands in v1.5.
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

/** A compact custom switch matching the app's glass/cyan aesthetic. */
function Toggle({
  value,
  disabled,
  onValueChange,
}: {
  readonly value: boolean;
  readonly disabled: boolean;
  readonly onValueChange: (value: boolean) => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={disabled ? undefined : () => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      style={[styles.track, value && styles.trackOn, disabled && styles.trackDisabled]}
    >
      <View style={[styles.thumb, value && styles.thumbOn]} />
    </Pressable>
  );
}

function UpgradeLine({
  payment,
  onPress,
}: {
  readonly payment: PaymentIdentity | null;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.upsell}>
      <Text style={styles.upsellText}>
        Free · 100 KB/s — <Text style={styles.upsellAccent}>Upgrade at cumulusvpn.com</Text>
      </Text>
      {payment ? <Text style={styles.upsellMemo}>{payment.memo}</Text> : null}
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
    return `${n} B`;
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

function sinceSec(unixSec: number): number {
  return Math.max(0, Math.round(Date.now() / 1000 - unixSec));
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.xl, paddingBottom: space.xxl, paddingTop: space.sm },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
  brand: { color: color.ink, fontWeight: '700', fontSize: 15, letterSpacing: -0.2 },
  orbWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl },
  loc: { alignItems: 'center' },
  flag: { fontSize: 30, lineHeight: 34 },
  country: { fontSize: 21, fontWeight: '700', color: color.ink, marginTop: space.xs },
  ip: { fontFamily: font.mono, fontSize: 11.5, color: color.inkDim, marginTop: 3 },
  notConnected: { fontSize: 16, color: color.inkMuted },
  statRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: space.xs },
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
  tradeoff: { color: color.inkMuted, fontSize: 12, lineHeight: 17, marginTop: space.xs },
  caveat: { fontFamily: font.mono, color: color.inkDim, fontSize: 10.5, lineHeight: 15 },
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
  track: {
    width: 46,
    height: 28,
    borderRadius: 14,
    backgroundColor: color.hairlineStrong,
    padding: 3,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: color.cyan },
  trackDisabled: { opacity: 0.6 },
  thumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignSelf: 'flex-start' },
  thumbOn: { alignSelf: 'flex-end' },
  upsell: { alignItems: 'center', marginBottom: space.md },
  upsellText: { color: color.inkMuted, fontSize: 13 },
  upsellAccent: { color: color.amber, fontWeight: '600' },
  upsellMemo: { fontFamily: font.mono, fontSize: 10.5, color: color.inkFaint, marginTop: 2 },
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
