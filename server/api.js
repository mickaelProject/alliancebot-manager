/**
 * API REST /api — clé API (intégrations) OU session navigateur (SPA) + guild_id + CSRF.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');
const {
  resolveGuildByApiKey,
  getEventsByGuild,
  getEventById,
  addEvent,
  deleteEvent,
  updateEvent,
  getGuildSettings,
  listPlannerEditors,
  addPlannerEditor,
  removePlannerEditor,
} = require('../database');
const { createLogger } = require('../lib/logger');
const { discordAvatarUrl } = require('../lib/discordAvatar');
const { sendPlannerTestDiscordMessage } = require('../lib/plannerTestDiscordMessage');
const { buildReminderEmbed } = require('../lib/eventEmbeds');
const { formatReminderBodyFromTemplate } = require('../lib/reminderBodyTemplate');
const { finalizeDiscordReminderBody } = require('../lib/reminderBodyDiscordTranslate');
const { resolveReminderBranding } = require('../lib/reminderBranding');
const { resolvePlannerEditorProfiles } = require('../lib/plannerEditorProfiles');
const { config } = require('../config');
const { ensureCsrfToken } = require('./sessionToken');

const log = createLogger('api');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 400,
  standardHeaders: true,
  legacyHeaders: false,
});

const router = express.Router();
router.use(limiter);

/**
 * @param {import('express').Request} req
 */
function getSessionGuildIds(req) {
  const ids = req.session && req.session.guildIds;
  if (!Array.isArray(ids)) return [];
  return ids.map(String);
}

function canonGuildId(id) {
  return String(id ?? '').trim();
}

function sessionGuildAllowed(sessionGuilds, guildId) {
  const g = canonGuildId(guildId);
  return sessionGuilds.some((id) => canonGuildId(id) === g);
}

function isPlannerAdminUser(userId) {
  const u = String(userId || '');
  if (!u) return false;
  if (config.plannerAdminUserIds.length && config.plannerAdminUserIds.includes(u)) return true;
  if (config.dashboardAllowedUserIds.length && config.dashboardAllowedUserIds.includes(u)) return true;
  return false;
}

async function sessionCanMutatePlannerEvents(req) {
  if (req.authMode !== 'session') return true;
  const uid = String(req.session.discordUser.id);
  if (isPlannerAdminUser(uid)) return true;
  const editors = await listPlannerEditors(req.guildId);
  if (!editors.length) return true;
  return editors.includes(uid);
}

async function plannerEditorsPayload(guildId, userIds) {
  let editors;
  try {
    editors = await resolvePlannerEditorProfiles(guildId, userIds);
  } catch (err) {
    log.warn('planner_editors_resolve_failed', { message: err.message });
    editors = userIds.map((userId) => ({
      userId,
      username: null,
      globalName: null,
      displayName: null,
      avatarUrl: discordAvatarUrl({ id: userId, avatar: null }),
    }));
  }
  return { userIds, editors };
}

async function requirePlannerAdminSession(req, res) {
  if (req.authMode !== 'session') {
    res.status(403).json({ error: 'Admin planning : session navigateur requise' });
    return false;
  }
  if (!isPlannerAdminUser(req.session.discordUser.id)) {
    res.status(403).json({ error: 'Accès administrateur refusé' });
    return false;
  }
  return true;
}

