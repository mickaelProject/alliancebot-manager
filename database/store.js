/**
 * Async database service backed by sql.js (WASM SQLite, portable).
 * All public methods return Promises so a PostgreSQL driver can drop in later
 * without rewriting callers.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');
const { config } = require('../config');
const { createLogger } = require('../lib/logger');
const appEvents = require('../lib/appEvents');

const log = createLogger('database');

const rootDir = path.join(__dirname, '..');
const DB_PATH = path.isAbsolute(config.databasePath)
  ? config.databasePath
  : path.join(rootDir, config.databasePath);

/** @type {import('sql.js').Database | null} */
let db = null;

function persist() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function ensureDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function getUserVersion() {
  const database = ensureDb();
  const res = database.exec('PRAGMA user_version');
  if (!res.length || !res[0].values.length) return 0;
  return Number(res[0].values[0][0]) || 0;
}

function setUserVersion(v) {
  ensureDb().run(`PRAGMA user_version = ${Number(v)}`);
  persist();
}

function migrate() {
  if (getUserVersion() < 1) {
    log.info('migration_apply', { to: 1, note: 'guild_id' });
    try {
      ensureDb().run("ALTER TABLE events ADD COLUMN guild_id TEXT NOT NULL DEFAULT '';");
    } catch (e) {
      log.warn('migration_skip', { step: 1, reason: String(e.message) });
    }
    setUserVersion(1);
  }
  if (getUserVersion() < 2) {
    log.info('migration_apply', { to: 2, note: 'reminders_sent' });
    try {
      ensureDb().run("ALTER TABLE events ADD COLUMN reminders_sent TEXT NOT NULL DEFAULT '[]';");
    } catch (e) {
      log.warn('migration_skip', { step: 2, reason: String(e.message) });
    }
    try {
      ensureDb().run(
        `UPDATE events SET reminders_sent = '[5]' WHERE notified = 1 AND (reminders_sent IS NULL OR reminders_sent = '' OR reminders_sent = '[]');`
      );
    } catch (e) {
      log.warn('migration_data_backfill_failed', { message: String(e.message) });
    }
    setUserVersion(2);
  }
  if (getUserVersion() < 3) {
    log.info('migration_apply', { to: 3, note: 'rsvp + settings + api + reminder_messages' });
    ensureDb().run('PRAGMA foreign_keys = ON;');
    ensureDb().exec(`
      CREATE TABLE IF NOT EXISTS rsvps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('join','decline','maybe')),
        UNIQUE(event_id, user_id),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        theme_color INTEGER NOT NULL DEFAULT 5793266
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        key TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL
      );
    `);
    try {
      ensureDb().run("ALTER TABLE events ADD COLUMN reminder_messages TEXT NOT NULL DEFAULT '{}';");
    } catch (e) {
      log.warn('migration_skip', { column: 'reminder_messages', reason: String(e.message) });
    }
    setUserVersion(3);
  }
  if (getUserVersion() < 4) {
    log.info('migration_apply', { to: 4, note: 'default_channel_id on guild_settings' });
    try {
      ensureDb().run("ALTER TABLE guild_settings ADD COLUMN default_channel_id TEXT NOT NULL DEFAULT '';");
    } catch (e) {
      log.warn('migration_skip', { column: 'default_channel_id', reason: String(e.message) });
    }
    setUserVersion(4);
  }
  if (getUserVersion() < 5) {
    log.info('migration_apply', { to: 5, note: 'duration_minutes on events' });
    try {
      ensureDb().run('ALTER TABLE events ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 60;');
    } catch (e) {
      log.warn('migration_skip', { column: 'duration_minutes', reason: String(e.message) });
    }
    setUserVersion(5);
  }
  if (getUserVersion() < 6) {
    log.info('migration_apply', { to: 6, note: 'planner_editors' });
    ensureDb().exec(`
      CREATE TABLE IF NOT EXISTS planner_editors (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
    `);
    setUserVersion(6);
  }
  if (getUserVersion() < 7) {
    log.info('migration_apply', { to: 7, note: 'events.image_url' });
    try {
      ensureDb().run("ALTER TABLE events ADD COLUMN image_url TEXT NOT NULL DEFAULT '';");
    } catch (e) {
      log.warn('migration_skip', { column: 'image_url', reason: String(e.message) });
    }
    setUserVersion(7);
  }
  if (getUserVersion() < 8) {
    log.info('migration_apply', { to: 8, note: 'guild_settings.branding_icon_url' });
    try {
      ensureDb().run("ALTER TABLE guild_settings ADD COLUMN branding_icon_url TEXT NOT NULL DEFAULT '';");
    } catch (e) {
      log.warn('migration_skip', { column: 'branding_icon_url', reason: String(e.message) });
    }
    setUserVersion(8);
  }
  if (getUserVersion() < 9) {
    log.info('migration_apply', { to: 9, note: 'guild_settings.reminder_body_template' });
    try {
      ensureDb().run("ALTER TABLE guild_settings ADD COLUMN reminder_body_template TEXT NOT NULL DEFAULT '';");
    } catch (e) {
      log.warn('migration_skip', { column: 'reminder_body_template', reason: String(e.message) });
    }
    setUserVersion(9);
  }
  if (getUserVersion() < 10) {
    log.info('migration_apply', { to: 10, note: 'events.reminder_body_template' });
    try {
      ensureDb().run("ALTER TABLE events ADD COLUMN reminder_body_template TEXT NOT NULL DEFAULT '';");
    } catch (e) {
      log.warn('migration_skip', { column: 'events.reminder_body_template', reason: String(e.message) });
    }
    setUserVersion(10);
  }
  if (getUserVersion() < 11) {
    const mins = config.reminderMinutes.filter((n) => Number.isFinite(n) && n > 0);
    const def = mins.length ? Math.min(...mins) : 5;
    const clamped = Math.max(1, Math.min(10080, Math.floor(def)));
    log.info('migration_apply', { to: 11, note: 'events.reminder_offset_minutes', defaultOffset: clamped });
    try {
      ensureDb().run(
        `ALTER TABLE events ADD COLUMN reminder_offset_minutes INTEGER NOT NULL DEFAULT ${clamped};`
      );
    } catch (e) {
      log.warn('migration_skip', { column: 'reminder_offset_minutes', reason: String(e.message) });
    }
    setUserVersion(11);
  }
}

