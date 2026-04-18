/**
 * URL d’avatar Discord (CDN) à partir du fragment session `discordUser`.
 * @param {{ id: string; avatar: string | null } | null | undefined} user
 * @returns {string | null}
 */
function discordAvatarUrl(user) {
  if (!user || !user.id) return null;
  const id = String(user.id);
  const av = user.avatar;
  if (av) {
    const ext = String(av).startsWith('a_') ? 'gif' : 'webp';
    return `https://cdn.discordapp.com/avatars/${id}/${av}.${ext}?size=128`;
  }
  try {
    const idx = Number((BigInt(id) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  } catch {
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }
}

module.exports = { discordAvatarUrl };
