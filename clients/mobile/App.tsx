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
import { PoweredByFlux } from './src/components/PoweredByFlux';
import { useVpn } from './src/state/useVpn';
import { useFlags } from './src/state/useFlags';
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
  const [route, setRoute] = useState<Route>('connect');
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
      {/* Transparent status bar; the SafeAreaView below insets content past it
          (Android 15+ / SDK 36 is edge-to-edge, so a bar background is ignored). */}
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.screen}>
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
              onClose={() => setRoute('connect')}
              onRefresh={() => vpn.refresh()}
              discovering={vpn.discovering}
              favorites={vpn.favorites}
              onToggleFavorite={(code) => void vpn.toggleFavorite(code)}
            />
          ) : route === 'entry' ? (
            <CountryPickerScreen
              countries={vpn.countries}
              selectedCode={vpn.entry?.code ?? null}
              onSelect={(code) => void vpn.selectEntryCountry(code)}
              onSelectAuto={() => void vpn.selectEntryCountry(null)}
              onClose={() => setRoute('connect')}
              onRefresh={() => vpn.refresh()}
              discovering={vpn.discovering}
              favorites={vpn.favorites}
              onToggleFavorite={(code) => void vpn.toggleFavorite(code)}
            />
          ) : route === 'exit' ? (
            <CountryPickerScreen
              countries={vpn.countries}
              selectedCode={vpn.exit?.code ?? null}
              onSelect={(code) => void vpn.selectExitCountry(code)}
              onSelectAuto={() => void vpn.selectExitCountry(null)}
              onClose={() => setRoute('connect')}
              onRefresh={() => vpn.refresh()}
              discovering={vpn.discovering}
              favorites={vpn.favorites}
              onToggleFavorite={(code) => void vpn.toggleFavorite(code)}
            />
          ) : route === 'upgrade' ? (
            <UpgradeScreen
              tier={vpn.tier}
              paidUntil={vpn.paidUntil}
              payment={vpn.payment}
              inAppUpgrade={flags.inAppUpgrade}
              onClose={() => setRoute('connect')}
            />
          ) : route === 'privacy' ? (
            <DisclosureScreen onClose={() => setRoute('settings')} />
          ) : route === 'settings' ? (
            <SettingsScreen
              vpn={vpn}
              onClose={() => setRoute('connect')}
              onOpenUpgrade={() => setRoute('upgrade')}
              onOpenPrivacy={() => setRoute('privacy')}
            />
          ) : (
            <ConnectScreen
              vpn={vpn}
              onOpenCountries={() => setRoute('countries')}
              onOpenUpgrade={() => setRoute('upgrade')}
              onOpenEntry={() => setRoute('entry')}
              onOpenExit={() => setRoute('exit')}
              onOpenSettings={() => setRoute('settings')}
            />
          )}
        </View>
      </SafeAreaView>
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
