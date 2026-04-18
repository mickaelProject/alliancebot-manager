/**
 * Lightweight structured logging (JSON lines to stdout).
 * Levels: debug, info, warn, error
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * @param {string} level
 * @param {string} scope
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 */
function write(level, scope, message, extra) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...(extra && Object.keys(extra).length ? { extra } : {}),
  };
  const line = JSON.stringify(payload);
  if (LEVELS[level] >= LEVELS.error) {
    console.error(line);
  } else if (LEVELS[level] >= LEVELS.warn) {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/** @param {string} scope */
function createLogger(scope) {
  return {
    debug: (message, extra) => write('debug', scope, message, extra),
    info: (message, extra) => write('info', scope, message, extra),
    warn: (message, extra) => write('warn', scope, message, extra),
    error: (message, extra) => write('error', scope, message, extra),
  };
}

module.exports = { createLogger, write };
