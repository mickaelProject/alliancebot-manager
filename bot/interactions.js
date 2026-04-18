/**
 * Handles slash commands + RSVP buttons.
 */

const { EmbedBuilder } = require('discord.js');
const { addEvent, deleteEvent, getEventsByGuild, getEventById } = require('../database');
const { canManageEvents } = require('./permissions');
const { createLogger } = require('../lib/logger');
const { handleRsvpButton } = require('./rsvpButtons');

const log = createLogger('bot');

/**
 * @param {import('discord.js').Interaction} interaction
 */
async function handleInteraction(interaction) {
  if (interaction.isButton()) {
    const handled = await handleRsvpButton(interaction);
    if (handled) return;
  }

  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'event') return;

  if (!interaction.guildId) {
    await interaction.reply({
      content: 'This command can only be used inside a server.',
      ephemeral: true,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'list') {
    const events = (await getEventsByGuild(interaction.guildId))
      .filter((e) => e.datetime > Date.now())
      .slice(0, 25);
    if (!events.length) {
      await interaction.reply({ content: 'No upcoming events for this server.', ephemeral: true });
      return;
    }
    const lines = events.map(
      (e) => `**#${e.id}** — ${e.title} — <t:${Math.floor(e.datetime / 1000)}:F> — <#${e.channel_id}>`
    );
    const embed = new EmbedBuilder()
      .setTitle('Upcoming events')
      .setDescription(lines.join('\n'))
      .setColor(0x5865f2);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (!canManageEvents(interaction)) {
    log.info('slash_permission_denied', { userId: interaction.user.id, sub });
    await interaction.reply({
      content: 'You need Administrator (or a configured manager role) to run this subcommand.',
      ephemeral: true,
    });
    return;
  }

  if (sub === 'create') {
    const titleStr = interaction.options.getString('title', true);
    const startStr = interaction.options.getString('start', true);
    const channel = interaction.options.getChannel('channel', true);
    if ('guildId' in channel && channel.guildId && channel.guildId !== interaction.guildId) {
      await interaction.reply({
        content: 'Pick a channel that belongs to this server.',
        ephemeral: true,
      });
      return;
    }
    const parsed = Date.parse(startStr);
    if (Number.isNaN(parsed)) {
      await interaction.reply({
        content: 'Could not parse `start` as a date. Use ISO 8601, e.g. `2026-04-20T18:00:00`.',
        ephemeral: true,
      });
      return;
    }
    if (parsed <= Date.now()) {
      await interaction.reply({ content: 'Event time must be in the future.', ephemeral: true });
      return;
    }
    const id = await addEvent({
      title: titleStr,
      datetimeMs: parsed,
      channelId: channel.id,
      guildId: interaction.guildId,
    });
    log.info('event_created_slash', { id, guildId: interaction.guildId });
    await interaction.reply({
      content: `Created event **#${id}** in <#${channel.id}>.`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'delete') {
    const id = interaction.options.getInteger('id', true);
    const existing = await getEventById(id);
    if (!existing || existing.guild_id !== interaction.guildId) {
      await interaction.reply({
        content: 'Event not found for this server.',
        ephemeral: true,
      });
      return;
    }
    await deleteEvent(id);
    log.info('event_deleted_slash', { id, guildId: interaction.guildId });
    await interaction.reply({ content: `Deleted event **#${id}**.`, ephemeral: true });
  }
}

module.exports = { handleInteraction };
