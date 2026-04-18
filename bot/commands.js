/**
 * Slash command definitions for /event
 */

const { SlashCommandBuilder, ChannelType } = require('discord.js');

function buildEventCommand() {
  return new SlashCommandBuilder()
    .setName('event')
    .setDescription('Alliance event scheduling')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a scheduled event')
        .addStringOption((o) =>
          o.setName('title').setDescription('Event title').setRequired(true).setMaxLength(200)
        )
        .addStringOption((o) =>
          o
            .setName('start')
            .setDescription('Start time (ISO 8601), e.g. 2026-04-20T18:00:00')
            .setRequired(true)
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel to post reminders in')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List upcoming events for this server'))
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete an event by id')
        .addIntegerOption((o) => o.setName('id').setDescription('Event id from /event list').setRequired(true))
    );
}

module.exports = { buildEventCommand };
