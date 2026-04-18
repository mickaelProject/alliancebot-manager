/**
 * Discord author icons must be https:// or attachment:// on the same message.
 */

const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const { config } = require('../config');

const LOGO_PATH = path.join(__dirname, '..', 'public', 'branding', 'firelegends-logo.png');
const LOGO_FILENAME = 'firelegends-logo.png';

/**
 * @param {string | null | undefined} preferredHttpsUrl from env / DB / PUBLIC_APP_URL
 * @returns {{ files: import('discord.js').AttachmentBuilder[]; iconUrl: string | null }}
 */
function filesAndAuthorIconUrl(preferredHttpsUrl) {
  const u = String(preferredHttpsUrl || '').trim();
  if (/^https:\/\//i.test(u)) {
    return { files: [], iconUrl: u };
  }
  if (fs.existsSync(LOGO_PATH)) {
    return {
      files: [new AttachmentBuilder(LOGO_PATH, { name: LOGO_FILENAME })],
      iconUrl: `attachment://${LOGO_FILENAME}`,
    };
  }
  return { files: [], iconUrl: null };
}

/**
 * For JSON previews (browser): https URL only, never attachment://
 * @param {string | null | undefined} preferredHttpsUrl
 * @returns {string | null}
 */
function publicLogoHttpsOrNull(preferredHttpsUrl) {
  const u = String(preferredHttpsUrl || '').trim();
  if (/^https:\/\//i.test(u)) return u;
  const base = String(config.publicAppUrl || '').trim().replace(/\/$/, '');
  if (base) return `${base}/branding/${LOGO_FILENAME}`;
  return null;
}

module.exports = { filesAndAuthorIconUrl, LOGO_FILENAME, publicLogoHttpsOrNull };
