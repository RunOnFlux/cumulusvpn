/**
 * CumulusVPN mobile root.
 *
 * One product, three screens (docs/05 "one screen, one job: connect"):
 * Connect ⇄ CountryPicker and Connect ⇄ Upgrade. Navigation is a tiny local
 * state machine — no react-navigation dependency for a three-screen app keeps
 * the bundle lean and the typecheck clean.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoidingScreen } from './src/components/KeyboardAvoidingScreen';
import { PoweredByFlux } from './src/components/PoweredByFlux';
import { TransferNoticeSheet } from './src/components/TransferNoticeSheet';
import { useVpn } from './src/state/useVpn';
import { useFlags } from './src/state/useFlags';
import { useIap } from './src/state/useIap';
import { useTransferNotice } from './src/state/useTransferNotice';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { CountryPickerScreen } from './src/screens/CountryPickerScreen';
import { UpgradeScreen } from './src/screens/UpgradeScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { DisclosureScreen } from './src/screens/DisclosureScreen';
import { loadDisclosureAck, saveDisclosureAck } from './src/state/storage';
import { color } from './src/theme/tokens';

type Route = 'connect' | 'countries' | 'upgrade' | 'entry' | 'exit' | 'settings' | 'privacy';

function App(): React.JSX.Element {
  const vpn = useVpn();
  const flags = useFlags();
  // Any purchase surface on = the upgrade route exists. The IAP hook only
  // mounts store machinery when its flag is on (and quietly no-ops otherwise).
  const canUpgrade =
    flags.inAppUpgrade || flags.iapPurchase || flags.voucherRedeem || flags.webPayLink;
  const iap = useIap(flags.iapPurchase, vpn.payment?.code ?? null, vpn.tier === 'premium');
  const [route, setRoute] = useState<Route>('connect');
  // One-time "save your recovery key" prompt (flag `transferNotice`), and
  // whether Settings should open at the identity with the key shown.
  const notice = useTransferNotice(flags.transferNotice, vpn.tier, vpn.paidUntil);
  const [focusIdentity, setFocusIdentity] = useState(false);
  // App Store 5.4: the data disclosure must be seen BEFORE the service is used,
  // so it gates the whole UI on first launch. `null` = still reading the ack
  // from storage; we hold on the boot view rather than flash the gate at a user
  // who already accepted.
  const [disclosed, setDisclosed] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void loadDisclosureAck().then((ack) => {
      if (alive) {
        setDisclosed(ack);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const acceptDisclosure = (): void => {
    setDisclosed(true);
    void saveDisclosureAck();
  };

  // If every purchase flag drops while the user is ON the upgrade screen
  // (remote flip reaching a foregrounded app), snap back to Connect — the
  // route must never outlive the flags that make it legal to show.
  useEffect(() => {
    if (route === 'upgrade' && !canUpgrade) {
      setRoute('connect');
    }
  }, [route, canUpgrade]);

  // The prompt's "Show recovery key" opens Settings once at the key; leaving
  // Settings any way (Done, back, privacy page) drops that.
  useEffect(() => {
    if (route !== 'settings') {
      setFocusIdentity(false);
    }
  }, [route]);

  // Android hardware back: from any sub-screen, return to Connect instead of
  // closing the app; on Connect, fall through to the default (exit).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route !== 'connect') {
        setRoute('connect');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [route]);

  return (
    <SafeAreaProvider>
      {/* Light icons on a transparent status bar; the SafeAreaView below insets
          content past it. Android draws edge-to-edge (edgeToEdgeEnabled in
          android/gradle.properties), so the bar has no background of its own —
          RN 0.87 removed the `translucent` / `backgroundColor` props. */}
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingScreen style={styles.screen}>
          {disclosed === null ? (
            <View style={styles.boot}>
              <View style={styles.bootCenter}>
                <ActivityIndicator color={color.cyan} />
              </View>
            </View>
          ) : !disclosed ? (
            <DisclosureScreen onAccept={acceptDisclosure} />
          ) : vpn.booting && vpn.countries.length === 0 ? (
            <View style={styles.boot}>
              <View style={styles.bootCenter}>
                <ActivityIndicator color={color.cyan} />
                <Text style={styles.bootText}>Connecting to the decentralized Flux network…</Text>
              </View>
              <View style={styles.bootFooter}>
                <PoweredByFlux />
              </View>
            </View>
          ) : route === 'countries' ? (
            <CountryPickerScreen
              countries={vpn.countries}
              locations={vpn.locations}
              selectedCode={vpn.selected?.id ?? null}
              onSelect={(id) => void vpn.selectCountry(id)}
              onSelectAuto={() => void vpn.selectCountry(null)}
              allowWholeCountry
              onClose={() => setRoute('connect')}
              onRefresh={() => vpn.refresh()}
              discovering={vpn.discovering}
              favorites={vpn.favorites}
              onToggleFavorite={(code) => void vpn.toggleFavorite(code)}
            />
          ) : route === 'entry' ? (
            <CountryPickerScreen
              countries={vpn.countries}
              locations={vpn.locations}
              selectedCode={vpn.entry?.id ?? null}
              onSelect={(id) => void vpn.selectEntryCountry(id)}
              onSelectAuto={() => void vpn.selectEntryCountry(null)}
              allowWholeCountry
              onClose={() => setRoute('connect')}
              onRefresh={() => vpn.refresh()}
              discovering={vpn.discovering}
              favorites={vpn.favorites}
              onToggleFavorite={(code) => void vpn.toggleFavorite(code)}
            />
          ) : route === 'exit' ? (
            <CountryPickerScreen
              countries={vpn.countries}
              locations={vpn.locations}
              selectedCode={vpn.exit?.id ?? null}
              onSelect={(id) => void vpn.selectExitCountry(id)}
              onSelectAuto={() => void vpn.selectExitCountry(null)}
              allowWholeCountry
              onClose={() => setRoute('connect')}
              onRefresh={() => vpn.refresh()}
              discovering={vpn.discovering}
              favorites={vpn.favorites}
              onToggleFavorite={(code) => void vpn.toggleFavorite(code)}
            />
          ) : route === 'upgrade' && canUpgrade ? (
            <UpgradeScreen
              tier={vpn.tier}
              paidUntil={vpn.paidUntil}
              payment={vpn.payment}
              cryptoEnabled={flags.inAppUpgrade}
              voucherEnabled={flags.voucherRedeem}
              webPayEnabled={flags.webPayLink}
              iap={flags.iapPurchase ? iap : null}
              onClose={() => setRoute('connect')}
            />
          ) : route === 'privacy' ? (
            <DisclosureScreen onClose={() => setRoute('settings')} />
          ) : route === 'settings' ? (
            <SettingsScreen
              vpn={vpn}
              onClose={() => setRoute('connect')}
              onOpenUpgrade={canUpgrade ? () => setRoute('upgrade') : undefined}
              onOpenPrivacy={() => setRoute('privacy')}
              canUpgrade={canUpgrade}
              focusIdentity={focusIdentity}
            />
          ) : (
            <ConnectScreen
              vpn={vpn}
              onOpenCountries={() => setRoute('countries')}
              onOpenUpgrade={canUpgrade ? () => setRoute('upgrade') : undefined}
              onOpenEntry={() => setRoute('entry')}
              onOpenExit={() => setRoute('exit')}
              onOpenSettings={() => setRoute('settings')}
            />
          )}
        </KeyboardAvoidingScreen>
      </SafeAreaView>
      <TransferNoticeSheet
        visible={notice.visible && disclosed === true && route === 'connect'}
        onShowKey={() => {
          notice.dismiss();
          setFocusIdentity(true);
          setRoute('settings');
        }}
        onDismiss={notice.dismiss}
      />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  // The phone "sky" background from the mockup. POC: a single solid stop; a
  // future react-native-linear-gradient pass renders the full 3-stop gradient.
  // Keep the SafeAreaView the SAME colour as the content so the top/bottom
  // safe-area insets (notch, home indicator) don't show a darker band — the
  // background reads as one full-bleed surface.
  safe: { flex: 1, backgroundColor: color.sky2 },
  screen: { flex: 1, backgroundColor: color.sky2 },
  boot: { flex: 1 },
  bootCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 32,
  },
  bootText: { color: color.inkDim, fontSize: 14, textAlign: 'center' },
  bootFooter: { paddingBottom: 20, alignItems: 'center' },
});

export default App;
