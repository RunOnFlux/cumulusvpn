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
import { loadOrCreateKeypair, regenerateKeypair, saveKeypair } from './lib/keypair';
import { markRecoveryKeySaved, codeOf } from './lib/recoveryKey';
import { clearIssuedConfig } from './lib/issuedConfig';

export function App() {
  const [themeMode, toggleTheme] = useTheme();
  const [route, navigate, routeParams] = useRoute();
  const { locale } = useI18n();
  const discovery = useDiscovery(locale);
  const [keypair, setKeypair] = useState<Keypair>(() => loadOrCreateKeypair());
  const [restored, setRestored] = useState(false);

  const onRegenerate = (): void => {
    // A new keypair voids every config ever issued against the old one, so the
    // staleness record must go with it — otherwise the next visit would check a
    // gateway that is fine and report all-clear on a config that is already dead.
    clearIssuedConfig();
    setRestored(false);
    setKeypair(regenerateKeypair());
  };

  const onRestore = (next: Keypair): void => {
    // Same reasoning as a new key: configs issued to the old one are not ours.
    clearIssuedConfig();
    saveKeypair(next);
    // Restoring proves the user holds this key, so don't nag them to save it.
    markRecoveryKeySaved(codeOf(next));
    setRestored(true);
    setKeypair(next);
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
          params={routeParams}
          onNavigateConnect={() => navigate('connect')}
        />
      ) : (
        <ConnectPage
          // A different identity starts from a clean page: a config, a
          // multi-hop pair or a staleness check on screen belongs to the OLD key.
          key={keypair.publicKey}
          keypair={keypair}
          discovery={discovery}
          identityRestored={restored}
          onRegenerate={onRegenerate}
          onRestore={onRestore}
          onNavigateUpgrade={() => navigate('upgrade')}
        />
      )}
      <Footer />
    </>
  );
}