/**
 * Authentification : x-api-key OU session + guild_id (+ CSRF pour mutations session).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function resolveGuildContext(req, res, next) {
  const key =
    req.header('x-api-key') || (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
  if (key && key.length >= 16) {
    const gid = await resolveGuildByApiKey(key);
    if (gid) {
      req.guildId = gid;
      req.authMode = 'api_key';
      return next();
    }
  }

  if (!req.session || !req.session.authenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sessionGuilds = getSessionGuildIds(req);
  let guildId = String(
    req.query.guild_id || (req.body && req.body.guild_id) || req.header('x-guild-id') || ''
  ).trim();
  if (!guildId && sessionGuilds.length) {
    guildId = canonGuildId(sessionGuilds[0]);
  }
  if (!guildId) {
    return res.status(400).json({ error: 'guild_id is required (no guild in OAuth session)' });
  }
  if (!sessionGuildAllowed(sessionGuilds, guildId)) {
    return res.status(403).json({ error: 'Guild not allowed for this session' });
  }

  if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PATCH' || req.method === 'PUT') {
    const hdr = String(req.header('x-csrf-token') || '');
    ensureCsrfToken(req);
    if (!hdr || hdr !== req.session.csrfToken) {
      log.warn('api_csrf_rejected', { path: req.path });
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
  }

  req.guildId = canonGuildId(guildId);
  req.authMode = 'session';
  return next();
}

router.get('/bootstrap', async (req, res) => {
  try {
    if (!req.session || !req.session.authenticated) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    ensureCsrfToken(req);
    const guildIds = getSessionGuildIds(req);
    const effectiveId = guildIds[0] ? canonGuildId(guildIds[0]) : '';
    let guild = null;
    let effectiveChannelId = '';
    if (effectiveId) {
      const s = await getGuildSettings(effectiveId);
      guild = {
        id: effectiveId,
        name: s.name || effectiveId,
        themeColor: s.theme_color,
        defaultChannelId: s.default_channel_id || '',
      };
      const plannerCh = String(config.plannerChannelId || '').trim();
      effectiveChannelId = plannerCh || guild.defaultChannelId || '';
    }
    const rawUser = req.session.discordUser || null;
    const user = rawUser
      ? {
          id: rawUser.id,
          username: rawUser.username,
          discriminator: rawUser.discriminator,
          avatar: rawUser.avatar,
          avatarUrl: discordAvatarUrl(rawUser),
        }
      : null;
    const plannerAdmin = Boolean(user && isPlannerAdminUser(user.id));
    return res.json({
      csrfToken: req.session.csrfToken,
      guild,
      effectiveChannelId,
      guildIds,
      plannerAdmin,
      user,
    });
  } catch (err) {
    log.error('bootstrap_failed', { message: err.message });
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/csrf', async (req, res) => {
  if (!req.session || !req.session.authenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  ensureCsrfToken(req);
  return res.json({ csrfToken: req.session.csrfToken });
});

router.use(resolveGuildContext);

router.get('/admin/planner-editors', async (req, res) => {
  if (!(await requirePlannerAdminSession(req, res))) return;
  try {
    const userIds = await listPlannerEditors(req.guildId);
    const payload = await plannerEditorsPayload(req.guildId, userIds);
    return res.json(payload);
  } catch (err) {
    log.error('admin_list_editors_failed', { message: err.message });
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/admin/event-reminder-preview', async (req, res) => {
  if (!(await requirePlannerAdminSession(req, res))) return;
  try {
    const settings = await getGuildSettings(req.guildId);
    /** Aperçu : délai le plus proche du début (min), cohérent avec le texte « starts in N minutes ». */
    const offsetMinutes =
      config.reminderMinutes.length > 0 ? Math.min(...config.reminderMinutes) : 5;

    let title = 'Sample: TRI-ALLIANCE CLASH — LEGION 1';
    let bodyTemplate = '';
    const rawEv = req.query.event_id;
    if (rawEv != null && String(rawEv).trim() !== '') {
      const eventId = parseInt(String(rawEv), 10);
      if (Number.isNaN(eventId) || eventId < 1) {
        return res.status(400).json({ error: 'event_id invalide' });
      }
      const ev = await getEventById(eventId);
      if (!ev || ev.guild_id !== req.guildId) {
        return res.status(404).json({ error: 'Événement introuvable.' });
      }
      title = ev.title;
      const evTpl = String(ev.reminder_body_template ?? '').trim();
      bodyTemplate = evTpl || String(settings.reminder_body_template ?? '').trim();
    }

    const guildLabel = settings.name || 'Guild';
    const { displayName } = resolveReminderBranding(settings, guildLabel);
    const usedCustom = Boolean(String(bodyTemplate || '').trim());
    const rawDescription = formatReminderBodyFromTemplate(bodyTemplate, title, offsetMinutes);
    const description = await finalizeDiscordReminderBody(rawDescription, usedCustom);
    const embed = buildReminderEmbed({
      title,
      displayName,
      iconUrl: null,
      themeColor: Number(settings.theme_color) || 0x5865f2,
      offsetMinutes,
      description,
    });
    const reminderText = description;
    return res.json({
      offsetMinutes,
      reminderMinutes: config.reminderMinutes,
      reminderText,
      /** @deprecated use reminderText — kept for older web bundles */
      content: reminderText,
      embed: embed.toJSON(),
      buttonLabels: [],
    });
  } catch (err) {
    log.error('admin_reminder_preview_failed', { message: err.message, stack: err?.stack });
    return res.status(500).json({
      error: err?.message || 'Impossible de générer l’aperçu du rappel.',
    });
  }
});

