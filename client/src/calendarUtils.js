export const HOUR_START = 8;
/** Dernière heure affichée sur l’axe (la grille couvre jusqu’à 23:59 UTC, minuit exclus). */
export const HOUR_END = 23;
export const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
export const SLOT_REM = 3;
export const TOTAL_REM = HOURS.length * SLOT_REM;

/** Minutes couvrant la grille (8h UTC → 24h UTC exclus, soit 16 h). */
export const GRID_TOTAL_MINUTES = HOURS.length * 60;

/** Durée minimale d’un événement (minutes). */
export const MIN_EVENT_MINUTES = 1;

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Lundi 00:00 UTC de la semaine qui contient `ref` (date civile UTC de ref).
 */
export function startOfIsoWeekMonday(ref) {
  const t = ref.getTime();
  const utc = new Date(t);
  const y = utc.getUTCFullYear();
  const m = utc.getUTCMonth();
  const d = utc.getUTCDate();
  const dayStart = Date.UTC(y, m, d, 0, 0, 0, 0);
  const dow = new Date(dayStart).getUTCDay();
  const mon = (dow + 6) % 7;
  return new Date(dayStart - mon * 86400000);
}

export function addDays(d, n) {
  return new Date(d.getTime() + n * 86400000);
}

export function dayKey(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function calendarDayMidnight(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/** Jour calendaire entièrement avant maintenant (frontières UTC). */
export function isFullPastCalendarDay(day, nowMs = Date.now()) {
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth();
  const d = day.getUTCDate();
  const end = Date.UTC(y, m, d, 23, 59, 59, 999);
  return end < nowMs;
}

/** Jour calendaire strictement après aujourd’hui (UTC). */
export function isFutureCalendarDay(day, nowMs = Date.now()) {
  const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0, 0);
  const n = new Date(nowMs);
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 0, 0, 0, 0);
  return start > today;
}

/**
 * Première minute de la grille (0 = 8h00 UTC) où un nouvel événement peut commencer.
 * Retourne `GRID_TOTAL_MINUTES` si le jour est entièrement passé (aucun créneau).
 */
export function minAllowedMinuteIndexFromGridStart(day, nowMs = Date.now()) {
  if (isFullPastCalendarDay(day, nowMs)) return GRID_TOTAL_MINUTES;
  if (isFutureCalendarDay(day, nowMs)) return 0;
  const grid0 = dateAtMinutesFromDayStart(day, 0);
  const rawMins = (nowMs - grid0.getTime()) / 60000;
  if (rawMins <= 0) return 0;
  const maxStart = GRID_TOTAL_MINUTES - 1;
  return Math.max(0, Math.min(maxStart, Math.ceil(rawMins)));
}

/** Position verticale → minutes depuis 8h00 UTC (float, pour le survol fluide). */
export function yToFractionalMinutesFromGridStart(yPx, columnHeightPx) {
  if (columnHeightPx <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, yPx / columnHeightPx));
  return ratio * GRID_TOTAL_MINUTES;
}

/** Arrondi à la minute pour création / glisser. Dernier début possible : 23:59 UTC. */
export function yToMinutesFromGridStart(yPx, columnHeightPx) {
  const frac = yToFractionalMinutesFromGridStart(yPx, columnHeightPx);
  const maxStart = GRID_TOTAL_MINUTES - 1;
  return Math.max(0, Math.min(maxStart, Math.round(frac)));
}

export function dateAtMinutesFromDayStart(day, minutesFromGridStart) {
  const y = day.getUTCFullYear();
  const mo = day.getUTCMonth();
  const da = day.getUTCDate();
  const base = Date.UTC(y, mo, da, HOUR_START, 0, 0, 0);
  return new Date(base + minutesFromGridStart * 60000);
}

export function timeToTopPercent(hour, minute, second = 0) {
  const h = hour + minute / 60 + second / 3600;
  if (h < HOUR_START || h >= HOUR_END + 1) return null;
  const span = HOURS.length;
  return ((h - HOUR_START) / span) * 100;
}

export function timeToTopPercentFromDate(dt) {
  return timeToTopPercent(dt.getUTCHours(), dt.getUTCMinutes(), dt.getUTCSeconds());
}

/** Hauteur en % de colonne pour une durée en minutes. */
export function durationToHeightPercent(durationMinutes) {
  const dm = Math.max(MIN_EVENT_MINUTES, Number(durationMinutes) || 60);
  return (dm / 60 / HOURS.length) * 100;
}

/** Plage semaine affichée dans l’en-tête (UTC), selon la locale navigateur. */
export function formatWeekRangeDisplay(anchor, dateLocale = 'fr-FR') {
  const end = new Date(anchor.getTime() + 6 * 86400000);
  const start = anchor.toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const endStr = end.toLocaleDateString(dateLocale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${start} – ${endStr}`;
}

export function formatWeekRangeFr(anchor) {
  return formatWeekRangeDisplay(anchor, 'fr-FR');
}

export function eventHue(id) {
  const x = Number(id) || 0;
  return 210 + (x % 5) * 18;
}

/** Heure UTC HH:mm pour affichage et <input type="time" step="60"> */
export function formatTimeHm(d) {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function applyTimeHmOnSameDay(baseDay, hm) {
  const parts = String(hm || '0:0').split(':');
  const hh = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10) || 0;
  return new Date(
    Date.UTC(
      baseDay.getUTCFullYear(),
      baseDay.getUTCMonth(),
      baseDay.getUTCDate(),
      Number.isFinite(hh) ? hh : 0,
      Number.isFinite(mm) ? mm : 0,
      0,
      0
    )
  );
}
