import { useState } from 'react';
import type { Keypair } from '@cumulusvpn/core';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ConnectPage } from './pages/ConnectPage';
import { UpgradePage } from './pages/UpgradePage';
import { useRoute } from './hooks/useRoute';
import { useTheme } from './hooks/useTheme';
import { useI18n } from './hooks/useLocale';
import { useDiscovery } from './hooks/useDiscovery';
import { loadOrCreateKeypair, regenerateKeypair } from './lib/keypair';
import { clearIssuedConfig } from './lib/issuedConfig';

export function App() {
  const [themeMode, toggleTheme] = useTheme();
  const [route, navigate] = useRoute();
  const { locale } = useI18n();
  const discovery = useDiscovery(locale);
  const [keypair, setKeypair] = useState<Keypair>(() => loadOrCreateKeypair());

  const onRegenerate = (): void => {
    // A new keypair voids every config ever issued against the old one, so the
    // staleness record must go with it — otherwise the next visit would check a
    // gateway that is fine and report all-clear on a config that is already dead.
    clearIssuedConfig();
    setKeypair(regenerateKeypair());
  };

  return (
    <>
      <Header
        route={route}
        onNavigate={navigate}
        themeMode={themeMode}
        onToggleTheme={toggleTheme}
      />
      {route === 'upgrade' ? (
        <UpgradePage
          keypair={keypair}
          directory={discovery.directory}
          onNavigateConnect={() => navigate('connect')}
        />
      ) : (
        <ConnectPage
          keypair={keypair}
          discovery={discovery}
          onRegenerate={onRegenerate}
          onNavigateUpgrade={() => navigate('upgrade')}
        />
      )}
      <Footer />
    </>
  );
}
