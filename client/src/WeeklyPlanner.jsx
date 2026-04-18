import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  HOURS,
  TOTAL_REM,
  GRID_TOTAL_MINUTES,
  MIN_EVENT_MINUTES,
  pad2,
  startOfIsoWeekMonday,
  addDays,
  dayKey,
  yToFractionalMinutesFromGridStart,
  yToMinutesFromGridStart,
  dateAtMinutesFromDayStart,
  timeToTopPercentFromDate,
  durationToHeightPercent,
  formatWeekRangeDisplay,
  eventHue,
  formatTimeHm,
  applyTimeHmOnSameDay,
  isFullPastCalendarDay,
  minAllowedMinuteIndexFromGridStart,
} from './calendarUtils.js';
import { useI18n } from './i18n/I18nProvider.jsx';

const DRAG_PX = 8;

function DayHeader({ day, isToday, dateLocale }) {
  const wd = day
    .toLocaleDateString(dateLocale, { weekday: 'short', timeZone: 'UTC' })
    .replace(/\.$/, '');
  const num = day.getUTCDate();
  return (
    <div
      className={`flex h-[3.25rem] flex-col items-center justify-center border-b border-[#454545] ${
        isToday ? 'bg-[#3d3d5c]/35' : 'bg-[#2d2c2c]'
      }`}
    >
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#9f9f9f]">{wd}</span>
      {isToday ? (
        <span className="mt-0.5 flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-[#5b5fc7] px-1.5 text-[14px] font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.12)]">
          {num}
        </span>
      ) : (
        <span className="mt-0.5 text-[14px] font-semibold tabular-nums text-[#f5f5f5]">{num}</span>
      )}
    </div>
  );
}

