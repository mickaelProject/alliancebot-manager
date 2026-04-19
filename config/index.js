/**
 * Central configuration loaded from environment variables.
 * Validated at startup — see validateConfig().
 */

require('dotenv').config();

/**
 * Parse comma-separated numeric IDs (Discord snowflakes).
 * @param {string | undefined} raw
 * @returns {string[]}
 */
function parseIdList(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse reminder offsets in minutes (e.g. "5,10,15").
 * @param {string | undefined} raw
 * @param {number[]} fallback
 */
function parseReminderMinutes(raw, fallback) {
  if (!raw || !String(raw).trim()) return [...fallback];
  const parts = String(raw)
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n > 0);
  return parts.length ? [...new Set(parts)].sort((a, b) => b - a) : [...fallback];
}

/** Valeur par défaut de REMINDER_MINUTES si absent (minutes avant le début). */
const defaultReminders = [5];

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10) || 3000,
  discordToken: String(process.env.DISCORD_TOKEN || '').trim(),
  discordClientId: String(process.env.DISCORD_CLIENT_ID || '').trim(),
  discordClientSecret: String(process.env.DISCORD_CLIENT_SECRET || '').trim(),
  /** Public callback URL registered in Discord Developer Portal */
  oauthCallbackUrl: String(
    process.env.OAUTH_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback'
  ).trim(),
  sessionSecret: process.env.SESSION_SECRET || '',
  /** Dashboard access: Discord user IDs allowed after OAuth */
  dashboardAllowedUserIds: parseIdList(process.env.DASHBOARD_ALLOWED_USER_IDS),
  /**
   * Connexion de secours sans OAuth Discord (évite Cloudflare sur l’échange token depuis l’hébergeur).
   * Mot de passe fort (≥16 caractères) + voir DASHBOARD_PASSWORD_ACT_AS_USER_ID.
   */
  dashboardPassword: String(process.env.DASHBOARD_PASSWORD || '').trim(),
  /** ID Discord à utiliser en session (doit être dans DASHBOARD_ALLOWED_USER_IDS). Si vide et une seule ID autorisée, celle-ci est prise. */
  dashboardPasswordActAsUserId: String(process.env.DASHBOARD_PASSWORD_ACT_AS_USER_ID || '').trim(),
  /** Guildes visibles pour la session mot de passe (CSV). Si vide : DASHBOARD_GUILD_ID ou PLANNER_GUILD_ID. */
  dashboardPasswordGuildIds: parseIdList(process.env.DASHBOARD_PASSWORD_GUILD_IDS),
  /** If set, user must be in this guild and have one of dashboardAllowedRoleIds (checked with bot token) */
  dashboardGuildId:
    process.env.DASHBOARD_GUILD_ID?.trim() || process.env.PLANNER_GUILD_ID?.trim() || '',
  dashboardAllowedRoleIds: parseIdList(process.env.DASHBOARD_ALLOWED_ROLE_IDS),
  /** Slash commands: members with Administrator OR one of these role IDs can create/delete events */
  botManageRoleIds: parseIdList(process.env.BOT_MANAGE_ROLE_IDS),
  /**
   * Liste d’entiers (ex. « 10,5 ») : sert de **défaut** pour le délai de rappel des nouveaux événements
   * (on prend le minimum). Le scheduler envoie **un seul** rappel par événement, au délai stocké en base.
   */
  reminderMinutes: parseReminderMinutes(process.env.REMINDER_MINUTES, defaultReminders),
  /** SQLite file path (relative to project root) */
  databasePath: process.env.DATABASE_PATH || 'events.db',
  /** IANA timezone for cron tick alignment (see node-cron) */
  schedulerTimeZone: process.env.SCHEDULER_TIMEZONE || 'Etc/UTC',
  /** Salon Discord pour les événements créés depuis le planning (prioritaire sur default_channel en base). */
  plannerChannelId: process.env.PLANNER_CHANNEL_ID?.trim() || '',
  /** IDs autorisés à ouvrir l’admin planning (en plus de DASHBOARD_ALLOWED_USER_IDS si celui-ci est défini). */
  plannerAdminUserIds: parseIdList(process.env.PLANNER_ADMIN_USER_IDS),
  /**
   * URL publique de l’app (sans slash final). Permet à Discord de charger les icônes https sous /branding/…
   * Ex. https://plan.example.com — requis pour afficher le logo par défaut dans les rappels.
   */
  publicAppUrl: String(process.env.PUBLIC_APP_URL || '')
    .trim()
    .replace(/\/$/, ''),
  /** Nom affiché sur les rappels (auteur d’embed), ex. FireLegends. Sinon nom Discord / base. */
  plannerBrandingDisplayName: String(process.env.PLANNER_BRANDING_DISPLAY_NAME || '').trim(),
  /** URL https complète du logo (prioritaire sur le fichier /branding/firelegends-logo.png + PUBLIC_APP_URL). */
  plannerBrandingIconUrl: String(process.env.PLANNER_BRANDING_ICON_URL || '').trim(),
  /**
   * DeepL API key (gratuit : se termine par :fx). Si défini, les corps de rappel
   * personnalisés détectés comme français sont traduits en anglais à l’envoi Discord.
   */
  deeplAuthKey: String(process.env.DEEPL_AUTH_KEY || '').trim(),
};

/**
 * Délai par défaut pour les **nouveaux** événements (planning / API) quand aucun délai n’est précisé.
 * Dérivé du plus petit entier positif dans REMINDER_MINUTES, sinon 5.
 */
function defaultReminderOffsetMinutes() {
  const arr = config.reminderMinutes.filter((n) => Number.isFinite(n) && n > 0);
  return arr.length ? Math.min(...arr) : 5;
}

/**
 * Throws with a clear message if required production variables are missing.
 */
function validateConfig() {
  const errors = [];
  if (!config.discordToken) errors.push('DISCORD_TOKEN is required');
  if (!config.discordClientId) errors.push('DISCORD_CLIENT_ID is required for OAuth and slash command registration');
  if (!config.discordClientSecret) errors.push('DISCORD_CLIENT_SECRET is required for OAuth');
  if (!config.oauthCallbackUrl) errors.push('OAUTH_CALLBACK_URL is required');
  if (!config.sessionSecret || config.sessionSecret.length < 16) {
    errors.push('SESSION_SECRET is required and must be at least 16 characters');
  }
  const hasUserAllowlist = config.dashboardAllowedUserIds.length > 0;
  const hasRoleAllowlist =
    Boolean(config.dashboardGuildId) && config.dashboardAllowedRoleIds.length > 0;
  if (!hasUserAllowlist && !hasRoleAllowlist) {
    errors.push(
      'Set DASHBOARD_ALLOWED_USER_IDS and/or DASHBOARD_GUILD_ID + DASHBOARD_ALLOWED_ROLE_IDS (at least one access rule)'
    );
  }
  if (config.dashboardAllowedRoleIds.length && !config.dashboardGuildId) {
    errors.push(
      'DASHBOARD_GUILD_ID (ou PLANNER_GUILD_ID) est requis quand DASHBOARD_ALLOWED_ROLE_IDS est défini'
    );
  }
  if (errors.length) {
    const msg = `Configuration error:\n- ${errors.join('\n- ')}`;
    const err = new Error(msg);
    err.name = 'ConfigError';
    throw err;
  }
}

module.exports = { config, validateConfig, parseIdList, defaultReminderOffsetMinutes };
