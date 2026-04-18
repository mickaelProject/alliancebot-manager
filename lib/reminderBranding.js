/**
 * Display name + author icon URL for Discord reminder embeds.
 */

const { config } = require('../config');

/** Path under public/ — full URL = publicAppUrl + this path (Discord requires https). */
const DEFAULT_BRANDING_PATH = '/branding/firelegends-logo.png';

function isHttpsUrl(s) {
  return /^https:\/\//i.test(String(s || '').trim());
}

/**
 * @param {{ name?: string; branding_icon_url?: string }} settings from getGuildSettings
 * @param {string} discordGuildName from Discord.js channel.guild.name (or fallback)
 * @returns {{ displayName: string; iconUrl: string | null }}
 */
function resolveReminderBranding(settings, discordGuildName) {
  const discordName = String(discordGuildName || '').trim() || 'Guild';
  const displayName =
    String(config.plannerBrandingDisplayName || '').trim() ||
    String(settings?.name || '').trim() ||
    discordName;

  let iconUrl =
    (settings?.branding_icon_url && isHttpsUrl(settings.branding_icon_url)
      ? String(settings.branding_icon_url).trim()
      : '') ||
    (config.plannerBrandingIconUrl && isHttpsUrl(config.plannerBrandingIconUrl)
      ? String(config.plannerBrandingIconUrl).trim()
      : '');

  if (!iconUrl && config.publicAppUrl) {
    iconUrl = `${config.publicAppUrl}${DEFAULT_BRANDING_PATH}`;
  }

  return { displayName, iconUrl: iconUrl && isHttpsUrl(iconUrl) ? iconUrl : null };
}

module.exports = { resolveReminderBranding, DEFAULT_BRANDING_PATH };
