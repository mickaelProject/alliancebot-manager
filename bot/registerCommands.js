/**
 * Register global slash commands once the bot is authenticated with Discord.
 */

const { REST, Routes } = require('discord.js');
const { config } = require('../config');
const { createLogger } = require('../lib/logger');
const { buildEventCommand } = require('./commands');

const log = createLogger('bot');

/**
 * @param {string} clientId Application id (same as bot client user id)
 */
async function registerSlashCommands(clientId) {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const body = [buildEventCommand().toJSON()];
  await rest.put(Routes.applicationCommands(clientId), { body });
  log.info('slash_commands_registered', { clientId, count: body.length });
}

module.exports = { registerSlashCommands };
