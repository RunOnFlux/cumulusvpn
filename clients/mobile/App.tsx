/**
 * CumulusVPN mobile root.
 *
 * One product, three screens (docs/05 "one screen, one job: connect"):
 * Connect ⇄ CountryPicker and Connect ⇄ Upgrade. Navigation is a tiny local
 * state machine — no react-navigation dependency for a three-screen app keeps
 * the bundle lean and the typecheck clean.
 */
import { useState } from 'react';
import { ActivityIndicator, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useVpn } from './src/state/useVpn';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { CountryPickerScreen } from './src/screens/CountryPickerScreen';
import { UpgradeScreen } from './src/screens/UpgradeScreen';
import { color } from './src/theme/tokens';

type Route = 'connect' | 'countries' | 'upgrade' | 'entry' | 'exit';

function App(): React.JSX.Element {
  const vpn = useVpn();
  const [route, setRoute] = useState<Route>('connect');

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={color.sky1} />
      <View style={styles.screen}>
        {vpn.booting && vpn.countries.length === 0 ? (
          <View style={styles.boot}>
            <ActivityIndicator color={color.cyan} />
            <Text style={styles.bootText}>Connecting to the Flux network…</Text>
          </View>
        ) : route === 'countries' ? (
          <CountryPickerScreen
            countries={vpn.countries}
            selectedCode={vpn.selected?.code ?? null}
            onSelect={(code) => void vpn.selectCountry(code)}
            onClose={() => setRoute('connect')}
          />
        ) : route === 'entry' ? (
          <CountryPickerScreen
            countries={vpn.countries}
            selectedCode={vpn.entry?.code ?? null}
            onSelect={(code) => void vpn.selectEntryCountry(code)}
            onClose={() => setRoute('connect')}
          />
        ) : route === 'exit' ? (
          <CountryPickerScreen
            countries={vpn.countries}
            selectedCode={vpn.exit?.code ?? null}
            onSelect={(code) => void vpn.selectExitCountry(code)}
            onClose={() => setRoute('connect')}
          />
        ) : route === 'upgrade' ? (
          <UpgradeScreen
            tier={vpn.tier}
            payment={vpn.payment}
            onClose={() => setRoute('connect')}
          />
        ) : (
          <ConnectScreen
            vpn={vpn}
            onOpenCountries={() => setRoute('countries')}
            onOpenUpgrade={() => setRoute('upgrade')}
            onOpenEntry={() => setRoute('entry')}
            onOpenExit={() => setRoute('exit')}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // The phone "sky" background from the mockup. POC: a single solid stop; a
  // future react-native-linear-gradient pass renders the full 3-stop gradient.
  safe: { flex: 1, backgroundColor: color.sky1 },
  screen: { flex: 1, backgroundColor: color.sky2 },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  bootText: { color: color.inkDim, fontSize: 14 },
});

export default App;