router.post(
  '/admin/planner-editors',
  body('user_id').trim().matches(/^\d{17,21}$/),
  async (req, res) => {
    if (!(await requirePlannerAdminSession(req, res))) return;
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      await addPlannerEditor(req.guildId, String(req.body.user_id).trim());
      const userIds = await listPlannerEditors(req.guildId);
      const payload = await plannerEditorsPayload(req.guildId, userIds);
      return res.json(payload);
    } catch (err) {
      log.error('admin_add_editor_failed', { message: err.message });
      return res.status(500).json({ error: 'Server error' });
    }
  }
);

router.delete(
  '/admin/planner-editors/:userId',
  param('userId').matches(/^\d{17,21}$/),
  async (req, res) => {
    if (!(await requirePlannerAdminSession(req, res))) return;
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      await removePlannerEditor(req.guildId, String(req.params.userId));
      return res.status(204).end();
    } catch (err) {
      log.error('admin_remove_editor_failed', { message: err.message });
      return res.status(500).json({ error: 'Server error' });
    }
  }
);

router.post('/admin/test-discord-message', async (req, res) => {
  if (!(await requirePlannerAdminSession(req, res))) return;
  try {
    const u = req.session.discordUser;
    await sendPlannerTestDiscordMessage({
      guildId: req.guildId,
      adminUsername: u?.username || '—',
      adminId: String(u?.id || ''),
    });
    return res.json({ ok: true });
  } catch (err) {
    const message =
      (err && typeof err.message === 'string' && err.message) || String(err || 'Erreur inconnue');
    log.warn('admin_test_discord_failed', { message });
    const status = /pas encore connecté/i.test(message) ? 503 : 500;
    return res.status(status).json({ error: message });
  }
});

router.get(
  '/events',
  query('from').optional().isInt(),
  query('to').optional().isInt(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      let events = await getEventsByGuild(req.guildId);
      const from = req.query.from != null ? Number(req.query.from) : null;
      const to = req.query.to != null ? Number(req.query.to) : null;
      if (from != null && !Number.isNaN(from)) {
        events = events.filter((e) => e.datetime >= from);
      }
      if (to != null && !Number.isNaN(to)) {
        events = events.filter((e) => e.datetime <= to);
      }
      return res.json({ events });
    } catch (err) {
      log.error('api_list_failed', { message: err.message });
      return res.status(500).json({ error: 'Server error' });
    }
  }
);

router.get(
  '/events/:id',
  param('id').isInt({ min: 1 }).toInt(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const ev = await getEventById(req.params.id);
      if (!ev || ev.guild_id !== req.guildId) return res.status(404).json({ error: 'Not found' });
      return res.json({ event: ev });
    } catch (err) {
      log.error('api_get_failed', { message: err.message });
      return res.status(500).json({ error: 'Server error' });
    }
  }
);

