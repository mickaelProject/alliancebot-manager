/**
 * Page de connexion minimale (Tailwind CDN).
 */

function renderLoginPage() {
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
      <a class="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-[#5865F2] px-4 py-3 text-sm font-semibold text-white hover:bg-[#4752C4]"
         href="/auth/discord">Continuer avec Discord</a>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { renderLoginPage };