function sanitizeReminderOffsetMinutes(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 5;
  return Math.min(10080, n);
}

function parseReminderMessages(raw) {
  try {
    const o = JSON.parse(String(raw || '{}'));
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

function rowToEvent(row) {
  let remindersSent = [];
  try {
    remindersSent = JSON.parse(String(row.reminders_sent || '[]'));
    if (!Array.isArray(remindersSent)) remindersSent = [];
    remindersSent = remindersSent.map((n) => Number(n)).filter((n) => !Number.isNaN(n));
  } catch {
    remindersSent = [];
  }
  const dm = Number(row.duration_minutes);
  return {
    id: Number(row.id),
    title: String(row.title),
    datetime: Number(row.datetime),
    duration_minutes: Number.isFinite(dm) && dm > 0 ? dm : 60,
    channel_id: String(row.channel_id),
    guild_id: String(row.guild_id ?? ''),
    image_url: String(row.image_url ?? '').trim(),
    reminder_body_template: String(row.reminder_body_template ?? '').slice(0, 4096),
    reminder_offset_minutes: sanitizeReminderOffsetMinutes(row.reminder_offset_minutes),
    notified: Number(row.notified) === 1,
    reminders_sent: remindersSent,
    reminder_messages: parseReminderMessages(row.reminder_messages),
  };
}

async function initDatabase() {
  const wasmBinary = path.join(rootDir, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({
    locateFile: (file) =>
      file.endsWith('.wasm') && fs.existsSync(wasmBinary)
        ? wasmBinary
        : path.join(rootDir, 'node_modules', 'sql.js', 'dist', file),
  });

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH)));
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON;');
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      datetime INTEGER NOT NULL,
      channel_id TEXT NOT NULL,
      notified INTEGER NOT NULL DEFAULT 0
    );
  `);
  persist();
  migrate();
  log.info('database_ready', { path: DB_PATH, engine: 'sql.js' });
}

async function closeDatabase() {
  if (db) {
    try {
      persist();
    } catch {
      /* ignore */
    }
    db.close();
    db = null;
  }
}

async function getAllEvents() {
  const database = ensureDb();
  const res = database.exec(
    `SELECT id, title, datetime, duration_minutes, channel_id, guild_id, image_url, reminder_body_template, reminder_offset_minutes, notified, reminders_sent, reminder_messages
     FROM events ORDER BY datetime ASC`
  );
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((arr) => {
    const row = {};
    columns.forEach((c, i) => {
      row[c] = arr[i];
    });
    return rowToEvent(row);
  });
}

async function getUpcomingEvents(nowMs = Date.now()) {
  const all = await getAllEvents();
  return all.filter((e) => e.datetime > nowMs);
}

async function getEventsByGuild(guildId) {
  const gid = String(guildId).trim();
  const all = await getAllEvents();
  return all.filter((e) => e.guild_id === gid);
}

/**
 * @param {{ guildId?: string, date?: string, guildIds?: string[], status?: 'upcoming'|'past'|'all' }} filters
 */
async function getFilteredEvents(filters = {}) {
  let list = await getAllEvents();
  if (filters.guildIds !== undefined) {
    if (!filters.guildIds.length) return [];
    const allowed = new Set(filters.guildIds.map(String));
    list = list.filter((e) => allowed.has(e.guild_id));
  }
  if (filters.guildId) {
    list = list.filter((e) => e.guild_id === String(filters.guildId));
  }
  if (filters.date) {
    const d = filters.date;
    list = list.filter((e) => {
      const dt = new Date(e.datetime);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}` === d;
    });
  }
  const st = filters.status || 'all';
  const now = Date.now();
  if (st === 'upcoming') list = list.filter((e) => e.datetime > now);
  if (st === 'past') list = list.filter((e) => e.datetime <= now);
  return list;
}

