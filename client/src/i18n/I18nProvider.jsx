import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { STRINGS, pickBrowserLocale } from './translations.js';

const I18nContext = createContext(null);

function interpolate(template, vars) {
  if (!vars || typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{${k}}`));
}

export function I18nProvider({ children }) {
  const [locale] = useState(pickBrowserLocale);
  const dateLocale = locale === 'fr' ? 'fr-FR' : 'en-US';

  const t = useCallback(
    (key, vars) => {
      const pack = STRINGS[locale] || STRINGS.fr;
      const fallback = STRINGS.fr;
      const raw = pack[key] ?? fallback[key] ?? key;
      return interpolate(raw, vars);
    },
    [locale]
  );

  const value = useMemo(() => ({ t, locale, dateLocale }), [t, locale, dateLocale]);

  useEffect(() => {
    document.documentElement.lang = locale === 'fr' ? 'fr' : 'en';
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}
