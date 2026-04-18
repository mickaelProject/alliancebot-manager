/**
 * CSRF token stocké en session pour les appels JSON (SPA).
 */

const crypto = require('crypto');

/**
 * @param {import('express').Request} req
 */
function ensureCsrfToken(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
}

module.exports = { ensureCsrfToken };