async function addEvent(payload) {
  const database = ensureDb();
  const title = String(payload.title).trim();
  const channelId = String(payload.channelId).trim();
  const guildId = String(payload.guildId).trim();
  const datetimeMs = Math.floor(Number(payload.datetimeMs));
  let durationMinutes = Math.floor(Number(payload.durationMinutes));
  if (!Number.isFinite(durationMinutes) || durationMinutes < 1) durationMinutes = 60;
  if (durationMinutes > 24 * 60) durationMinutes = 24 * 60;
  if (!title || !channelId || !guildId || Number.isNaN(datetimeMs)) {
    throw new Error('addEvent: invalid payload');
  }
  const imageUrl = String(payload.imageUrl ?? '').trim();
  const reminderBodyTemplate = String(payload.reminderBodyTemplate ?? '').slice(0, 4096);
  const reminderOffsetMinutes = sanitizeReminderOffsetMinutes(
    payload.reminderOffsetMinutes !== undefined && payload.reminderOffsetMinutes !== null
      ? payload.reminderOffsetMinutes
      : 5
  );
  database.run(
    `INSERT INTO events (title, datetime, duration_minutes, channel_id, guild_id, image_url, reminder_body_template, reminder_offset_minutes, notified, reminders_sent, reminder_messages)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '[]', '{}')`,
    [title, datetimeMs, durationMinutes, channelId, guildId, imageUrl, reminderBodyTemplate, reminderOffsetMinutes]
  );
  persist();
  const st = database.prepare('SELECT id FROM events ORDER BY id DESC LIMIT 1');
  st.step();
  const id = Number(st.getAsObject().id);
  st.free();
  appEvents.emit('event.created', { guildId, eventId: id });
  log.info('audit_event_created', { eventId: id, guildId });
  return id;
}

