/**
 * Session helpers for dashboard routes.
 */

/**
 * @param {import('express').Request} req
 */
function isAuthenticated(req) {
  return Boolean(req.session && req.session.authenticated && req.session.discordUser);
}

/**
 * Require OAuth session for dashboard.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireDashboardSession(req, res, next) {
  if (req.path.startsWith('/auth/')) {
    return next();
  }
  if (req.path === '/login') {
    return next();
  }
  if (isAuthenticated(req)) {
    return next();
  }
  return res.redirect('/login');
}

module.exports = { isAuthenticated, requireDashboardSession };
