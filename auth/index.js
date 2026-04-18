/**
 * Authentication barrel: Discord OAuth for the dashboard.
 */

const { mountDiscordOAuth } = require('./discordOAuth');
const { isAuthenticated } = require('./middleware');

module.exports = { mountDiscordOAuth, isAuthenticated };
