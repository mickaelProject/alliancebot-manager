/**
 * Page de connexion minimale (Tailwind CDN).
 */

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {{ csrfToken?: string, showPasswordLogin?: boolean, passwordError?: boolean }} opts
 */
function renderLoginPage(opts = {}) {
  const csrf = escapeHtml(opts.csrfToken || '');
  const showPw = Boolean(opts.showPasswordLogin);
  const pwdErr = opts.passwordError
    ? '<p class="mt-2 text-sm text-rose-300">Mot de passe incorrect.</p>'
    : '';

  const passwordBlock = showPw
    ? `<div class="mt-6 border-t border-white/10 pt-6">
      <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Connexion sans Discord</p>
      <p class="mt-1 text-xs text-slate-500">Contournement si OAuth Discord est bloqué depuis l’hébergeur. Même planning et <strong>même bot</strong> (<code>DISCORD_TOKEN</code>) : le serveur complète ton profil via l’API bot si tu es membre de la guilde configurée.</p>
      ${pwdErr}
      <form method="POST" action="/auth/planner-password" class="mt-3 space-y-3">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <label class="block text-xs text-slate-400">Mot de passe
          <input type="password" name="password" required autocomplete="current-password"
            class="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-400" />
        </label>
        <button type="submit" class="w-full rounded-lg bg-slate-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-500">
          Se connecter
        </button>
      </form>
    </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr" class="h-full">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Connexion</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="h-full bg-[#0b0d10] text-slate-100">
  <div class="flex min-h-full items-center justify-center px-4">
    <div class="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl">
      <h1 class="text-lg font-semibold tracking-tight">Planning alliance</h1>
      <p class="mt-2 text-sm text-slate-400">Connectez-vous avec Discord pour accéder au planning.</p>
      <p class="mt-3 text-xs text-slate-500">Sur certains hébergeurs gratuits, ouvrez d’abord <a class="text-indigo-300 underline" href="/health" target="_blank" rel="noopener">/health</a> une fois pour réveiller le serveur si le bouton Discord reste bloqué.</p>
      <p class="mt-2 text-xs text-slate-500">Si la page Discord « tourne » sans fin : essayez <strong>Chrome ou Edge en navigation normale</strong> (pas de mode privé strict) — la console peut afficher <code>localStorage is not defined</code> côté Discord, ce n’est pas un réglage Render.</p>
      <a class="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-[#5865F2] px-4 py-3 text-sm font-semibold text-white hover:bg-[#4752C4]"
         href="/auth/discord">Continuer avec Discord</a>
      ${passwordBlock}
    </div>
  </div>
</body>
</html>`;
}

module.exports = { renderLoginPage };