function DayColumn({
  day,
  isToday,
  events,
  onDelete,
  onEditEvent,
  nowLinePct,
  previewDurationMinutes,
  onCreateFromInteraction,
  nowTs,
  t,
  dateLocale,
}) {
  const key = dayKey(day);
  const bodyRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [dragVisual, setDragVisual] = useState(null);
  const dragStartRef = useRef(null);

  const pastDay = useMemo(() => isFullPastCalendarDay(day, nowTs), [day, nowTs]);
  const minIdx = useMemo(() => minAllowedMinuteIndexFromGridStart(day, nowTs), [day, nowTs]);

  const blocks = useMemo(() => {
    return events
      .map((ev) => {
        const dt = new Date(ev.datetime);
        if (dayKey(dt) !== key) return null;
        const topPct = timeToTopPercentFromDate(dt);
        if (topPct == null) return null;
        const dm = Number(ev.duration_minutes) || 60;
        const heightPct = durationToHeightPercent(dm);
        return { ev, topPct, heightPct, dt, durationMinutes: dm };
      })
      .filter(Boolean);
  }, [events, key]);

  const toTopPct = (minsFromStart) => (minsFromStart / GRID_TOTAL_MINUTES) * 100;

  const updateHoverFromEvent = (e) => {
    const el = bodyRef.current;
    if (!el || dragStartRef.current || pastDay || minIdx >= GRID_TOTAL_MINUTES) return;
    const r = el.getBoundingClientRect();
    const y = e.clientY - r.top;
    let frac = yToFractionalMinutesFromGridStart(y, r.height);
    frac = Math.max(minIdx, frac);
    const hp = durationToHeightPercent(previewDurationMinutes);
    let tp = (frac / GRID_TOTAL_MINUTES) * 100;
    if (tp + hp > 100) tp = Math.max(0, 100 - hp);
    const startMin = Math.min(GRID_TOTAL_MINUTES - 1, Math.max(minIdx, Math.round(frac)));
    const startDt = dateAtMinutesFromDayStart(day, startMin);
    const endDt = new Date(startDt.getTime() + previewDurationMinutes * 60_000);
    const label = `${formatTimeHm(startDt)} → ${formatTimeHm(endDt)}`;
    setHover({ topPct: tp, heightPct: hp, label });
  };

  const clearHover = () => setHover(null);

  const handlePointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('[data-event-block]')) return;
    const el = bodyRef.current;
    if (!el || pastDay || minIdx >= GRID_TOTAL_MINUTES) return;
    const r = el.getBoundingClientRect();
    const y = e.clientY - r.top;
    const m = yToMinutesFromGridStart(y, r.height);
    if (m < minIdx) return;
    dragStartRef.current = { m0: m, y0: e.clientY, x0: e.clientX };
    setHover(null);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const s0 = dateAtMinutesFromDayStart(day, m);
    const e0 = new Date(s0.getTime() + MIN_EVENT_MINUTES * 60_000);
    setDragVisual({
      topPct: toTopPct(m),
      heightPct: durationToHeightPercent(MIN_EVENT_MINUTES),
      label: `${formatTimeHm(s0)} → ${formatTimeHm(e0)}`,
    });
  };

  const handlePointerMove = (e) => {
    const el = bodyRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const y = e.clientY - r.top;
    if (!dragStartRef.current) return;
    const m1raw = yToMinutesFromGridStart(y, r.height);
    const m1 = Math.max(minIdx, m1raw);
    const m0 = dragStartRef.current.m0;
    const top = Math.min(m0, m1);
    const dur = Math.max(MIN_EVENT_MINUTES, Math.abs(m1 - m0));
    const s = dateAtMinutesFromDayStart(day, top);
    const en = new Date(s.getTime() + dur * 60_000);
    setDragVisual({
      topPct: toTopPct(top),
      heightPct: (dur / GRID_TOTAL_MINUTES) * 100,
      label: `${formatTimeHm(s)} → ${formatTimeHm(en)}`,
    });
  };

  const finishPointer = (e) => {
    const el = bodyRef.current;
    if (el && e.pointerId != null) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    const startData = dragStartRef.current;
    dragStartRef.current = null;
    setDragVisual(null);
    setHover(null);

    if (!startData) return;

    const { m0, y0, x0 } = startData;
    const r = el?.getBoundingClientRect();
    if (!r) return;
    const y = e.clientY - r.top;
    const m1 = yToMinutesFromGridStart(y, r.height);
    const cx = e.clientX ?? x0;
    const moved =
      Math.abs(e.clientY - y0) > DRAG_PX ||
      Math.abs(cx - x0) > DRAG_PX ||
      Math.abs(m1 - m0) >= MIN_EVENT_MINUTES;

    if (moved) {
      const minI = minAllowedMinuteIndexFromGridStart(day, nowTs);
      if (minI >= GRID_TOTAL_MINUTES) return;
      let startMin = Math.min(m0, m1);
      let durationMinutes = Math.max(MIN_EVENT_MINUTES, Math.abs(m1 - m0));
      if (startMin + durationMinutes <= minI) return;
      if (startMin < minI) {
        const cut = minI - startMin;
        startMin = minI;
        durationMinutes = Math.max(MIN_EVENT_MINUTES, durationMinutes - cut);
      }
      const start = dateAtMinutesFromDayStart(day, startMin);
      if (start.getTime() < nowTs) return;
      onCreateFromInteraction({ start, durationMinutes });
    }
  };

  const handleDoubleClick = (e) => {
    if (e.target.closest('[data-event-block]')) return;
    const el = bodyRef.current;
    if (!el || pastDay || minIdx >= GRID_TOTAL_MINUTES) return;
    const r = el.getBoundingClientRect();
    const y = e.clientY - r.top;
    let m = yToMinutesFromGridStart(y, r.height);
    if (m < minIdx) return;
    const start = dateAtMinutesFromDayStart(day, m);
    if (start.getTime() < nowTs) return;
    onCreateFromInteraction({ start, durationMinutes: previewDurationMinutes });
  };

  const gridBg = {
    backgroundImage: [
      'repeating-linear-gradient(to bottom, rgba(255,255,255,0.09) 0, rgba(255,255,255,0.09) 1px, transparent 1px, transparent 3rem)',
      'repeating-linear-gradient(to bottom, rgba(255,255,255,0.045) 0, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 1.5rem)',
    ].join(', '),
  };

  return (
    <div
      className={`relative min-w-0 flex-1 border-l border-[#3d3d3d] ${
        isToday ? 'bg-[#4f52b2]/[0.09]' : 'bg-[#1e1e1e]'
      }`}
    >
      <DayHeader day={day} isToday={isToday} dateLocale={dateLocale} />

      <div
        ref={bodyRef}
        role="gridcell"
        aria-label={`${t('planner.gridDayAria')} — ${day.toLocaleDateString(dateLocale, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          timeZone: 'UTC',
        })}`}
        onMouseMove={updateHoverFromEvent}
        onMouseLeave={clearHover}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onDoubleClick={handleDoubleClick}
        className="relative cursor-crosshair select-none touch-none"
        style={{ height: `${TOTAL_REM}rem`, ...gridBg }}
      >
        {pastDay ? (
          <div
            className="pointer-events-auto absolute inset-0 z-[12] bg-black/35"
            aria-hidden
          />
        ) : isToday && nowLinePct != null && minIdx < GRID_TOTAL_MINUTES ? (
          <div
            className="pointer-events-auto absolute left-0 right-0 top-0 z-[12] bg-black/30"
            style={{ height: `${nowLinePct}%` }}
            aria-hidden
          />
        ) : null}

        {!dragVisual && hover ? (
          <div
            className="pointer-events-none absolute left-1.5 right-1.5 z-[15] overflow-hidden rounded-lg ring-1 ring-white/[0.14] shadow-[0_4px_28px_rgba(0,0,0,0.35)]"
            style={{ top: `${hover.topPct}%`, height: `${hover.heightPct}%` }}
          >
            <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-cyan-300 via-sky-500 to-indigo-600 opacity-90 shadow-[0_0_14px_rgba(34,211,238,0.55)]" />
            <div className="absolute inset-0 ml-1 rounded-r-lg border border-white/[0.08] bg-gradient-to-br from-cyan-400/[0.12] via-sky-500/[0.08] to-slate-950/35 backdrop-blur-[2px]" />
            <div className="absolute left-2 right-2 top-1.5 flex items-center gap-1.5 rounded-md border border-white/10 bg-black/50 px-2 py-0.5 shadow-sm backdrop-blur-md">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.9)]" />
              <span className="truncate font-mono text-[10px] font-medium tracking-tight text-white/95">
                {hover.label}
              </span>
            </div>
          </div>
        ) : null}

        {dragVisual ? (
          <div
            className="pointer-events-none absolute left-1.5 right-1.5 z-[16] overflow-hidden rounded-lg ring-1 ring-violet-400/45 shadow-[0_0_32px_rgba(124,58,237,0.32)]"
            style={{ top: `${dragVisual.topPct}%`, height: `${dragVisual.heightPct}%` }}
          >
            <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-fuchsia-400 via-violet-500 to-indigo-700 opacity-95 shadow-[0_0_16px_rgba(167,139,250,0.65)]" />
            <div className="absolute inset-0 ml-1 rounded-r-lg border border-violet-300/20 bg-gradient-to-br from-violet-500/[0.22] via-indigo-600/[0.14] to-slate-950/45 backdrop-blur-[2px]" />
            <div className="absolute left-2 right-2 top-1.5 flex items-center gap-1.5 rounded-md border border-violet-200/15 bg-black/55 px-2 py-0.5 shadow-sm backdrop-blur-md">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-300 shadow-[0_0_10px_rgba(196,181,253,0.95)]" />
              <span className="truncate font-mono text-[10px] font-semibold tracking-tight text-white">
                {dragVisual.label}
              </span>
            </div>
          </div>
        ) : null}

        {isToday && nowLinePct != null ? (
          <div
            className="pointer-events-none absolute left-0 right-0 z-20"
            style={{ top: `${nowLinePct}%` }}
            aria-hidden
          >
            <div className="flex items-center">
              <div className="h-2 w-2 shrink-0 rounded-full bg-teal-400 shadow-[0_0_12px_rgba(45,212,191,0.85)]" />
              <div className="h-[2px] flex-1 bg-gradient-to-r from-teal-400 via-emerald-300/90 to-transparent shadow-[0_0_10px_rgba(45,212,191,0.45)]" />
            </div>
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-0 z-[18]">
          {blocks.map(({ ev, topPct, heightPct, dt, durationMinutes }) => {
            const end = new Date(dt.getTime() + durationMinutes * 60_000);
            return (
              <div
                key={ev.id}
                data-event-block
                role="button"
                tabIndex={0}
                className="group pointer-events-auto absolute left-1 right-1 cursor-pointer overflow-hidden rounded border border-white/[0.08] bg-[#292929] px-1.5 py-1 pl-2 shadow-[0_1px_2px_rgba(0,0,0,0.45)] ring-1 ring-black/30 hover:bg-[#323232]"
                style={{
                  top: `${topPct}%`,
                  height: `${heightPct}%`,
                  borderLeftWidth: '3px',
                  borderLeftColor: `hsl(${eventHue(ev.id)}, 48%, 55%)`,
                }}
                title={`${ev.title}\n${formatTimeHm(dt)} – ${formatTimeHm(end)} (${durationMinutes} ${t(
                  'planner.eventMin'
                )})`}
                onClick={() => onEditEvent?.(ev)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onEditEvent?.(ev);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-snug text-[#f5f5f5]">
                    {ev.title}
                  </div>
                  <button
                    type="button"
                    className="pointer-events-auto shrink-0 rounded px-1 text-[13px] leading-none text-[#f1707b] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10"
                    onClick={(evClick) => {
                      evClick.stopPropagation();
                      onDelete(ev.id);
                    }}
                    aria-label={t('planner.deleteEventAria')}
                  >
                    ×
                  </button>
                </div>
              <div className="truncate text-[10px] text-[#b0b0b0]">
                {formatTimeHm(dt)} → {formatTimeHm(end)} · {durationMinutes} {t('planner.eventMin')}
              </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UserMenu({ user, plannerAdmin, t }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  if (!user) return null;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#454545] bg-[#252525] hover:border-[#5b5fc7]/60 hover:ring-2 hover:ring-[#5b5fc7]/30"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('planner.menuAccount')}
        onClick={() => setOpen((v) => !v)}
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="text-xs font-semibold text-[#ccc]">
            {(user.username || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full z-[100] mt-2 min-w-[12rem] rounded-lg border border-[#454545] bg-[#252525] py-1 shadow-2xl"
          role="menu"
        >
          {plannerAdmin ? (
            <a
              href="/admin"
              className="block px-3 py-2.5 text-sm text-[#f3f3f3] hover:bg-[#323232]"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              {t('planner.menuAdmin')}
            </a>
          ) : null}
          <a
            href="/logout"
            className="block px-3 py-2.5 text-sm text-[#f1707b] hover:bg-[#323232]"
            role="menuitem"
          >
            {t('planner.menuLogout')}
          </a>
        </div>
      ) : null}
    </div>
  );
}

export function WeeklyPlanner() {
  const { t, dateLocale } = useI18n();
  const [weekAnchor, setWeekAnchor] = useState(() => startOfIsoWeekMonday(new Date()));
  const [guild, setGuild] = useState(null);
  const [csrf, setCsrf] = useState('');
  const [sessionUser, setSessionUser] = useState(null);
  const [plannerAdmin, setPlannerAdmin] = useState(false);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [title, setTitle] = useState('');
  const [reminderBodyTemplate, setReminderBodyTemplate] = useState('');
  const [modalTab, setModalTab] = useState('general');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [clock, setClock] = useState(() => Date.now());
  const [previewDuration, setPreviewDuration] = useState(60);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekAnchor, i)), [weekAnchor]);

  const range = useMemo(() => {
    const from = weekAnchor.getTime();
    const to = from + 7 * 86400000 - 1;
    return { from, to };
  }, [weekAnchor]);

  const todayKey = useMemo(() => dayKey(new Date()), [clock]);

  const nowLineByDayKey = useMemo(() => {
    const now = new Date(clock);
    const map = {};
    for (const d of weekDays) {
      if (dayKey(d) !== dayKey(now)) continue;
      const pct = timeToTopPercentFromDate(now);
      if (pct != null) map[dayKey(d)] = pct;
    }
    return map;
  }, [clock, weekDays]);

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const eventsQuery = useMemo(() => {
    const qs = new URLSearchParams({
      from: String(range.from),
      to: String(range.to),
    });
    if (guild?.id) qs.set('guild_id', guild.id);
    return qs.toString();
  }, [guild?.id, range.from, range.to]);

  const loadBootstrap = useCallback(async () => {
    const res = await fetch('/api/bootstrap', { credentials: 'include' });
    if (res.status === 403) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.message || j.error || t('planner.errorGuildForbidden'));
    }
    if (!res.ok) throw new Error(t('planner.errorSession'));
    const data = await res.json();
    setCsrf(data.csrfToken || '');
    setGuild(data.guild || null);
    setSessionUser(data.user || null);
    setPlannerAdmin(Boolean(data.plannerAdmin));
  }, [t]);

  const loadEvents = useCallback(async () => {
    if (!guild?.id) {
      setEvents([]);
      return;
    }
    const res = await fetch(`/api/events?${eventsQuery}`, { credentials: 'include' });
    if (!res.ok) throw new Error(t('planner.errorLoadEvents'));
    const data = await res.json();
    setEvents(Array.isArray(data.events) ? data.events : []);
  }, [guild?.id, eventsQuery, t]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError('');
        await loadBootstrap();
      } catch (e) {
        if (alive) setError(e.message || t('planner.errorGeneric'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadBootstrap, t]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!guild?.id) return;
      try {
        setLoading(true);
        setError('');
        await loadEvents();
      } catch (e) {
        if (alive) setError(e.message || t('planner.errorGeneric'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [guild?.id, loadEvents, t]);

  const openCreateModal = useCallback(
    ({ start, durationMinutes: dm }) => {
      if (start.getTime() < Date.now()) {
        setError(t('planner.createPast'));
        return;
      }
      setError('');
      setTitle('');
      setReminderBodyTemplate('');
      setDurationMinutes(dm);
      setPreviewDuration(dm);
      setModalTab('general');
      setModal({ start });
    },
    [t]
  );

  const openEditEvent = useCallback(
    (ev) => {
      const dt = new Date(ev.datetime);
      if (dt.getTime() < Date.now()) {
        setError(t('planner.editPast'));
        return;
      }
      setError('');
      setTitle(String(ev.title || '').trim());
      setDurationMinutes(Number(ev.duration_minutes) || 60);
      setPreviewDuration(Number(ev.duration_minutes) || 60);
      setReminderBodyTemplate(
        typeof ev.reminder_body_template === 'string' ? ev.reminder_body_template : ''
      );
      setModalTab('general');
      setModal({ start: dt, editEventId: ev.id });
    },
    [t]
  );

  const closeModal = () => {
    setModal(null);
    setModalTab('general');
  };

  const saveEvent = async () => {
    if (!modal || !guild?.id) return;
    const titleTrim = title.trim();
    if (!titleTrim) return;
    if (modal.start.getTime() < Date.now()) {
      setError(t('planner.startPast'));
      return;
    }
    const qs = new URLSearchParams({ guild_id: guild.id });
    if (modal.editEventId) {
      const res = await fetch(`/api/events/${modal.editEventId}?${qs.toString()}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrf,
        },
        body: JSON.stringify({
          title: titleTrim,
          datetime: modal.start.toISOString(),
          duration_minutes: durationMinutes,
          reminder_body_template: reminderBodyTemplate,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || t('planner.updateFailed'));
        return;
      }
    } else {
      const body = {
        title: titleTrim,
        datetime: modal.start.toISOString(),
        duration_minutes: durationMinutes,
        guild_id: guild.id,
        reminder_body_template: reminderBodyTemplate,
      };
      const res = await fetch('/api/events', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrf,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || t('planner.createFailed'));
        return;
      }
    }
    setError('');
    closeModal();
    await loadEvents();
  };

  const removeEvent = async (id) => {
    if (!guild?.id) return;
    if (!window.confirm(t('planner.deleteConfirm'))) return;
    const qs = new URLSearchParams({ guild_id: guild.id });
    const res = await fetch(`/api/events/${id}?${qs.toString()}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'x-csrf-token': csrf },
    });
    if (!res.ok) {
      setError(t('planner.deleteFailed'));
      return;
    }
    setError('');
    await loadEvents();
  };

  const weekLabel = useMemo(() => formatWeekRangeDisplay(weekAnchor, dateLocale), [weekAnchor, dateLocale]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#1a1a1a] font-sans text-[#f3f3f3] antialiased">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#3d3d3d] px-4 py-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[#555] bg-[#252525] text-[#eaeaea] shadow-sm hover:bg-[#323232]"
            onClick={() => setWeekAnchor((w) => addDays(w, -7))}
            aria-label={t('planner.prevWeek')}
          >
            ‹
          </button>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[#555] bg-[#252525] text-[#eaeaea] shadow-sm hover:bg-[#323232]"
            onClick={() => setWeekAnchor((w) => addDays(w, 7))}
            aria-label={t('planner.nextWeek')}
          >
            ›
          </button>
          <span className="min-w-0 truncate px-1 text-[15px] font-semibold tracking-tight text-white">
            {weekLabel}
            <span className="ml-1.5 text-xs font-normal text-[#8a8a8a]">{t('planner.utc')}</span>
          </span>
          <button
            type="button"
            className="rounded-md border border-transparent px-2.5 py-1 text-xs font-medium text-[#b4b4b4] hover:border-[#555] hover:bg-[#252525] hover:text-white"
            onClick={() => setWeekAnchor(startOfIsoWeekMonday(new Date()))}
          >
            {t('planner.today')}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!guild?.id ? <span className="text-xs text-[#f1707b]">{t('planner.noGuild')}</span> : null}
          <UserMenu user={sessionUser} plannerAdmin={plannerAdmin} t={t} />
        </div>
      </header>

      {error ? (
        <div className="shrink-0 border-b border-[#d13438]/35 bg-[#442726] px-4 py-2 text-xs text-[#ffb3b0]">
          {error}
        </div>
      ) : null}

      <main className="relative min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-[#1a1a1a]/50 pt-10">
            <span className="rounded-md border border-[#454545] bg-[#252525] px-3 py-2 text-xs text-[#b0b0b0] shadow-lg">
              {t('planner.loading')}
            </span>
          </div>
        ) : null}

        <div className="flex min-h-full min-w-[880px]">
          <div className="w-[3.25rem] shrink-0 border-r border-[#3d3d3d] bg-[#1e1e1e]">
            <div className="flex h-[3.25rem] flex-col items-end justify-end border-b border-[#454545] pr-1.5 pb-0.5">
              <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#5c5c5c]">
                {t('planner.utc')}
              </span>
            </div>
            <div style={{ height: `${TOTAL_REM}rem` }}>
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="box-border flex h-[3rem] items-start justify-end border-b border-[#353535] pr-2 pt-0.5 text-[11px] font-medium tabular-nums text-[#8f8f8f]"
                >
                  {pad2(hour)}:00
                </div>
              ))}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 border-r border-[#3d3d3d]">
            {weekDays.map((d) => (
              <DayColumn
                key={dayKey(d)}
                day={d}
                isToday={dayKey(d) === todayKey}
                events={events}
                onDelete={removeEvent}
                onEditEvent={openEditEvent}
                nowLinePct={nowLineByDayKey[dayKey(d)]}
                previewDurationMinutes={previewDuration}
                onCreateFromInteraction={openCreateModal}
                nowTs={clock}
                t={t}
                dateLocale={dateLocale}
              />
            ))}
          </div>
        </div>
      </main>

      {modal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]">
          <div
            className="w-full max-w-[420px] border border-[#454545] bg-[#252525] p-6 shadow-2xl"
            role="dialog"
            aria-labelledby="modal-title"
          >
            <div id="modal-title" className="text-lg font-semibold text-white">
              {modal.editEventId ? t('planner.modalTitleEdit') : t('planner.modalTitle')}
            </div>
            <div className="mt-1 text-xs text-[#a8a8a8]">
              {modal.start.toLocaleDateString(dateLocale, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              })}
            </div>
            <p className="mt-2 text-[11px] text-[#7a7a7a]">{t('planner.modalUtcHint')}</p>
            <nav className="mt-4 flex gap-1 border-b border-[#3d3d3d]" aria-label={t('planner.modalTabsAria')}>
              <button
                type="button"
                className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  modalTab === 'general'
                    ? 'border-[#5b5fc7] text-white'
                    : 'border-transparent text-[#9a9a9a] hover:text-[#d0d0d0]'
                }`}
                onClick={() => setModalTab('general')}
              >
                {t('planner.modalTabGeneral')}
              </button>
              <button
                type="button"
                className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  modalTab === 'reminder'
                    ? 'border-[#5b5fc7] text-white'
                    : 'border-transparent text-[#9a9a9a] hover:text-[#d0d0d0]'
                }`}
                onClick={() => setModalTab('reminder')}
              >
                {t('planner.modalTabReminder')}
              </button>
            </nav>
            {modalTab === 'general' ? (
              <div className="mt-4">
                <label className="block text-xs font-semibold uppercase tracking-wide text-[#9a9a9a]">
                  {t('planner.fieldTitle')}
                  <input
                    className="mt-2 w-full border border-[#555] bg-[#1a1a1a] px-3 py-2.5 text-sm text-white outline-none ring-0 transition-colors focus:border-[#5b5fc7]"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEvent();
                      if (e.key === 'Escape') closeModal();
                    }}
                  />
                </label>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-[#9a9a9a]">
                    {t('planner.fieldStart')}
                    <input
                      type="time"
                      step={60}
                      className="mt-2 w-full border border-[#555] bg-[#1a1a1a] px-2 py-2 text-sm text-white outline-none focus:border-[#5b5fc7]"
                      value={formatTimeHm(modal.start)}
                      onChange={(e) => {
                        const ns = applyTimeHmOnSameDay(modal.start, e.target.value);
                        setModal((prev) => (prev ? { ...prev, start: ns } : { start: ns }));
                      }}
                    />
                  </label>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-[#9a9a9a]">
                    {t('planner.fieldEnd')}
                    <input
                      type="time"
                      step={60}
                      className="mt-2 w-full border border-[#555] bg-[#1a1a1a] px-2 py-2 text-sm text-white outline-none focus:border-[#5b5fc7]"
                      value={formatTimeHm(new Date(modal.start.getTime() + durationMinutes * 60000))}
                      onChange={(e) => {
                        const end = applyTimeHmOnSameDay(modal.start, e.target.value);
                        let diff = Math.round((end.getTime() - modal.start.getTime()) / 60000);
                        if (!Number.isFinite(diff) || diff < 1) diff = 1;
                        if (diff > 24 * 60) diff = 24 * 60;
                        setDurationMinutes(diff);
                        setPreviewDuration(diff);
                      }}
                    />
                  </label>
                </div>
                <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[#9a9a9a]">
                  {t('planner.fieldDuration')}
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    step={1}
                    className="mt-2 w-full border border-[#555] bg-[#1a1a1a] px-3 py-2.5 text-sm text-white outline-none focus:border-[#5b5fc7]"
                    value={durationMinutes}
                    onChange={(e) => {
                      let v = parseInt(e.target.value, 10);
                      if (!Number.isFinite(v)) v = 1;
                      v = Math.max(1, Math.min(1440, v));
                      setDurationMinutes(v);
                      setPreviewDuration(v);
                    }}
                  />
                </label>
              </div>
            ) : (
              <div className="mt-4">
                <label className="block text-xs font-semibold uppercase tracking-wide text-[#9a9a9a]">
                  {t('planner.reminderBodyLabel')}
                  <textarea
                    className="mt-2 min-h-[180px] w-full resize-y border border-[#555] bg-[#1a1a1a] px-3 py-2.5 text-sm text-white outline-none focus:border-[#5b5fc7]"
                    placeholder={t('planner.reminderBodyPlaceholder')}
                    value={reminderBodyTemplate}
                    onChange={(e) => setReminderBodyTemplate(e.target.value)}
                    maxLength={4096}
                    spellCheck={false}
                    aria-describedby="reminder-body-help"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') closeModal();
                    }}
                  />
                </label>
                <p id="reminder-body-help" className="mt-2 text-[11px] leading-relaxed text-[#6a6a6a]">
                  {t('planner.reminderBodyHelp')}
                </p>
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2 border-t border-[#383838] pt-5">
              <button
                type="button"
                className="rounded-md px-4 py-2 text-sm font-medium text-[#e0e0e0] hover:bg-[#323232]"
                onClick={closeModal}
              >
                {t('planner.cancel')}
              </button>
              <button
                type="button"
                className="rounded-md bg-[#5b5fc7] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#4c50b0]"
                onClick={saveEvent}
              >
                {t('planner.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
