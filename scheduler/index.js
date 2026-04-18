/**
 * Cron-based reminder scheduler (every minute).
 * Sends reminder embed (nom de guilde en auteur, sans logo) + @everyone (sans boutons).
 */

const cron = require('node-cron');
const { config } = require('../config');
const { getEventsDueForReminderOffset, markReminderSent, setReminderMessageRef, getGuildSettings } = require('../database');
const { buildReminderEmbed } = require('../lib/eventEmbeds');
const { formatReminderBodyFromTemplate } = require('../lib/reminderBodyTemplate');
const { finalizeDiscordReminderBody } = require('../lib/reminderBodyDiscordTranslate');
const { resolveReminderBranding } = require('../lib/reminderBranding');
const { createLogger } = require('../lib/logger');
const appEvents = require('../lib/appEvents');

const log = createLogger('scheduler');

/** @type {import('node-cron').ScheduledTask | null} */
let task = null;

/**
 * @param {import('discord.js').Client} client
 * @param {{ id: number; title: string; channel_id: string; guild_id: string }} event
 * @param {number} offsetMinutes
 */
async function sendReminder(client, event, offsetMinutes) {
  try {
    const channel = await client.channels.fetch(event.channel_id);
    if (!channel || !channel.isTextBased()) {
      log.warn('reminder_skipped', {
        reason: 'channel_unavailable',
        eventId: event.id,
        channelId: event.channel_id,
      });
      return;
    }
    let guildName = 'Discord';
    if ('guild' in channel && channel.guild) {
      guildName = channel.guild.name;
    } else if (event.guild_id) {
      const g = client.guilds.cache.get(event.guild_id);
      if (g) guildName = g.name;
    }
    const settings = await getGuildSettings(event.guild_id);
    const { displayName } = resolveReminderBranding(settings, guildName);
    const eventTpl = String(event.reminder_body_template ?? '').trim();
    const guildTpl = String(settings.reminder_body_template ?? '').trim();
    const usedCustom = Boolean(eventTpl || guildTpl);
    const rawDescription = formatReminderBodyFromTemplate(
      eventTpl || guildTpl,
      event.title,
      offsetMinutes
    );
    const description = await finalizeDiscordReminderBody(rawDescription, usedCustom);
    const embed = buildReminderEmbed({
      title: event.title,
      displayName,
      iconUrl: null,
      themeColor: settings.theme_color,
      offsetMinutes,
      description,
    });
    const msg = await channel.send({
      content: '@everyone',
      allowedMentions: { parse: ['everyone'] },
      embeds: [embed],
    });
    await setReminderMessageRef(event.id, offsetMinutes, msg.channel.id, msg.id);
    await markReminderSent(event.id, offsetMinutes);
    appEvents.emit('reminder.sent', { guildId: event.guild_id, eventId: event.id, offsetMinutes });
    log.info('reminder_sent', { eventId: event.id, offsetMinutes, channelId: event.channel_id });
  } catch (err) {
    log.error('reminder_failed', { eventId: event.id, message: err.message });
  }
}

/**
 * @param {import('discord.js').Client} client
 */
async function runReminderTick(client) {
  if (!client.isReady()) {
    log.debug('tick_skipped', { reason: 'client_not_ready' });
    return;
  }
  const now = Date.now();
  for (const offset of config.reminderMinutes) {
    let due;
    try {
      due = await getEventsDueForReminderOffset(now, offset);
    } catch (err) {
      log.error('tick_db_error', { message: err.message });
      continue;
    }
    if (!due.length) {
      log.debug('tick_no_matches', { offsetMinutes: offset });
      continue;
    }
    for (const ev of due) {
      await sendReminder(client, ev, offset);
    }
  }
}

/**
 * @param {import('discord.js').Client} client
 */
function startScheduler(client) {
  if (task) {
    task.stop();
    task = null;
  }
  task = cron.schedule(
    '* * * * *',
    () => {
      runReminderTick(client).catch((err) => {
        log.error('tick_unhandled', { message: err.message });
      });
    },
    { timezone: config.schedulerTimeZone }
  );
  log.info('cron_started', {
    pattern: '* * * * *',
    offsets: config.reminderMinutes,
    timezone: config.schedulerTimeZone,
  });

  setImmediate(() => {
    runReminderTick(client).catch((err) => log.error('startup_tick_failed', { message: err.message }));
  });

  return () => {
    if (task) {
      task.stop();
      task = null;
      log.info('cron_stopped', {});
    }
  };
}

module.exports = { startScheduler, runReminderTick };
