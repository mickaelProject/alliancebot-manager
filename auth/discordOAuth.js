/**
 * Discord OAuth2 (authorization code) for dashboard login.
 * Scopes: identify + guilds (to scope dashboard data to alliances the user belongs to).
 */

const crypto = require('crypto');
const { config } = require('../config');
const { createLogger } = require('../lib/logger');

const log = createLogger('auth');

const DISCORD_API = 'https://discord.com/api/v10';
/** URLs OAuth2 documentées (sans /v10/ pour authorize + token) — évite des chemins non canoniques côté Cloudflare. */
const DISCORD_OAUTH_AUTHORIZE = 'https://discord.com/oauth2/authorize';
const DISCORD_OAUTH_TOKEN = 'https://discord.com/api/oauth2/token';
/** Secours si Cloudflare bloque un chemin (comportement par région / IP). */
const DISCORD_OAUTH_TOKEN_V10 = `${DISCORD_API}/oauth2/token`;

/** Voir https://discord.com/developers/docs/reference#user-agent — requis pour éviter blocages Cloudflare sur les appels serveur. */
function getDiscordUserAgent() {
  const fromPublic = String(config.publicAppUrl || '')
    .trim()
    .replace(/\/$/, '');
  let fromCallback = '';
  try {
    if (config.oauthCallbackUrl) fromCallback = new URL(config.oauthCallbackUrl).origin;
  } catch {
    /* ignore */
  }
  const url = fromPublic || fromCallback || 'https://github.com/mickaelProject/alliancebot-manager';
  return `AllianceBotManager/3.0 (+${url})`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  return `${DISCORD_OAUTH_AUTHORIZE}?${params.toString()}`;
}

/**
 * @param {string} code
 */
/**
 * @param {string} tokenUrl
 * @param {string} bodyStr
 * @param {Record<string, string>} headers
 */
async function postTokenExchange(tokenUrl, bodyStr, headers) {
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers,
    body: bodyStr,
  });
  const text = await res.text();
  return { res, text };
}

async function exchangeCode(code) {
  const params = new URLSearchParams({
    client_id: config.discordClientId,
    client_secret: config.discordClientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.oauthCallbackUrl,
  });
  const bodyStr = params.toString();
  const baseHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'User-Agent': getDiscordUserAgent(),
    Connection: 'close',
  };
  const tokenUrls = [DISCORD_OAUTH_TOKEN, DISCORD_OAUTH_TOKEN_V10];
  const maxAttemptsPerUrl = 5;
  let lastStatus = 0;
  let lastSnippet = '';

  for (const tokenUrl of tokenUrls) {
    for (let attempt = 1; attempt <= maxAttemptsPerUrl; attempt++) {
      const { res, text } = await postTokenExchange(tokenUrl, bodyStr, baseHeaders);
      lastStatus = res.status;
      lastSnippet = text.slice(0, 200);

      if (res.ok) {
        try {
          return JSON.parse(text);
        } catch (e) {
          log.error('oauth_token_json_parse_failed', { message: e.message, tokenUrl });
          throw new Error('Token exchange: invalid JSON response');
        }
      }

      let discordErr = '';
      try {
        discordErr = String(JSON.parse(text).error || '');
      } catch {
        /* ignore */
      }

      const cloudflareBlock =
        res.status === 429 ||
        res.status === 403 ||
        /cloudflare|cf-ray|Access denied/i.test(text);

      if (cloudflareBlock && attempt < maxAttemptsPerUrl) {
        const ra = res.headers.get('retry-after');
        const parsed = parseInt(String(ra || ''), 10);
        const fallbackWait = Math.min(45, 5 + attempt * 5);
        const waitSec =
          Number.isFinite(parsed) && parsed > 0 ? Math.min(90, parsed) : fallbackWait;
        log.warn('oauth_token_exchange_rate_limited', {
          tokenUrl,
          attempt,
          waitSec,
          retryAfter: ra,
          status: res.status,
        });
        await sleep(waitSec * 1000);
        continue;
      }

      if (cloudflareBlock && tokenUrl === DISCORD_OAUTH_TOKEN) {
        log.warn('oauth_token_try_alternate_url', { from: tokenUrl, to: DISCORD_OAUTH_TOKEN_V10 });
        break;
      }

      log.error('oauth_token_exchange_failed', {
        status: res.status,
        tokenUrl,
        body: text.slice(0, 800),
      });
      throw new Error(`Token exchange failed: ${res.status} ${discordErr || text.slice(0, 200)}`);
    }
  }

  throw new Error(
    `Token exchange failed after retries (last ${lastStatus} ${lastSnippet.slice(0, 120)})`
  );
}

/**
 * @param {string} accessToken
 */
async function fetchDiscordUser(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': getDiscordUserAgent(),
    },
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
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': getDiscordUserAgent(),
    },
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
    headers: {
      Authorization: `Bot ${config.discordToken}`,
      Accept: 'application/json',
      'User-Agent': getDiscordUserAgent(),
    },
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
    const t0 = Date.now();
    log.info('auth_callback_received', { queryKeys: Object.keys(req.query || {}) });
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
      log.info('auth_token_exchanged', { ms: Date.now() - t0 });
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
      await new Promise((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });
      return res.redirect('/');
    } catch (err) {
      log.error('auth_callback_error', { message: err.message, stack: err.stack?.slice(0, 600) });
      const msg = String(err.message || '');
      let fr =
        '<p><strong>Connexion impossible</strong> — une erreur technique s’est produite après le retour Discord.</p>';
      if (msg.includes('invalid_client') || msg.includes('401')) {
        fr +=
          '<p>Vérifiez sur Render les variables <code>DISCORD_CLIENT_ID</code> et surtout <code>DISCORD_CLIENT_SECRET</code> : ce doit être le <strong>« Client Secret » OAuth2</strong> de l’application Discord (onglet OAuth2), <strong>pas</strong> le token du bot (<code>DISCORD_TOKEN</code>).</p>';
      } else if (msg.includes('invalid_grant')) {
        fr +=
          '<p>Souvent : <code>OAUTH_CALLBACK_URL</code> ne correspond pas exactement à une redirection enregistrée (même https, même chemin, sans espace en trop), ou vous avez <strong>rafraîchi</strong> la page du callback (le <code>code</code> ne fonctionne qu’une fois). Recommencez depuis <a href="/login">/login</a>.</p>';
      } else if (msg.includes('429')) {
        fr +=
          '<p>Discord a répondu <strong>429</strong> (limitation / protection Cloudflare). Ce n’est en général <strong>pas</strong> une erreur de secret OAuth : réessayez dans quelques minutes. Le serveur envoie désormais un <code>User-Agent</code> conforme et réessaie automatiquement en cas de 429.</p>';
      } else if (msg.includes('Token exchange failed')) {
        fr +=
          '<p>Discord a refusé l’échange du code. Vérifiez <code>OAUTH_CALLBACK_URL</code> (identique au portail) et les identifiants OAuth2. Consultez les logs Render pour la ligne <code>oauth_token_exchange_failed</code>.</p>';
      } else if (msg.includes('users/@me')) {
        fr += '<p>Impossible de lire le profil Discord après l’échange du token. Vérifiez les scopes et les logs serveur.</p>';
      }
      fr +=
        '<p style="margin-top:1rem"><a href="/login">Retour à la page de connexion</a></p>';
      return res.status(500).type('html').send(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Connexion</title></head><body style="font-family:system-ui;max-width:42rem;margin:2rem auto;line-height:1.5">${fr}</body></html>`);
    }
  });
}

module.exports = { mountDiscordOAuth, getAuthorizeUrl };
