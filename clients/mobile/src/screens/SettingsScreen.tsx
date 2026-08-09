/**
 * Settings — connection preferences + about. Kept intentionally small: the
 * product is "one screen, one job", so this is prefs, not a control panel.
 */
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { VpnActions, VpnModel } from '../state/useVpn';
import { CVPN_DIRECTORY_PUBKEY } from '../lib/directory';
import { PoweredByFlux } from '../components/PoweredByFlux';
import { SplitTunnelingSection } from '../components/SplitTunnelingSection';
import { TierPill } from '../components/TierPill';
import { Toggle } from '../components/Toggle';
import { formatExpiry } from './UpgradeScreen';
import { color, font, radius, space } from '../theme/tokens';

/** App version — Babel inlines this from package.json at build time (see
 *  babel.config.js), so the About row never drifts from the shipped release
 *  (bump package.json on release) without bundling the dependency manifest. */
const APP_VERSION = __APP_VERSION__;
const SITE_URL = 'https://cumulusvpn.com';
// Both stores require the privacy policy to be reachable from INSIDE the app,
// not only from the store listing. Support is Apple's required support URL.
const PRIVACY_URL = 'https://cumulusvpn.com/privacy';
const SUPPORT_URL = 'https://cumulusvpn.com/support';

interface Props {
  readonly vpn: VpnModel & VpnActions;
  readonly onClose: () => void;
  /**
   * Open the in-app upgrade flow. Absent when the `inAppUpgrade` flag is off
   * (always on iOS): the plan row is then a plain, non-interactive status —
   * no "tap to upgrade", no navigation (3.1.1: no purchase surface).
   */
  readonly onOpenUpgrade?: (() => void) | undefined;
  /** Re-open the 5.4 data disclosure (also shown as a first-run gate). */
  readonly onOpenPrivacy: () => void;
  /** Whether this build may show purchase/upsell surfaces (`flags.inAppUpgrade`). */
  readonly canUpgrade: boolean;
}

export function SettingsScreen({
  vpn,
  onClose,
  onOpenUpgrade,
  onOpenPrivacy,
  canUpgrade,
}: Props): React.JSX.Element {
  const premium = vpn.tier === 'premium';
  const expiry = formatExpiry(vpn.paidUntil);
  // Transport and routing choices are read when a tunnel is BUILT, so they
  // cannot apply to one already up. Lock them while a session exists rather than
  // letting a flipped switch imply an effect it won't have until reconnect.
  const locked =
    vpn.state === 'connected' || vpn.state === 'connecting' || vpn.state === 'disconnecting';
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.section}>Plan</Text>
        {onOpenUpgrade ? (
          <Pressable
            style={styles.planRow}
            onPress={onOpenUpgrade}
            accessibilityRole="button"
            accessibilityLabel={premium ? 'Manage your Premium plan' : 'Upgrade to Premium'}
          >
            <View style={styles.rowMeta}>
              <View style={styles.planTop}>
                <TierPill tier={vpn.tier} />
              </View>
              <Text style={styles.rowSub}>
                {premium ? planStatus(expiry) : 'Limited to 100 KB/s — tap to upgrade'}
              </Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </Pressable>
        ) : (
          /* No purchase flow in this build: the plan is a plain status fact. */
          <View style={styles.planRow}>
            <View style={styles.rowMeta}>
              <View style={styles.planTop}>
                <TierPill tier={vpn.tier} />
              </View>
              <Text style={styles.rowSub}>
                {premium ? planStatus(expiry) : 'Limited to 100 KB/s'}
              </Text>
            </View>
          </View>
        )}

        <Text style={styles.section}>Connection</Text>
        <ToggleRow
          title="Auto-connect on launch"
          sub="Connect automatically when the app opens"
          value={vpn.autoConnect}
          onValueChange={(v) => void vpn.setAutoConnect(v)}
        />
        <ToggleRow
          title="Kill switch"
          sub="Block all traffic if the VPN drops"
          value={vpn.killSwitch}
          onValueChange={(v) => void vpn.setKillSwitch(v)}
        />
        {/* Stealth mode — disguise the tunnel to get through DPI/VPN blocking
            (docs/15-transports.md). Prefers wg-tls, then awg, and never falls
            back to plain WireGuard: a gateway offering no DPI-resistant
            transport is a clear error, not a silent downgrade. Desktop keeps
            the same control in its own Settings panel. */}
        <ToggleRow
          title="Stealth mode"
          sub={
            locked
              ? 'Disguise VPN traffic to get through blocking — disconnect to change'
              : 'Disguise VPN traffic to get through blocking. Slower.'
          }
          value={vpn.transportMode === 'stealth'}
          disabled={locked}
          onValueChange={(v) => void vpn.setTransportMode(v ? 'stealth' : 'auto')}
        />
        {/* Node diversity — force the two multi-hop legs onto different subnets
            so they can't be the same rack (docs/11). Off by default; a small
            fleet can make it impossible, and connecting then fails with a note
            pointing back here. Only bites in multi-hop, hence the sub-text. */}
        <ToggleRow
          title="Node diversity"
          sub={
            locked
              ? 'Force multi-hop entry and exit onto different networks — disconnect to change'
              : 'Force multi-hop entry and exit onto different networks'
          }
          value={vpn.nodeDiversity}
          disabled={locked}
          onValueChange={(v) => void vpn.setNodeDiversity(v)}
        />
        {/* Android only: the ongoing VPN notification always exists (a
            foreground service must post one) — this controls whether it names
            the connected route or stays a generic "tunnel active" line. iOS
            has no equivalent surface (the status-bar VPN badge is system-owned),
            so the row would be a dead switch there. */}
        {Platform.OS === 'android' && (
          <ToggleRow
            title="Notification details"
            sub="Show the connected route in the ongoing VPN notification"
            value={vpn.notifDetails}
            onValueChange={(v) => void vpn.setNotifDetails(v)}
          />
        )}

        {/* Split tunneling (docs/17) — premium, applied when a tunnel is built,
            like the transport/routing toggles above. Hidden entirely for a
            non-premium user who has no way to buy (iOS store builds): showing a
            locked paid feature with no purchase path is the 3.1.1 upsell
            surface that got a previous build rejected. */}
        {(premium || canUpgrade) && (
          <>
            <Text style={styles.section}>Split tunneling</Text>
            <SplitTunnelingSection
              tier={vpn.tier}
              killSwitch={vpn.killSwitch}
              locked={locked}
              canUpgrade={canUpgrade}
            />
          </>
        )}

        <Text style={styles.section}>Privacy &amp; support</Text>
        <Pressable
          style={styles.linkRow}
          onPress={onOpenPrivacy}
          accessibilityRole="button"
          accessibilityLabel="What data CumulusVPN collects and how it is used"
        >
          <Text style={styles.linkText}>What data we collect</Text>
          <Text style={styles.chev}>›</Text>
        </Pressable>
        <Pressable
          style={styles.linkRow}
          onPress={() => void Linking.openURL(PRIVACY_URL)}
          accessibilityRole="link"
        >
          <Text style={styles.linkText}>Privacy Policy</Text>
          <Text style={styles.chev}>›</Text>
        </Pressable>
        <Pressable
          style={styles.linkRow}
          onPress={() => void Linking.openURL(SUPPORT_URL)}
          accessibilityRole="link"
        >
          <Text style={styles.linkText}>Support</Text>
          <Text style={styles.chev}>›</Text>
        </Pressable>

        <Text style={styles.section}>About</Text>
        <InfoRow label="Version" value={`CumulusVPN ${APP_VERSION}`} />
        <InfoRow
          label="Directory trust key"
          value={`${CVPN_DIRECTORY_PUBKEY.slice(0, 16)}…`}
          mono
        />
        <Pressable
          style={styles.linkRow}
          onPress={() => void Linking.openURL(SITE_URL)}
          accessibilityRole="link"
        >
          <Text style={styles.linkText}>cumulusvpn.com</Text>
          <Text style={styles.chev}>›</Text>
        </Pressable>

        <Text style={styles.footer}>
          Decentralized WireGuard VPN on Flux Cloud. No logs; your key never leaves this device.
        </Text>

        <View style={styles.poweredBy}>
          <PoweredByFlux />
        </View>
      </ScrollView>
    </View>
  );
}

