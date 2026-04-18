/**
 * If a custom reminder body looks French, translate it to English for Discord
 * (DeepL). Requires DEEPL_AUTH_KEY on the server. Default English templates are
 * left unchanged.
 */

const { config } = require('../config');
const { createLogger } = require('./logger');

const log = createLogger('reminder-body-translate');

/** @type {Promise<typeof import('franc-min')> | null} */
let francModulePromise = null;

function loadFranc() {
  if (!francModulePromise) francModulePromise = import('franc-min');
  return francModulePromise;
}

/**
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function isFrenchForTranslation(text) {
  const t = String(text || '').trim();
  if (t.length < 8) return false;
  const { franc } = await loadFranc();
  const code = franc(t, { minLength: 10 });
  if (code === 'fra' || code === 'frm') return true;
  if (code === 'eng') return false;
  if (/[àâäéèêëïîôùûüÿçœæ]/i.test(t) && /\b(rappel|événement|minutes|dans|pour|sera|commence|début)\b/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * @param {string} text
 * @param {string} authKey
 * @returns {Promise<string>}
 */
async function deeplTranslateFrToEn(text, authKey) {
  const key = String(authKey || '').trim();
  if (!key) throw new Error('missing auth key');
  const useFree = key.endsWith(':fx');
  const url = useFree ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
  const body = new URLSearchParams();
  body.set('auth_key', key);
  body.set('text', text);
  body.set('source_lang', 'FR');
  body.set('target_lang', 'EN');
  body.set('preserve_formatting', '1');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`DeepL HTTP ${res.status}: ${errText.slice(0, 240)}`);
  }
  /** @type {{ translations?: Array<{ text?: string }> }} */
  const data = await res.json();
  const out = data.translations && data.translations[0] && data.translations[0].text;
  if (typeof out !== 'string') throw new Error('DeepL response missing translations[0].text');
  return out.slice(0, 4096);
}

let warnedMissingKey = false;

/**
 * @param {string} description formatted embed body (after placeholders)
 * @param {boolean} usedCustomTemplate true if guild/event template was non-empty
 * @returns {Promise<string>}
 */
async function finalizeDiscordReminderBody(description, usedCustomTemplate) {
  const text = String(description ?? '');
  if (!usedCustomTemplate || !text.trim()) return text;

  let french;
  try {
    french = await isFrenchForTranslation(text);
  } catch (e) {
    log.warn('reminder_body_lang_detect_failed', { message: e.message });
    return text;
  }
  if (!french) return text;

  const key = config.deeplAuthKey;
  if (!key) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      log.warn('reminder_body_french_no_deepl', {
        note: 'French-like reminder body detected; set DEEPL_AUTH_KEY to translate to English for Discord.',
      });
    }
    return text;
  }

  try {
    const translated = await deeplTranslateFrToEn(text, key);
    log.info('reminder_body_translated_fr_en', { length: translated.length });
    return translated;
  } catch (e) {
    log.warn('reminder_body_deepl_failed', { message: e.message });
    return text;
  }
}

module.exports = { finalizeDiscordReminderBody, isFrenchForTranslation };
