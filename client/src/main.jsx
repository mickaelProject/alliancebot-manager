import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { I18nProvider } from './i18n/I18nProvider.jsx';

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </React.StrictMode>
  );
}
