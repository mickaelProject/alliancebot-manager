/**
 * Référence globale au client Discord.js (injectée au démarrage du bot).
 * Permet à l’API HTTP d’envoyer des messages sans coupler `server/api` à `index.js`.
 */

/** @type {import('discord.js').Client | null} */
let client = null;

/** @param {import('discord.js').Client | null} c */
function setDiscordClient(c) {
  client = c;
}

function getDiscordClient() {
  return client;
}

module.exports = { setDiscordClient, getDiscordClient };
