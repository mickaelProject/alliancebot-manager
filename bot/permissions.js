/**
 * Permission checks for slash commands (create / delete).
 */

const { PermissionFlagsBits } = require('discord.js');
const { config } = require('../config');

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
function roleIdsFromMember(interaction) {
  const member = interaction.member;
  if (!member) return [];
  if ('roles' in member && member.roles && typeof member.roles.cache !== 'undefined') {
    return [...member.roles.cache.keys()].map(String);
  }
  if ('roles' in member && Array.isArray(member.roles)) {
    return member.roles.map(String);
  }
  return [];
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
function canManageEvents(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }
  const roles = roleIdsFromMember(interaction);
  return config.botManageRoleIds.some((rid) => roles.includes(rid));
}

module.exports = { canManageEvents };
