/**
 * Discord.js client factory: slash commands + interaction routing.
 */

const { Client, GatewayIntentBits } = require('discord.js');
const { registerSlashCommands } = require('./registerCommands');
const { handleInteraction } = require('./interactions');
const { createLogger } = require('../lib/logger');

const log = createLogger('bot');

function createDiscordClient() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  client.once('clientReady', async () => {
    log.info('bot_ready', { tag: client.user?.tag, id: client.user?.id });
    try {
      const appId = client.application?.id ?? client.user?.id;
      if (appId) await registerSlashCommands(appId);
    } catch (err) {
      log.error('slash_register_failed', { message: err.message });
    }
  });

  client.on('interactionCreate', (interaction) => {
    handleInteraction(interaction).catch((err) => {
      log.error('interaction_handler_error', { message: err.message });
    });
  });

  client.on('error', (err) => {
    log.error('discord_client_error', { message: err.message });
  });

  return client;
}

module.exports = { createDiscordClient };