async function deleteEvent(id) {
  const database = ensureDb();
  database.run('DELETE FROM events WHERE id = ?', [id]);
  const changed = database.getRowsModified();
  persist();
  if (changed > 0) {
    appEvents.emit('event.deleted', { eventId: id });
    log.info('audit_event_deleted', { eventId: id });
  }
  return changed > 0;
}

/**
 * @param {number} id
 * @param {string} guildId
 * @param {{ title?: string, datetimeMs?: number, durationMinutes?: number, reminderBodyTemplate?: string, imageUrl?: string, reminderOffsetMinutes?: number }} patch
 */
async function updateEvent(id, guildId, patch) {
  const ev = await getEventById(id);
  if (!ev || ev.guild_id !== String(guildId).trim()) return false;

  const title =
    patch.title !== undefined ? String(patch.title).trim().slice(0, 200) || ev.title : ev.title;
  const datetimeMs =
    patch.datetimeMs !== undefined ? Math.floor(Number(patch.datetimeMs)) : ev.datetime;
  let durationMinutes =
    patch.durationMinutes !== undefined ? Math.floor(Number(patch.durationMinutes)) : ev.duration_minutes;
  if (!Number.isFinite(durationMinutes) || durationMinutes < 1) durationMinutes = 60;
  if (durationMinutes > 24 * 60) durationMinutes = 24 * 60;
  const reminderBodyTemplate =
    patch.reminderBodyTemplate !== undefined
      ? String(patch.reminderBodyTemplate ?? '').slice(0, 4096)
      : ev.reminder_body_template;
  const imageUrl =
    patch.imageUrl !== undefined ? String(patch.imageUrl ?? '').trim() : ev.image_url;
  const reminderOffsetMinutes =
    patch.reminderOffsetMinutes !== undefined
      ? sanitizeReminderOffsetMinutes(patch.reminderOffsetMinutes)
      : ev.reminder_offset_minutes;

  ensureDb().run(
    `UPDATE events SET title = ?, datetime = ?, duration_minutes = ?, image_url = ?, reminder_body_template = ?, reminder_offset_minutes = ? WHERE id = ? AND guild_id = ?`,
    [
      title,
      datetimeMs,
      durationMinutes,
      imageUrl,
      reminderBodyTemplate,
      reminderOffsetMinutes,
      id,
      String(guildId).trim(),
    ]
  );
  persist();
  appEvents.emit('event.updated', { guildId: String(guildId).trim(), eventId: id });
  log.info('audit_event_updated', { eventId: id, guildId: String(guildId).trim() });
  return true;
}

async function getEventById(id) {
  const database = ensureDb();
  const stmt = database.prepare(
    `SELECT id, title, datetime, duration_minutes, channel_id, guild_id, image_url, reminder_body_template, reminder_offset_minutes, notified, reminders_sent, reminder_messages FROM events WHERE id = ?`
  );
  stmt.bind([id]);
  let ev = null;
  if (stmt.step()) {
    ev = rowToEvent(stmt.getAsObject());
  }
  stmt.free();
  return ev;
}

async function markReminderSent(id, offsetMinutes) {
  const ev = await getEventById(id);
  if (!ev) return;
  const set = new Set(ev.reminders_sent);
  set.add(offsetMinutes);
  const json = JSON.stringify([...set].sort((a, b) => a - b));
  const target = sanitizeReminderOffsetMinutes(ev.reminder_offset_minutes);
  const allDone = set.has(target);
  ensureDb().run('UPDATE events SET reminders_sent = ?, notified = ? WHERE id = ?', [json, allDone ? 1 : 0, id]);
  persist();
}

