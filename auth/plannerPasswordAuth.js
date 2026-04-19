/**
 * Connexion planning par mot de passe (secours) — aucun appel OAuth token à Discord.
 * Utile quand l’hébergeur est limité / bloqué par Cloudflare sur POST /oauth2/token.
 */

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { config } = require('../config');
const { createLogger } = require('../lib/logger');
const { ensureCsrfToken } = require('../server/sessionToken');
const { getDiscordUserAgent } = require('./discordOAuth');

const log = createLogger('auth');

const DISCORD_API = 'https://discord.com/api/v10';

/**
 * Récupère pseudo / avatar Discord via le **token du bot** (même app que les rappels) — pas d’OAuth utilisateur.
 * @param {string} guildId
 * @param {string} userId
 */
async function fetchDiscordUserViaBot(guildId, userId) {
  if (!config.discordToken || !guildId || !userId) return null;
  try {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
      headers: {
        Authorization: `Bot ${config.discordToken}`,
        Accept: 'application/json',
        'User-Agent': getDiscordUserAgent(),
        Connection: 'close',
      },
    });
    if (!res.ok) {
      log.warn('planner_password_member_fetch', { status: res.status, guildId, userId });
      return null;
    }
    const m = await res.json();
    const u = m.user || {};
    return {
      id: String(u.id || userId),
      username: String(u.username || 'Planning'),
      discriminator: String(u.discriminator ?? '0'),
      avatar: u.avatar != null ? String(u.avatar) : null,
    };
  } catch (e) {
    log.warn('planner_password_member_fetch_err', { message: e.message });
    return null;
  }
}

const postPwLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
});

function constantTimePasswordOk(attempt, expected) {
  const a = crypto.createHash('sha256').update(String(attempt), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(expected), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

function guildIdsForPasswordLogin() {
  if (config.dashboardPasswordGuildIds.length) {
    return config.dashboardPasswordGuildIds.map(String);
  }
  const g = String(config.dashboardGuildId || '').trim();
  return g ? [g] : [];
}

/**
 * @param {import('express').Application} app
 */
function mountPlannerPasswordAuth(app) {
  app.post('/auth/planner-password', postPwLimit, async (req, res) => {
    if (!config.dashboardPassword || config.dashboardPassword.length < 16) {
      return res.status(404).send('Not found');
    }

    ensureCsrfToken(req);
    const token = String(req.body._csrf || req.header('x-csrf-token') || '');
    if (!token || token !== req.session.csrfToken) {
      log.warn('planner_password_csrf_fail', { ip: req.ip });
      return res.status(403).type('html').send('Jeton CSRF invalide — rechargez la page /login.');
    }

    const pw = String(req.body.password ?? '');
    if (!constantTimePasswordOk(pw, config.dashboardPassword)) {
      log.warn('planner_password_denied', { ip: req.ip });
      return res.redirect('/login?pwd=0');
    }

    let actAs = String(config.dashboardPasswordActAsUserId || '').trim();
    if (!actAs) {
      const list = config.dashboardAllowedUserIds;
      if (list.length === 1) actAs = String(list[0]);
    }
    if (!actAs || !config.dashboardAllowedUserIds.includes(actAs)) {
      log.error('planner_password_act_as_invalid', { actAs: actAs || null });
      return res.status(500).type('html').send(
        `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Configuration</title></head><body style="font-family:system-ui;max-width:36rem;margin:2rem">
        <p>Définissez <code>DASHBOARD_PASSWORD_ACT_AS_USER_ID</code> sur un identifiant présent dans <code>DASHBOARD_ALLOWED_USER_IDS</code>, ou ne laissez qu’<strong>une seule</strong> ID autorisée.</p>
        <p><a href="/login">Retour</a></p></body></html>`
      );
    }

    const guildIds = guildIdsForPasswordLogin();
    if (!guildIds.length) {
      return res.status(500).type('html').send(
        `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Configuration</title></head><body style="font-family:system-ui;max-width:36rem;margin:2rem">
        <p>Définissez <code>DASHBOARD_PASSWORD_GUILD_IDS</code> (CSV) ou <code>DASHBOARD_GUILD_ID</code> / <code>PLANNER_GUILD_ID</code> pour au moins une guilde.</p>
        <p><a href="/login">Retour</a></p></body></html>`
      );
    }

    let discordUser = {
      id: actAs,
      username: 'Planning',
      discriminator: '0',
      avatar: null,
    };
    const primaryGuild = guildIds[0];
    const viaBot = await fetchDiscordUserViaBot(primaryGuild, actAs);
    if (viaBot) {
      discordUser = viaBot;
      log.info('auth_planner_password_profile_enriched', { userId: actAs, guildId: primaryGuild });
    } else {
      log.info('auth_planner_password_profile_fallback', {
        userId: actAs,
        hint: 'Vérifiez que le bot est dans la guilde et a le intent membres si besoin.',
      });
    }

    req.session.discordUser = discordUser;
    req.session.guildIds = guildIds;
    req.session.authenticated = true;
    req.session.oauthState = null;

    log.info('auth_planner_password_ok', { userId: actAs, guildCount: guildIds.length });

    req.session.save((err) => {
      if (err) {
        log.error('planner_password_session_save', { message: err.message });
        return res.status(500).send('Session error');
      }
      return res.redirect('/');
    });
  });
}

module.exports = { mountPlannerPasswordAuth };
