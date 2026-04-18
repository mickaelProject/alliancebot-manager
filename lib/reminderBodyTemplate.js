/**
 * Optional per-event Discord reminder embed description (Discord limit 4096).
 * Empty template → use default English body from eventEmbeds.
 */

const { buildReminderBodyDescription } = require('./eventEmbeds');

const MAX = 4096;

/**
 * @param {string | null | undefined} template from events.reminder_body_template
 * @param {string} title event title
 * @param {number} offsetMinutes reminder offset (e.g. 5)
 */
function formatReminderBodyFromTemplate(template, title, offsetMinutes) {
  const raw = String(template ?? '').trim();
  if (!raw) {
    return buildReminderBodyDescription(title, offsetMinutes);
  }
  const safeTitle = String(title || '').trim() || 'Event';
  const n = Number(offsetMinutes);
  const mins = Number.isFinite(n) && n > 0 ? n : 0;
  const minuteWord = mins === 1 ? 'minute' : 'minutes';
  let out = raw
    .replace(/\{title\}/gi, safeTitle)
    .replace(/\{event\}/gi, safeTitle)
    .replace(/\{offset\}/g, String(mins))
    .replace(/\{minutes\}/g, String(mins))
    .replace(/\{minute_word\}/gi, minuteWord)
    .replace(/\{minuteWord\}/g, minuteWord);
  out = out.replace(/\\n/g, '\n');
  return out.slice(0, MAX);
}

module.exports = { formatReminderBodyFromTemplate };