async function markAsNotified(id) {
  const ev = await getEventById(id);
  if (!ev) return;
  const target = sanitizeReminderOffsetMinutes(ev.reminder_offset_minutes);
  const json = JSON.stringify([target]);
  ensureDb().run('UPDATE events SET reminders_sent = ?, notified = 1 WHERE id = ?', [json, id]);
  persist();
}

async function markEventNotified(id) {
  await markAsNotified(id);
}

async function getEventsDueForReminder(nowMs) {
  const database = ensureDb();
  const stmt = database.prepare(
    `SELECT id, title, datetime, duration_minutes, channel_id, guild_id, image_url, reminder_body_template, reminder_offset_minutes, notified, reminders_sent, reminder_messages
     FROM events WHERE datetime > ?`
  );
  stmt.bind([nowMs]);
  const out = [];
  while (stmt.step()) {
    const ev = rowToEvent(stmt.getAsObject());
    const target = ev.reminder_offset_minutes;
    const diff = ev.datetime - nowMs;
    const minutesUntil = Math.ceil(diff / 60000);
    if (minutesUntil !== target) continue;
    if (ev.reminders_sent.includes(target)) continue;
    out.push(ev);
  }
  stmt.free();
  return out;
}

async function setReminderMessageRef(eventId, offsetMinutes, channelId, messageId) {
  const ev = await getEventById(eventId);
  if (!ev) return;
  const map = { ...ev.reminder_messages };
  map[String(offsetMinutes)] = { channelId: String(channelId), messageId: String(messageId) };
  ensureDb().run('UPDATE events SET reminder_messages = ? WHERE id = ?', [JSON.stringify(map), eventId]);
  persist();
}

async function getReminderMessageRef(eventId, offsetMinutes) {
  const ev = await getEventById(eventId);
  if (!ev) return null;
  const ref = ev.reminder_messages[String(offsetMinutes)];
  if (!ref || !ref.channelId || !ref.messageId) return null;
  return ref;
}

async function upsertRsvp(eventId, userId, status) {
  ensureDb().run(
    `INSERT INTO rsvps (event_id, user_id, status) VALUES (?, ?, ?)
     ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status`,
    [eventId, String(userId), status]
  );
  persist();
  const ev = await getEventById(eventId);
  appEvents.emit('rsvp.updated', { guildId: ev?.guild_id, eventId });
  log.info('audit_rsvp', { eventId, userId, status });
}

async function getRsvpCounts(eventId) {
  const database = ensureDb();
  const stmt = database.prepare(`SELECT status, COUNT(*) as c FROM rsvps WHERE event_id = ? GROUP BY status`);
  stmt.bind([eventId]);
  const out = { join: 0, maybe: 0, decline: 0 };
  while (stmt.step()) {
    const row = stmt.getAsObject();
    if (row.status === 'join') out.join = Number(row.c);
    if (row.status === 'maybe') out.maybe = Number(row.c);
    if (row.status === 'decline') out.decline = Number(row.c);
  }
  stmt.free();
  return out;
}

async function getGuildSettings(guildId) {
  const database = ensureDb();
  const stmt = database.prepare(
    'SELECT guild_id, name, theme_color, default_channel_id, branding_icon_url, reminder_body_template FROM guild_settings WHERE guild_id = ?'
  );
  stmt.bind([String(guildId)]);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  if (!row) {
    return {
      guild_id: String(guildId),
      name: '',
      theme_color: 5793266,
      default_channel_id: '',
      branding_icon_url: '',
      reminder_body_template: '',
    };
  }
  return {
    guild_id: String(row.guild_id),
    name: String(row.name || ''),
    theme_color: Number(row.theme_color) || 5793266,
    default_channel_id: String(row.default_channel_id || ''),
    branding_icon_url: String(row.branding_icon_url ?? '').trim(),
    reminder_body_template: String(row.reminder_body_template ?? '').slice(0, 4096),
  };
}