/** Premium status line: expiry when known, else the generic full-speed fact. */
function planStatus(expiry: ReturnType<typeof formatExpiry>): string {
  return expiry
    ? `Active until ${expiry.date} · ${expiry.daysLeft} ${
        expiry.daysLeft === 1 ? 'day' : 'days'
      } left`
    : 'Full speed on every gateway';
}

function ToggleRow({
  title,
  sub,
  value,
  disabled = false,
  onValueChange,
}: {
  readonly title: string;
  readonly sub: string;
  readonly value: boolean;
  /** Dim and ignore taps — for settings that only take effect on the next
   *  connect, so flipping one mid-session can't imply it applied live. */
  readonly disabled?: boolean;
  readonly onValueChange: (value: boolean) => void;
}): React.JSX.Element {
  return (
    <View style={[styles.row, disabled && styles.rowDisabled]}>
      <View style={styles.rowMeta}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Toggle value={value} disabled={disabled} onValueChange={onValueChange} />
    </View>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{label}</Text>
      <Text style={[styles.infoValue, mono && styles.infoMono]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.xl, paddingTop: space.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
    marginBottom: space.md,
  },
  title: { color: color.ink, fontWeight: '700', fontSize: 17 },
  done: { color: color.cyan, fontWeight: '600', fontSize: 15 },
  body: { paddingBottom: space.xxl },
  section: {
    color: color.inkFaint,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: space.lg,
    marginBottom: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    marginBottom: space.sm,
    gap: space.md,
  },
  // Matches the dimming ConnectScreen used for the same locked-while-connected
  // rows, so moving them here didn't change how "you can't change this now" reads.
  rowDisabled: { opacity: 0.6 },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    marginBottom: space.sm,
    gap: space.md,
  },
  planTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  rowMeta: { flex: 1 },
  rowTitle: { color: color.ink, fontSize: 15, fontWeight: '600' },
  rowSub: { color: color.inkDim, fontSize: 12, marginTop: 2 },
  infoValue: { color: color.inkMuted, fontSize: 13, flexShrink: 1, textAlign: 'right' },
  infoMono: { fontFamily: font.mono, fontSize: 11.5 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: 14,
    marginBottom: space.sm,
  },
  linkText: { color: color.cyan, fontSize: 15, fontWeight: '600' },
  chev: { color: color.inkDim, fontSize: 20 },
  footer: { color: color.inkFaint, fontSize: 11.5, lineHeight: 17, marginTop: space.md },
  poweredBy: { marginTop: space.lg, alignItems: 'center' },
});
