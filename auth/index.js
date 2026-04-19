/**
 * Authentication barrel: Discord OAuth for the dashboard.
 */

const { mountDiscordOAuth } = require('./discordOAuth');
const { mountPlannerPasswordAuth } = require('./plannerPasswordAuth');
const { isAuthenticated } = require('./middleware');

module.exports = {
  mountDiscordOAuth,
  mountPlannerPasswordAuth,
  isAuthenticated,
};
