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
import { color } from './src/theme/tokens';

type Route = 'connect' | 'countries' | 'upgrade' | 'entry' | 'exit' | 'settings';

function App(): React.JSX.Element {
  const vpn = useVpn();
  const flags = useFlags();
  const [route, setRoute] = useState<Route>('connect');

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
          {vpn.booting && vpn.countries.length === 0 ? (
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
              countries={vpn.locations}
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
              payment={vpn.payment}
              inAppUpgrade={flags.inAppUpgrade}
              onClose={() => setRoute('connect')}
            />
          ) : route === 'settings' ? (
            <SettingsScreen vpn={vpn} onClose={() => setRoute('connect')} />
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
  safe: { flex: 1, backgroundColor: color.sky1 },
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