router.post(
  '/events',
  body('title').isString().trim().isLength({ min: 1, max: 200 }),
  body('datetime').isString().notEmpty(),
  body('duration_minutes').optional().isInt({ min: 1, max: 1440 }),
  body('reminder_body_template').optional().isString().isLength({ max: 4096 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const t = Date.parse(String(req.body.datetime));
      if (Number.isNaN(t)) return res.status(400).json({ error: 'datetime is not parseable' });
      if (t < Date.now()) {
        return res.status(400).json({ error: "La date de début ne peut pas être dans le passé." });
      }
      if (req.body.channel_id != null && String(req.body.channel_id).trim()) {
        const ch = String(req.body.channel_id).trim();
        if (!/^\d{5,30}$/.test(ch)) {
          return res.status(400).json({ error: 'channel_id must be a numeric snowflake' });
        }
      }
      let channelId = String(config.plannerChannelId || '').trim();
      if (!channelId || !/^\d{5,30}$/.test(channelId)) {
        channelId = req.body.channel_id ? String(req.body.channel_id).trim() : '';
      }
      if (!channelId) {
        const gs = await getGuildSettings(req.guildId);
        channelId = String(gs.default_channel_id || '');
      }
      if (!channelId || !/^\d{5,30}$/.test(channelId)) {
        return res.status(400).json({
          error:
            'channel_id is required — configure PLANNER_CHANNEL_ID or default_channel_id for the guild',
        });
      }
      if (!(await sessionCanMutatePlannerEvents(req))) {
        return res.status(403).json({
          error:
            'Votre compte n’est pas autorisé à créer des événements. Contactez un administrateur du planning.',
        });
      }
      const durationMinutes =
        req.body.duration_minutes != null ? Number(req.body.duration_minutes) : 60;
      const reminderBodyTemplate =
        req.body.reminder_body_template != null ? String(req.body.reminder_body_template) : '';
      const id = await addEvent({
        title: req.body.title,
        datetimeMs: t,
        channelId,
        guildId: req.guildId,
        durationMinutes,
        imageUrl: '',
        reminderBodyTemplate,
      });
      log.info('api_event_created', { id, guildId: req.guildId, mode: req.authMode });
      return res.status(201).json({ id });
    } catch (err) {
      log.error('api_create_failed', { message: err.message });
      return res.status(500).json({ error: 'Server error' });
    }
  }
);

router.patch(
  '/events/:id',
  param('id').isInt({ min: 1 }).toInt(),
  body('title').optional().isString().trim().isLength({ min: 1, max: 200 }),
  body('datetime').optional().isString().notEmpty(),
  body('duration_minutes').optional().isInt({ min: 1, max: 1440 }),
  body('reminder_body_template').optional().isString().isLength({ max: 4096 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      if (!(await sessionCanMutatePlannerEvents(req))) {
        return res.status(403).json({
          error:
            'Votre compte n’est pas autorisé à modifier des événements. Contactez un administrateur du planning.',
        });
      }
      const ev = await getEventById(req.params.id);
      if (!ev || ev.guild_id !== req.guildId) return res.status(404).json({ error: 'Not found' });

      /** @type {{ title?: string, datetimeMs?: number, durationMinutes?: number, reminderBodyTemplate?: string }} */
      const patch = {};
      if (req.body.title !== undefined) patch.title = String(req.body.title).trim();
      if (req.body.datetime !== undefined) {
        const t = Date.parse(String(req.body.datetime));
        if (Number.isNaN(t)) return res.status(400).json({ error: 'datetime is not parseable' });
        if (t < Date.now()) {
          return res.status(400).json({ error: "La date de début ne peut pas être dans le passé." });
        }
        patch.datetimeMs = t;
      }
      if (req.body.duration_minutes != null) patch.durationMinutes = Number(req.body.duration_minutes);
      if (req.body.reminder_body_template !== undefined) {
        patch.reminderBodyTemplate = String(req.body.reminder_body_template);
      }
      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
      }

      const ok = await updateEvent(req.params.id, req.guildId, patch);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      log.info('api_event_updated', { id: req.params.id, guildId: req.guildId, mode: req.authMode });
      return res.json({ ok: true });
    } catch (err) {
      log.error('api_update_failed', { message: err.message });
      return res.status(500).json({ error: 'Server error' });
    }
  }
);

router.delete(
  '/events/:id',
  param('id').isInt({ min: 1 }).toInt(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      if (!(await sessionCanMutatePlannerEvents(req))) {
        return res.status(403).json({
          error:
            'Votre compte n’est pas autorisé à supprimer des événements. Contactez un administrateur du planning.',
        });
      }
      const ev = await getEventById(req.params.id);
      if (!ev || ev.guild_id !== req.guildId) return res.status(404).json({ error: 'Not found' });
      await deleteEvent(req.params.id);
      log.info('api_event_deleted', { id: req.params.id, guildId: req.guildId, mode: req.authMode });
      return res.status(204).end();
    } catch (err) {
      log.error('api_delete_failed', { message: err.message });
      return res.status(500).json({ error: 'Server error' });
    }
  }
);

module.exports = { apiRouter: router };
