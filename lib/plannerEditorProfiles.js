/**
 * Résout pseudo / avatar des éditeurs planning via l’API REST Discord (token du bot).
 * Ne dépend pas du cache ni de l’intent « Server Members » : GET /users/{id} et GET /guilds/{id}/members/{id}.
 */

const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { config } = require('../config');
const { discordAvatarUrl } = require('./discordAvatar');

/** @type {import('@discordjs/rest').REST | null} */
let restSingleton = null;

function getBotRest() {
  const token = String(config.discordToken || '').trim();
  if (!token) return null;
  if (!restSingleton) {
    restSingleton = new REST({ version: '10' }).setToken(token);
  }
  return restSingleton;
}

function fallbackProfile(userId) {
  return {
    userId,
    username: null,
    globalName: null,
    displayName: null,
    avatarUrl: discordAvatarUrl({ id: userId, avatar: null }),
  };
}

/**
 * @param {import('@discordjs/rest').REST | null} rest
 * @param {string} guildId
 * @param {string} userId
 */
async function resolveOneProfileRest(rest, guildId, userId) {
  if (!rest) return fallbackProfile(userId);

  let username = null;
  let globalName = null;
  let displayName = null;
  let avatar = null;

  const memRow = await rest.get(Routes.guildMember(guildId, userId)).catch(() => null);
  if (memRow && memRow.user && memRow.user.username) {
    const u = memRow.user;
    username = u.username;
    globalName = u.global_name || null;
    avatar = u.avatar ?? null;
    displayName = memRow.nick || u.global_name || u.username;
  }

  if (!username) {
    const userRow = await rest.get(Routes.user(userId)).catch(() => null);
    if (userRow && userRow.username) {
      username = userRow.username;
      globalName = userRow.global_name || null;
      avatar = userRow.avatar ?? null;
      displayName = userRow.global_name || userRow.username;
    }
  }

  if (username) {
    return {
      userId,
      username,
      globalName,
      displayName: displayName || username,
      avatarUrl: discordAvatarUrl({ id: userId, avatar }),
    };
  }

  return fallbackProfile(userId);
}

/**
 * @param {string} guildId
 * @param {string[]} userIds
 */
async function resolvePlannerEditorProfiles(guildId, userIds) {
  const rest = getBotRest();
  const ordered = (userIds || []).map(String).filter(Boolean);
  if (!ordered.length) return [];

  const unique = [...new Set(ordered)];
  const byId = new Map();
  await Promise.all(
    unique.map(async (id) => {
      byId.set(id, await resolveOneProfileRest(rest, guildId, id));
    })
  );

  return ordered.map((id) => byId.get(id) || fallbackProfile(id));
}

module.exports = { resolvePlannerEditorProfiles };
