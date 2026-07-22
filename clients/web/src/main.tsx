import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LocaleProvider } from './hooks/useLocale';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('CumulusVPN: #root element not found');
}

createRoot(container).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
