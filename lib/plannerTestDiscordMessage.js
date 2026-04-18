/**
 * Test message from planner admin: @everyone + short English embed (same branding as reminders).
 */

const { EmbedBuilder } = require('discord.js');
const { getDiscordClient } = require('./discordClientRegistry');
const { config } = require('../config');
const { getGuildSettings } = require('../database');
const { resolveReminderBranding } = require('./reminderBranding');
const { filesAndAuthorIconUrl } = require('./brandingAttachment');

/**
 * @param {{ guildId: string; adminUsername: string; adminId: string }} opts
 */
function mapDiscordSendError(err) {
  const base = err && typeof err.message === 'string' ? err.message : String(err);
  const code = err && (err.code ?? err.status);
  if (code === 50013 || /Missing Permissions/i.test(base)) {
    return `${base} — Check channel permissions: Send Messages, Embed Links, Mention @everyone, @here and All Roles.`;
  }
  if (code === 50001 || /Missing Access/i.test(base)) {
    return `${base} — The bot may not have access to this channel or is not in the guild.`;
  }
  return base;
}

/**
 * Server nickname (display name) if the member is in the guild; otherwise username.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {string} userId
 * @param {string} fallbackUsername
 */
async function resolveAdminServerDisplayName(client, guildId, userId, fallbackUsername) {
  if (!guildId || !userId) return fallbackUsername || '—';
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return fallbackUsername || '—';
  const member = await guild.members.fetch({ user: userId, force: false }).catch(() => null);
  if (!member) return fallbackUsername || '—';
  return member.displayName || fallbackUsername || '—';
}

async function sendPlannerTestDiscordMessage(opts) {
  const client = getDiscordClient();
  if (!client) {
    throw new Error(
      'No Discord client is registered on this process. Run the app with `node index.js` (bot + API together), not an isolated HTTP server.'
    );
  }
  if (!client.isReady()) {
    throw new Error('The Discord bot is not connected yet. Try again in a few seconds.');
  }

  const gs = await getGuildSettings(opts.guildId);

  let channelId = String(config.plannerChannelId || '').trim();
  if (!channelId || !/^\d{5,30}$/.test(channelId)) {
    channelId = String(gs.default_channel_id || '').trim();
  }
  if (!channelId || !/^\d{5,30}$/.test(channelId)) {
    throw new Error('No target channel: set PLANNER_CHANNEL_ID or default_channel_id for the guild.');
  }

  let channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel && opts.guildId) {
    const guild = await client.guilds.fetch(opts.guildId).catch(() => null);
    if (guild) {
      channel = await guild.channels.fetch(channelId).catch(() => null);
    }
  }
  if (!channel || !channel.isTextBased()) {
    throw new Error('Channel not found or not a text channel for the bot.');
  }
  if (typeof channel.isSendable === 'function' && !channel.isSendable()) {
    throw new Error('The bot cannot post in this channel (missing permissions or read-only).');
  }

  let discordGuildName = 'Guild';
  if ('guild' in channel && channel.guild) {
    discordGuildName = channel.guild.name;
  }
  const { displayName, iconUrl: resolvedHttps } = resolveReminderBranding(gs, discordGuildName);
  const { files, iconUrl: authorIcon } = filesAndAuthorIconUrl(resolvedHttps);

  const adminDisplay = await resolveAdminServerDisplayName(
    client,
    opts.guildId,
    opts.adminId,
    opts.adminUsername || '—'
  );

  const now = new Date();
  const stamp = now.toLocaleString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });

  const embed = new EmbedBuilder()
    .setColor(0x7c3aed)
    .setDescription(
      [
        '**Planner channel test** — sent from the **web admin**.',
        '',
        'If **@everyone** is mentioned above, this channel allows the bot to mention everyone.',
        '',
        `**When:** ${stamp}`,
        `**Triggered by:** ${adminDisplay}`,
      ].join('\n')
    )
    .setFooter({
      text: 'Test only · update PLANNER_CHANNEL_ID if you move this channel',
    });

  if (authorIcon) {
    embed.setAuthor({ name: displayName, iconURL: authorIcon });
  } else {
    embed.setAuthor({ name: displayName });
  }

  try {
    await channel.send({
      content: '@everyone',
      allowedMentions: { parse: ['everyone'] },
      files,
      embeds: [embed],
    });
  } catch (err) {
    throw new Error(mapDiscordSendError(err));
  }
}

module.exports = { sendPlannerTestDiscordMessage };
