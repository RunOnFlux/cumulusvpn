import { useState } from 'react';
import type { Keypair } from '@cumulusvpn/core';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ConnectPage } from './pages/ConnectPage';
import { UpgradePage } from './pages/UpgradePage';
import { useRoute } from './hooks/useRoute';
import { useTheme } from './hooks/useTheme';
import { useDiscovery } from './hooks/useDiscovery';
import { loadOrCreateKeypair, regenerateKeypair } from './lib/keypair';

export function App() {
  const [themeMode, toggleTheme] = useTheme();
  const [route, navigate] = useRoute();
  const discovery = useDiscovery();
  const [keypair, setKeypair] = useState<Keypair>(() => loadOrCreateKeypair());

  const onRegenerate = (): void => setKeypair(regenerateKeypair());

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
