/**
 * Bridges internal appEvents to Socket.io fan-out.
 */

const appEvents = require('../lib/appEvents');
const { emitDashboard } = require('../lib/realtime');
const { createLogger } = require('../lib/logger');

const log = createLogger('realtime');

let wired = false;

function wireRealtime() {
  if (wired) return;
  wired = true;
  const names = ['event.created', 'event.deleted', 'rsvp.updated', 'reminder.sent', 'guild.settings'];
  for (const name of names) {
    appEvents.on(name, (payload) => {
      try {
        emitDashboard(name, payload && typeof payload === 'object' ? payload : {});
      } catch (err) {
        log.error('emit_failed', { name, message: err.message });
      }
    });
  }
  log.info('realtime_wired', { channels: names });
}

module.exports = { wireRealtime };
