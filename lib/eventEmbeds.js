/**
 * Discord reminder embed (English body + author = guild name + optional logo) + RSVP buttons.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * English reminder lines (no guild name — shown on embed author).
 * @param {string} title
 * @param {number} offsetMinutes
 */
function buildReminderBodyDescription(title, offsetMinutes) {
  const safeTitle = String(title || '').trim() || 'Event';
  const n = Number(offsetMinutes);
  const mins = Number.isFinite(n) && n > 0 ? n : 0;
  const unit = mins === 1 ? 'minute' : 'minutes';
  return [`Reminder — starts in ${mins} ${unit}`, '', safeTitle].join('\n');
}

/**
 * @param {{ title: string; displayName: string; iconUrl: string | null; themeColor: number; offsetMinutes: number; description?: string }} p
 * If `description` is a non-empty string, it is used as the embed body (already formatted, max 4096).
 */
function buildReminderEmbed(p) {
  const colorNum = Math.floor(Number(p.themeColor));
  const color = Number.isFinite(colorNum) && colorNum >= 0 ? colorNum : 0x5865f2;
  const desc =
    typeof p.description === 'string' && String(p.description).trim().length > 0
      ? String(p.description).trim().slice(0, 4096)
      : buildReminderBodyDescription(p.title, p.offsetMinutes);
  const embed = new EmbedBuilder().setColor(color).setDescription(desc);

  const name = String(p.displayName || '').trim() || 'Guild';
  const rawIcon = String(p.iconUrl || '').trim();
  const icon =
    rawIcon && /^(https:\/\/|attachment:\/\/)/i.test(rawIcon) ? rawIcon : null;
  if (icon) {
    embed.setAuthor({ name, iconURL: icon });
  } else {
    embed.setAuthor({ name });
  }
  return embed;
}

/**
 * RSVP action row (persistent custom ids include offset for correct message edits).
 * @param {number} eventId
 * @param {number} offsetMinutes
 */
function buildRsvpRow(eventId, offsetMinutes) {
  const prefix = `rsvp:${eventId}:${offsetMinutes}`;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}:join`).setLabel('Join').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${prefix}:decline`).setLabel('Decline').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${prefix}:maybe`).setLabel('Maybe').setStyle(ButtonStyle.Secondary)
  );
}

module.exports = { buildReminderEmbed, buildReminderBodyDescription, buildRsvpRow };
