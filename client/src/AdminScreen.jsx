import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from './i18n/I18nProvider.jsx';

const DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';

function legacyReminderTextFromEmbed(embed) {
  if (!embed || typeof embed !== 'object') return '';
  const parts = [];
  if (embed.title) parts.push(String(embed.title));
  if (embed.description) parts.push(String(embed.description));
  if (embed.footer && embed.footer.text) parts.push(String(embed.footer.text));
  return parts.join('\n\n');
}

/** Aperçu embed Discord (auteur + logo + texte) + boutons RSVP. */
function ReminderMessagePreview({ reminderText, embed, buttonLabels }) {
  const { t } = useI18n();
  const author = embed && typeof embed === 'object' ? embed.author : null;
  const iconUrl =
    author && author.icon_url
      ? String(author.icon_url)
      : author && author.name
        ? '/branding/firelegends-logo.png'
        : '';
  const bodyText =
    (reminderText && String(reminderText)) ||
    (embed && typeof embed.description === 'string' ? embed.description : '') ||
    '';

  return (
    <div className="overflow-hidden rounded-lg border border-[#2d2f33] bg-[#313338] text-left shadow-xl">
      <div className="border-l-[4px] border-[#5865f2] p-3 pl-3.5">
        {author && author.name ? (
          <div className="mb-3 flex items-center gap-2.5">
            {iconUrl ? (
              <img
                src={iconUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded-full border border-[#1e1f22] bg-[#1e1f22] object-cover"
                width={40}
                height={40}
              />
            ) : null}
            <span className="text-[15px] font-semibold text-white">{author.name}</span>
          </div>
        ) : null}
        <div className="min-h-[3rem] whitespace-pre-wrap text-[13px] leading-relaxed text-[#dbdee1]">
          {bodyText ? (
            bodyText
          ) : (
            <span className="italic text-[#949ba4]">{t('admin.previewEmpty')}</span>
          )}
        </div>
      </div>
      {buttonLabels?.length ? (
        <div className="flex flex-wrap gap-2 border-t border-[#1e1f22] bg-[#2b2d31] px-3 py-2.5">
          {buttonLabels.map((label) => (
            <span
              key={label}
              className="rounded-md bg-[#4e5058]/80 px-2.5 py-1 text-[12px] font-medium text-[#f2f3f5]"
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatEventOptionLabel(ev, dateLocale) {
  const when = new Date(ev.datetime).toLocaleString(dateLocale, {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${ev.title} — ${when} UTC`;
}

export function AdminScreen() {
  const { t, dateLocale } = useI18n();
  const [csrf, setCsrf] = useState('');
  const [guildId, setGuildId] = useState('');
  const [userIds, setUserIds] = useState([]);
  const [editors, setEditors] = useState([]);
  const [newId, setNewId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [adminTab, setAdminTab] = useState('general');
  const [reminderPreview, setReminderPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [previewEvents, setPreviewEvents] = useState([]);
  const [previewEventsLoading, setPreviewEventsLoading] = useState(false);
  const [selectedPreviewEventId, setSelectedPreviewEventId] = useState('');

  const load = useCallback(async () => {
    const boot = await fetch('/api/bootstrap', { credentials: 'include' });
    if (!boot.ok) {
      if (boot.status === 401) {
        window.location.href = '/login';
        return;
      }
      throw new Error(t('admin.sessionInvalid'));
    }
    const b = await boot.json();
    setCsrf(b.csrfToken || '');
    const gid = b.guild?.id || '';
    setGuildId(gid);
    if (!b.plannerAdmin) {
      setCanEdit(false);
      setError(t('admin.forbidden'));
      return;
    }
    const q = gid ? `?guild_id=${encodeURIComponent(gid)}` : '';
    const res = await fetch(`/api/admin/planner-editors${q}`, {
      credentials: 'include',
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || t('admin.loadFailed'));
    }
    const data = await res.json();
    const ids = Array.isArray(data.userIds) ? data.userIds : [];
    setUserIds(ids);
    if (Array.isArray(data.editors)) {
      setEditors(data.editors);
    } else {
      setEditors(
        ids.map((userId) => ({
          userId,
          username: null,
          globalName: null,
          displayName: null,
          avatarUrl: null,
        }))
      );
    }
    setCanEdit(true);
    setError('');
  }, [t]);

  const loadReminderPreview = useCallback(async (gid, eventIdStr = '') => {
    if (!gid) {
      setReminderPreview(null);
      setPreviewError('');
      return;
    }
    setPreviewError('');
    try {
      let qs = `?guild_id=${encodeURIComponent(gid)}`;
      if (eventIdStr) qs += `&event_id=${encodeURIComponent(eventIdStr)}`;
      const res = await fetch(`/api/admin/event-reminder-preview${qs}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const raw = await res.text();
      let j = {};
      if (raw) {
        try {
          j = JSON.parse(raw);
        } catch {
          j = { error: raw.trim().slice(0, 280) || `HTTP ${res.status}` };
        }
      }
      if (!res.ok) {
        setReminderPreview(null);
        setPreviewError(
          j.error ||
            (res.status === 404 ? t('admin.previewRoute404') : t('admin.previewHttp', { status: res.status }))
        );
        return;
      }
      const text =
        (typeof j.reminderText === 'string' && j.reminderText) ||
        (typeof j.content === 'string' && j.content) ||
        legacyReminderTextFromEmbed(j.embed);
      setReminderPreview({
        reminderText: text || '',
        embed: j.embed && typeof j.embed === 'object' ? j.embed : null,
        offsetMinutes: j.offsetMinutes,
        reminderMinutes: j.reminderMinutes,
        buttonLabels: j.buttonLabels,
      });
    } catch {
      setReminderPreview(null);
      setPreviewError(t('admin.previewNetwork'));
    }
  }, [t]);

  const loadPreviewEventList = useCallback(async (gid) => {
    if (!gid) {
      setPreviewEvents([]);
      return;
    }
    setPreviewEventsLoading(true);
    try {
      const res = await fetch(`/api/events?guild_id=${encodeURIComponent(gid)}`, { credentials: 'include' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreviewEvents([]);
        return;
      }
      const list = Array.isArray(j.events) ? j.events : [];
      const sorted = [...list].sort((a, b) => a.datetime - b.datetime);
      setPreviewEvents(sorted);
    } catch {
      setPreviewEvents([]);
    } finally {
      setPreviewEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError('');
        await load();
      } catch (e) {
        if (alive) setError(e.message || t('planner.errorGeneric'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [load, t]);

  useEffect(() => {
    if (!canEdit || !guildId || adminTab !== 'preview') return;
    loadPreviewEventList(guildId);
  }, [canEdit, guildId, adminTab, loadPreviewEventList]);

  useEffect(() => {
    if (!canEdit || !guildId || adminTab !== 'preview') return;
    loadReminderPreview(guildId, selectedPreviewEventId);
  }, [canEdit, guildId, adminTab, selectedPreviewEventId, loadReminderPreview]);

  const addMember = async () => {
    const id = newId.trim();
    if (!/^\d{17,21}$/.test(id)) {
      setInfo('');
      setError(t('admin.invalidSnowflake'));
      return;
    }
    setError('');
    setInfo('');
    const res = await fetch('/api/admin/planner-editors', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrf,
      },
      body: JSON.stringify({ user_id: id, guild_id: guildId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || t('admin.addFailed'));
      return;
    }
    const data = await res.json();
    setUserIds(Array.isArray(data.userIds) ? data.userIds : []);
    if (Array.isArray(data.editors)) setEditors(data.editors);
    setNewId('');
    setInfo(t('admin.memberAdded'));
  };

  const sendDiscordTest = async () => {
    if (!guildId) {
      setTestMsg('');
      setError(t('admin.noGuildTest'));
      return;
    }
    setError('');
    setInfo('');
    setTestMsg('');
    setTestSending(true);
    try {
      const res = await fetch('/api/admin/test-discord-message', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrf,
        },
        body: JSON.stringify({ guild_id: guildId }),
      });
      const raw = await res.text();
      let j = {};
      if (raw) {
        try {
          j = JSON.parse(raw);
        } catch {
          j = { error: raw.trim().slice(0, 400) || `Réponse HTTP ${res.status} (non JSON).` };
        }
      }
      const fromValidator =
        Array.isArray(j.errors) && j.errors.length
          ? j.errors.map((e) => e.msg || e.message || String(e)).join(' · ')
          : '';
      const apiErr = j.error || j.message || fromValidator;
      if (!res.ok) {
        setError(
          apiErr ||
            (raw
              ? `HTTP ${res.status}`
              : `HTTP ${res.status} (corps vide). Redémarrez le serveur avec la dernière version du code si la route est absente.`)
        );
        return;
      }
      setTestMsg(t('admin.discordTestOk'));
    } catch {
      setError(t('admin.networkError'));
    } finally {
      setTestSending(false);
    }
  };

  const removeMember = async (uid) => {
    setError('');
    setInfo('');
    const qs = new URLSearchParams({ guild_id: guildId });
    const res = await fetch(`/api/admin/planner-editors/${uid}?${qs}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'x-csrf-token': csrf },
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || t('admin.removeFailed'));
      return;
    }
    setUserIds((prev) => prev.filter((x) => x !== uid));
    setEditors((prev) => prev.filter((e) => e.userId !== uid));
    setInfo(t('admin.memberRemoved'));
  };

  const displayNameFor = (e) =>
    e.displayName || e.globalName || (e.username ? `@${e.username}` : null) || t('admin.editorUnknown');

  return (
    <div className="min-h-full bg-[#1a1a1a] font-sans text-[#f3f3f3]">
      <header className="flex items-center justify-between border-b border-[#3d3d3d] px-4 py-3">
        <h1 className="text-lg font-semibold">{t('admin.title')}</h1>
        <a
          href="/"
          className="rounded-md border border-[#555] px-3 py-1.5 text-sm text-[#e0e0e0] hover:bg-[#323232]"
        >
          {t('admin.backPlanner')}
        </a>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        {loading ? <p className="text-sm text-[#888]">{t('admin.loading')}</p> : null}

        {error ? (
          <div className="mt-4 rounded-md border border-[#c4314b]/40 bg-[#442726] px-3 py-2 text-sm text-[#ffb3b0]">
            {error}
          </div>
        ) : null}

        {info ? (
          <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
            {info}
          </div>
        ) : null}

        {!loading && canEdit ? (
          <>
            <nav className="mt-2 flex gap-1 border-b border-[#3d3d3d]">
              <button
                type="button"
                className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  adminTab === 'general'
                    ? 'border-[#5b5fc7] text-white'
                    : 'border-transparent text-[#9a9a9a] hover:text-[#d0d0d0]'
                }`}
                onClick={() => setAdminTab('general')}
              >
                {t('admin.tabGeneral')}
              </button>
              <button
                type="button"
                className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  adminTab === 'preview'
                    ? 'border-[#5b5fc7] text-white'
                    : 'border-transparent text-[#9a9a9a] hover:text-[#d0d0d0]'
                }`}
                onClick={() => {
                  setAdminTab('preview');
                  setSelectedPreviewEventId('');
                }}
              >
                {t('admin.tabPreview')}
              </button>
            </nav>

            {adminTab === 'general' ? (
              <div className="mt-6">
                <p className="text-sm leading-relaxed text-[#a8a8a8]">{t('admin.intro')}</p>

                <h2 className="mb-2 mt-10 text-sm font-semibold text-[#d0d0d0]">{t('admin.editorsTitle')}</h2>
                <div className="flex gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-md border border-[#555] bg-[#252525] px-3 py-2 font-mono text-sm text-white outline-none focus:border-[#5b5fc7]"
                    placeholder={t('admin.editorPlaceholder')}
                    value={newId}
                    onChange={(e) => setNewId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addMember();
                    }}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-md bg-[#5b5fc7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4c50b0]"
                    onClick={addMember}
                  >
                    {t('admin.add')}
                  </button>
                </div>

                <ul className="mt-6 divide-y divide-[#383838] rounded-md border border-[#454545] bg-[#252525]">
                  {userIds.length === 0 ? (
                    <li className="px-3 py-4 text-sm text-[#888]">
                      {t('admin.editorEmpty')}
                    </li>
                  ) : (
                    userIds.map((id) => {
                      const e = editors.find((x) => x.userId === id) || {
                        userId: id,
                        username: null,
                        globalName: null,
                        displayName: null,
                        avatarUrl: null,
                      };
                      return (
                        <li key={e.userId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <img
                              src={e.avatarUrl || DEFAULT_AVATAR}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-full bg-[#1a1a1a] object-cover ring-1 ring-white/10"
                              width={40}
                              height={40}
                            />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-[#f0f0f0]">{displayNameFor(e)}</div>
                              <div className="truncate text-xs text-[#8a8a8a]">
                                {e.username ? (
                                  <span className="text-[#b0b0b0]">@{e.username}</span>
                                ) : (
                                  <span className="italic text-[#666]">{t('admin.editorUnresolved')}</span>
                                )}
                                <span className="mx-1.5 text-[#555]">·</span>
                                <span className="font-mono text-[11px] text-[#9a9a9a]">{e.userId}</span>
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="shrink-0 rounded px-2 py-1 text-xs text-[#f1707b] hover:bg-[#3a2a2a]"
                            onClick={() => removeMember(e.userId)}
                          >
                            {t('admin.remove')}
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>

                <section className="mt-10 rounded-lg border border-[#454545] bg-[#222] p-4">
                  <h2 className="text-sm font-semibold text-[#ececec]">{t('admin.discordTitle')}</h2>
                  <p className="mt-1 text-xs leading-relaxed text-[#9a9a9a]">{t('admin.discordTestHelp')}</p>
                  <button
                    type="button"
                    disabled={testSending || !guildId}
                    className="mt-3 rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_20px_rgba(124,58,237,0.25)] hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={sendDiscordTest}
                  >
                    {testSending ? t('admin.discordTestSending') : t('admin.discordTestBtn')}
                  </button>
                  {testMsg ? <p className="mt-2 text-xs text-emerald-200/90">{testMsg}</p> : null}
                </section>
              </div>
            ) : (
              <div className="mt-6">
                <section className="rounded-lg border border-[#454545] bg-[#222] p-4">
                  <h2 className="text-sm font-semibold text-[#ececec]">{t('admin.previewSectionTitle')}</h2>
                  <p className="mt-1 text-xs leading-relaxed text-[#9a9a9a]">{t('admin.previewSectionHelp')}</p>
                  <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[#9a9a9a]">
                    {t('admin.previewEventLabel')}
                    <select
                      className="mt-2 w-full rounded-md border border-[#555] bg-[#1a1a1a] px-3 py-2.5 text-sm text-white outline-none focus:border-[#5b5fc7]"
                      value={selectedPreviewEventId}
                      onChange={(e) => setSelectedPreviewEventId(e.target.value)}
                      disabled={previewEventsLoading}
                    >
                      <option value="">{t('admin.previewSampleOption')}</option>
                      {previewEvents.map((ev) => (
                        <option key={ev.id} value={String(ev.id)}>
                          {formatEventOptionLabel(ev, dateLocale)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {previewEventsLoading ? (
                    <p className="mt-3 text-xs text-[#888]">{t('admin.previewLoadingList')}</p>
                  ) : null}
                  {previewError ? (
                    <p className="mt-4 text-xs text-[#f1707b]">{previewError}</p>
                  ) : reminderPreview ? (
                    <div className="mt-5">
                      <ReminderMessagePreview
                        reminderText={reminderPreview.reminderText}
                        embed={reminderPreview.embed}
                        buttonLabels={reminderPreview.buttonLabels}
                      />
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-[#888]">{t('admin.previewLoading')}</p>
                  )}
                </section>
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
