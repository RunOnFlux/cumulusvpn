/**
 * Settings — connection preferences + about. Kept intentionally small: the
 * product is "one screen, one job", so this is prefs, not a control panel.
 */
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { VpnActions, VpnModel } from '../state/useVpn';
import { CVPN_DIRECTORY_PUBKEY } from '../lib/directory';
import { PoweredByFlux } from '../components/PoweredByFlux';
import { TierPill } from '../components/TierPill';
import { Toggle } from '../components/Toggle';
import { formatExpiry } from './UpgradeScreen';
import { color, font, radius, space } from '../theme/tokens';

/** App version — matches the release tag; single source is package.json. */
const APP_VERSION = '0.1.0';
const SITE_URL = 'https://cumulusvpn.com';

interface Props {
  readonly vpn: VpnModel & VpnActions;
  readonly onClose: () => void;
  readonly onOpenUpgrade: () => void;
}

export function SettingsScreen({ vpn, onClose, onOpenUpgrade }: Props): React.JSX.Element {
  const premium = vpn.tier === 'premium';
  const expiry = formatExpiry(vpn.paidUntil);
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
              {premium
                ? expiry
                  ? `Active until ${expiry.date} · ${expiry.daysLeft} ${
                      expiry.daysLeft === 1 ? 'day' : 'days'
                    } left`
                  : 'Full speed on every gateway'
                : 'Limited to 100 KB/s — tap to upgrade'}
            </Text>
          </View>
          <Text style={styles.chev}>›</Text>
        </Pressable>

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

function ToggleRow({
  title,
  sub,
  value,
  onValueChange,
}: {
  readonly title: string;
  readonly sub: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <View style={styles.rowMeta}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Toggle value={value} onValueChange={onValueChange} />
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
