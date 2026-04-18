/**
 * Button interactions for RSVP on reminder messages.
 */

const { getEventById, upsertRsvp, getGuildSettings } = require('../database');
const { buildReminderEmbed } = require('../lib/eventEmbeds');
const { formatReminderBodyFromTemplate } = require('../lib/reminderBodyTemplate');
const { finalizeDiscordReminderBody } = require('../lib/reminderBodyDiscordTranslate');
const { resolveReminderBranding } = require('../lib/reminderBranding');
const { createLogger } = require('../lib/logger');

const log = createLogger('bot');

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleRsvpButton(interaction) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith('rsvp:')) return false;
  const parts = interaction.customId.split(':');
  if (parts.length !== 4) return false;
  const [, eventIdStr, offsetStr, action] = parts;
  const eventId = parseInt(eventIdStr, 10);
  const offsetMinutes = parseInt(offsetStr, 10);
  if (Number.isNaN(eventId) || Number.isNaN(offsetMinutes)) return false;
  if (!['join', 'decline', 'maybe'].includes(action)) return false;

  const ev = await getEventById(eventId);
  if (!ev) {
    await interaction.reply({ content: 'This event no longer exists.', ephemeral: true });
    return true;
  }

  await upsertRsvp(eventId, interaction.user.id, action);
  await interaction.deferUpdate().catch(() => {});

  let guildName = 'Discord';
  if (interaction.guild) guildName = interaction.guild.name;
  const settings = await getGuildSettings(ev.guild_id);
  const { displayName } = resolveReminderBranding(settings, guildName);
  const eventTpl = String(ev.reminder_body_template ?? '').trim();
  const guildTpl = String(settings.reminder_body_template ?? '').trim();
  const usedCustom = Boolean(eventTpl || guildTpl);
  const rawDescription = formatReminderBodyFromTemplate(
    eventTpl || guildTpl,
    ev.title,
    offsetMinutes
  );
  const description = await finalizeDiscordReminderBody(rawDescription, usedCustom);
  const embed = buildReminderEmbed({
    title: ev.title,
    displayName,
    iconUrl: null,
    themeColor: settings.theme_color,
    offsetMinutes,
    description,
  });
  try {
    if (interaction.message && 'edit' in interaction.message) {
      const payload = { embeds: [embed], components: [] };
      const prevContent = interaction.message.content?.trim();
      if (prevContent) {
        payload.content = interaction.message.content;
        payload.allowedMentions = { parse: ['everyone'] };
      }
      await interaction.message.edit(payload);
    }
  } catch (err) {
    log.warn('rsvp_message_edit_failed', { message: err.message, eventId });
  }

  log.info('rsvp_recorded', { eventId, userId: interaction.user.id, action });
  return true;
}

module.exports = { handleRsvpButton };
