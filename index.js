/**
 * Application entry: validation, logging hooks, SQLite, HTTP dashboard, Discord bot, cron scheduler.
 */

const { once } = require('node:events');
const { validateConfig, config } = require('./config');
const { createLogger } = require('./lib/logger');

const log = createLogger('app');

process.on('uncaughtException', (err) => {
  log.error('uncaught_exception', { message: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  log.error('unhandled_rejection', { message: msg });
});

const { initDatabase, closeDatabase } = require('./database');
const { startWebServer, shutdownHttp } = require('./server/app');
const { createDiscordClient } = require('./bot');
const { setDiscordClient } = require('./lib/discordClientRegistry');
const { startScheduler } = require('./scheduler');

/** @type {import('discord.js').Client | null} */
let discordClient = null;
/** @type {(() => void) | null} */
let stopScheduler = null;
async function bootstrap() {
  validateConfig();
  await initDatabase();
  await startWebServer();

  discordClient = createDiscordClient();
  setDiscordClient(discordClient);
  await discordClient.login(config.discordToken);
  if (!discordClient.isReady()) {
    await once(discordClient, 'clientReady');
  }
  stopScheduler = startScheduler(discordClient);
}

async function shutdown() {
  log.info('shutdown_begin', {});
  try {
    if (typeof stopScheduler === 'function') stopScheduler();
  } catch {
    /* ignore */
  }
  if (discordClient) {
    setDiscordClient(null);
    discordClient.destroy();
    discordClient = null;
  }
  try {
    await shutdownHttp();
  } catch {
    /* ignore */
  }
  await closeDatabase();
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown().catch(() => process.exit(1));
});
process.on('SIGTERM', () => {
  shutdown().catch(() => process.exit(1));
});

bootstrap().catch((err) => {
  log.error('bootstrap_failed', { message: err.message, stack: err.stack });
  process.exit(1);
});
