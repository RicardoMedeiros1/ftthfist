import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './theme/theme.css';
import { initTheme } from './theme/theme';

// O tema vale antes da primeira tela aparecer (o app abre já com as cores certas).
initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