async function upsertGuildSettings(payload) {
  const gid = String(payload.guildId);
  const name = String(payload.name || '').slice(0, 120);
  const themeColor = Math.floor(Number(payload.themeColor)) || 5793266;
  const defaultChannelId =
    payload.defaultChannelId !== undefined ? String(payload.defaultChannelId || '').slice(0, 30) : '';
  const existing = await getGuildSettings(gid);
  const channelToStore =
    payload.defaultChannelId !== undefined ? defaultChannelId : existing.default_channel_id || '';
  const brandingIconUrl =
    payload.brandingIconUrl !== undefined
      ? String(payload.brandingIconUrl || '').trim().slice(0, 2048)
      : existing.branding_icon_url || '';
  const reminderBodyTemplate =
    payload.reminderBodyTemplate !== undefined
      ? String(payload.reminderBodyTemplate || '').slice(0, 4096)
      : existing.reminder_body_template || '';

  ensureDb().run(
    `INSERT INTO guild_settings (guild_id, name, theme_color, default_channel_id, branding_icon_url, reminder_body_template) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       name = excluded.name,
       theme_color = excluded.theme_color,
       default_channel_id = excluded.default_channel_id,
       branding_icon_url = excluded.branding_icon_url,
       reminder_body_template = excluded.reminder_body_template`,
    [gid, name, themeColor, channelToStore, brandingIconUrl, reminderBodyTemplate]
  );
  persist();
  appEvents.emit('guild.settings', { guildId: gid });
  log.info('audit_guild_settings', { guildId: gid });
}

async function createApiKey(guildId) {
  const key = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  ensureDb().run('INSERT INTO api_keys (key, guild_id) VALUES (?, ?)', [key, String(guildId)]);
  persist();
  log.info('audit_api_key_created', { guildId: String(guildId) });
  return key;
}

async function resolveGuildByApiKey(key) {
  const database = ensureDb();
  const stmt = database.prepare('SELECT guild_id FROM api_keys WHERE key = ?');
  stmt.bind([String(key)]);
  let gid = null;
  if (stmt.step()) gid = String(stmt.getAsObject().guild_id);
  stmt.free();
  return gid;
}

async function listPlannerEditors(guildId) {
  const database = ensureDb();
  const stmt = database.prepare(
    'SELECT user_id FROM planner_editors WHERE guild_id = ? ORDER BY user_id ASC'
  );
  stmt.bind([String(guildId)]);
  const out = [];
  while (stmt.step()) {
    out.push(String(stmt.getAsObject().user_id));
  }
  stmt.free();
  return out;
}

async function addPlannerEditor(guildId, userId) {
  ensureDb().run('INSERT OR IGNORE INTO planner_editors (guild_id, user_id) VALUES (?, ?)', [
    String(guildId),
    String(userId),
  ]);
  persist();
}

async function removePlannerEditor(guildId, userId) {
  ensureDb().run('DELETE FROM planner_editors WHERE guild_id = ? AND user_id = ?', [
    String(guildId),
    String(userId),
  ]);
  persist();
}

module.exports = {
  initDatabase,
  closeDatabase,
  getAllEvents,
  getUpcomingEvents,
  getEventsByGuild,
  getFilteredEvents,
  addEvent,
  deleteEvent,
  updateEvent,
  getEventById,
  markReminderSent,
  markAsNotified,
  markEventNotified,
  getEventsDueForReminder,
  setReminderMessageRef,
  getReminderMessageRef,
  upsertRsvp,
  getRsvpCounts,
  getGuildSettings,
  upsertGuildSettings,
  createApiKey,
  resolveGuildByApiKey,
  listPlannerEditors,
  addPlannerEditor,
  removePlannerEditor,
};
