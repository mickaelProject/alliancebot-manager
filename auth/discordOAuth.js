/**
 * Discord OAuth2 (authorization code) for dashboard login.
 * Scopes: identify + guilds (to scope dashboard data to alliances the user belongs to).
 */

const crypto = require('crypto');
const { config } = require('../config');
const { createLogger } = require('../lib/logger');

const log = createLogger('auth');

const DISCORD_API = 'https://discord.com/api/v10';

/**
 * @param {import('express').Request} req
 */
function ensureOAuthState(req) {
  if (!req.session.oauthState) {
    req.session.oauthState = crypto.randomBytes(16).toString('hex');
  }
  return req.session.oauthState;
}

/**
 * @param {import('express').Request} req
 */
function getAuthorizeUrl(req) {
  const state = ensureOAuthState(req);
  const params = new URLSearchParams({
    client_id: config.discordClientId,
    redirect_uri: config.oauthCallbackUrl,
    response_type: 'code',
    scope: 'identify guilds',
    state,
    prompt: 'consent',
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

/**
 * @param {string} code
 */
async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: config.discordClientId,
    client_secret: config.discordClientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.oauthCallbackUrl,
  });
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * @param {string} accessToken
 */
async function fetchDiscordUser(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`users/@me failed: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * @param {string} accessToken
 */
/**
 * Extrait les snowflakes depuis le corps brut JSON : évite la perte de précision
 * si Discord renvoie `"id": 102358910387159041` (nombre > Number.MAX_SAFE_INTEGER).
 */
function extractGuildSnowflakesFromJsonText(text) {
  const ids = new Set();
  const re = /"id"\s*:\s*"(\d{17,20})"|"id"\s*:\s*(\d{17,20})(?=\s*[,\}])/g;
  let m;
  while ((m = re.exec(text))) {
    ids.add(m[1] || m[2]);
  }
  return [...ids];
}

async function fetchUserGuilds(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`users/@me/guilds failed: ${res.status} ${text}`);
  }
  const fromText = extractGuildSnowflakesFromJsonText(text);
  if (fromText.length) return fromText;
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) return [];
    return data.map((g) => String(g.id)).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * @param {string} userId
 */
async function fetchGuildMember(userId) {
  const guildId = config.dashboardGuildId;
  if (!guildId) return null;
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${config.discordToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    log.warn('guild_member_fetch_failed', { status: res.status, body: text.slice(0, 200) });
    return null;
  }
  return res.json();
}

/**
 * @param {string} userId
 * @param {string[]} roleIdsFromMember
 */
function isUserAllowed(userId, roleIdsFromMember) {
  if (config.dashboardAllowedUserIds.includes(userId)) {
    return true;
  }
  if (config.dashboardGuildId && config.dashboardAllowedRoleIds.length) {
    const ok = config.dashboardAllowedRoleIds.some((rid) => roleIdsFromMember.includes(rid));
    if (!ok) log.info('auth_role_denied', { userId });
    return ok;
  }
  return false;
}

/**
 * @param {import('express').Application} app
 */
function mountDiscordOAuth(app) {
  app.get('/auth/discord', (req, res) => {
    try {
      res.redirect(getAuthorizeUrl(req));
    } catch (err) {
      log.error('auth_redirect_failed', { message: err.message });
      res.status(500).send('OAuth configuration error');
    }
  });

  app.get('/auth/discord/callback', async (req, res) => {
    try {
      const { code, state } = req.query;
      if (!code || typeof code !== 'string') {
        return res.status(400).send('Missing code');
      }
      if (!state || state !== req.session.oauthState) {
        log.warn('auth_state_mismatch', {});
        return res.status(400).send('Invalid state — try signing in again');
      }
      req.session.oauthState = null;

      const tokenJson = await exchangeCode(code);
      const accessToken = tokenJson.access_token;
      const user = await fetchDiscordUser(accessToken);
      const userId = String(user.id);

      let roleIds = [];
      if (config.dashboardGuildId && config.dashboardAllowedRoleIds.length) {
        const member = await fetchGuildMember(userId);
        if (!member) {
          log.info('auth_member_not_in_guild', { userId });
          return res.status(403).send('You must be in the configured Discord server to use this dashboard.');
        }
        roleIds = Array.isArray(member.roles) ? member.roles.map(String) : [];
      }

      if (!isUserAllowed(userId, roleIds)) {
        log.info('auth_user_denied', { userId });
        return res.status(403).send('Your Discord account is not authorized for this dashboard.');
      }

      let guildIds = [];
      try {
        guildIds = await fetchUserGuilds(accessToken);
      } catch (e) {
        log.warn('guild_list_failed', { message: e.message });
      }

      req.session.discordUser = {
        id: userId,
        username: user.username,
        discriminator: user.discriminator,
        avatar: user.avatar,
      };
      req.session.guildIds = guildIds;
      req.session.authenticated = true;
      log.info('auth_login_ok', { userId, guildCount: guildIds.length });
      return res.redirect('/');
    } catch (err) {
      log.error('auth_callback_error', { message: err.message });
      return res.status(500).send('Login failed');
    }
  });
}

module.exports = { mountDiscordOAuth, getAuthorizeUrl };
