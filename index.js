// Chat Name Swap
// Per-chat temporary override of the global {{user}} / {{char}} macros.
// - Per-chat storage (chatMetadata), saved name presets (extensionSettings)
// - Heart button in the input bar -> mini popup
// - Group chat: one {{char}} override per member

const MODULE = 'chat_name_swap';
const HEART_ID = 'cns_heart';
const POPUP_ID = 'cns_popup';

const ctx = () => SillyTavern.getContext();

/* ------------------------------------------------------------------ */
/* Saved presets (global)                                              */
/* ------------------------------------------------------------------ */

function getSettings() {
    const { extensionSettings } = ctx();
    if (!extensionSettings[MODULE]) extensionSettings[MODULE] = {};
    const s = extensionSettings[MODULE];
    if (!Array.isArray(s.userPresets)) s.userPresets = [];
    if (!Array.isArray(s.charPresets)) s.charPresets = [];
    return s;
}

function saveSettings() {
    ctx().saveSettingsDebounced();
}

/* ------------------------------------------------------------------ */
/* Per-chat data                                                       */
/* ------------------------------------------------------------------ */

// Read-only view. Never creates anything in chatMetadata.
function readChat() {
    const m = ctx().chatMetadata?.[MODULE];
    return { user: m?.user || '', chars: m?.chars || {} };
}

// chars is keyed by the ORIGINAL character name.
async function writeChat(mutator) {
    const c = ctx();
    const meta = c.chatMetadata;
    if (!meta) return;
    const data = meta[MODULE] ?? (meta[MODULE] = { user: '', chars: {} });
    if (!data.chars) data.chars = {};
    mutator(data);
    if (!data.user && Object.keys(data.chars).length === 0) delete meta[MODULE];
    try { await c.saveMetadata(); } catch (e) { console.warn(`[${MODULE}] saveMetadata failed`, e); }
    syncMacros();
    refreshUI();
    verifyOverride();
}

function isActive() {
    const d = readChat();
    return !!d.user || Object.keys(d.chars).length > 0;
}

/* ------------------------------------------------------------------ */
/* Macro override                                                      */
/* ------------------------------------------------------------------ */

// Macros are registered the first time a chat needs an override and are then
// kept registered. They are NEVER unregistered: on some ST versions that would
// delete the built-in {{user}} / {{char}} too. With no override set, the
// handlers simply return the original names.
const registered = { user: false, char: false };

function userHandler() {
    return readChat().user || ctx().name1;
}

function charHandler() {
    const name2 = ctx().name2;
    return readChat().chars[name2] || name2;
}

function setMacro(key, on, fn) {
    if (!on || registered[key]) return;
    try {
        ctx().registerMacro(key, fn);
        registered[key] = true;
    } catch (e) {
        console.error(`[${MODULE}] macro ${key} failed`, e);
        toastr.error(`{{${key}}} 매크로 등록 실패 (F12 콘솔 확인)`);
    }
}

function syncMacros() {
    const d = readChat();
    setMacro('user', !!d.user, userHandler);
    setMacro('char', Object.keys(d.chars).length > 0, charHandler);
}

// Warn once if this ST version ignores the override.
let warned = false;
function verifyOverride() {
    if (warned) return;
    const c = ctx();
    const d = readChat();
    try {
        const badUser = d.user && c.substituteParams('{{user}}') !== d.user;
        const wanted = d.chars[c.name2];
        const badChar = wanted && c.substituteParams('{{char}}') !== wanted;
        if (badUser || badChar) {
            warned = true;
            toastr.warning('이 ST 버전에서는 매크로 덮어쓰기가 적용되지 않는 것 같아요. (F12 콘솔 확인)');
        }
    } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') el.value = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
}

// Names of the characters whose {{char}} can be overridden in this chat.
function getCharNames() {
    const c = ctx();
    if (c.groupId) {
        const g = (c.groups || []).find(x => String(x.id) === String(c.groupId));
        const names = (g?.members || [])
            .map(av => c.characters.find(ch => ch.avatar === av)?.name)
            .filter(Boolean);
        if (names.length) return names;
    }
    return c.name2 ? [c.name2] : [];
}

/* ------------------------------------------------------------------ */
/* Popup UI                                                            */
/* ------------------------------------------------------------------ */

function buildStatus() {
    const c = ctx();
    const d = readChat();
    const box = h('div', { class: 'cns-status' }, h('div', { class: 'cns-status-title', text: '현재 설정' }));
    const line = (macro, now, orig) => h('div', { class: 'cns-status-line' },
        h('span', { class: 'cns-macro', text: macro }), ' → ',
        h('b', { text: now || orig }),
        now ? '' : h('span', { class: 'cns-macro', text: ' (기본)' }),
    );
    box.append(line('{{user}}', d.user, c.name1));
    const names = getCharNames();
    if (names.length === 0) {
        box.append(h('div', { class: 'cns-status-line', text: '{{char}}: 채팅을 먼저 열어주세요' }));
    }
    for (const n of names) {
        const label = names.length > 1 ? `{{char}} [${n}]` : '{{char}}';
        box.append(line(label, d.chars[n], n));
    }
    return box;
}

function buildRow(kind, orig, label) {
    const c = ctx();
    const s = getSettings();
    const list = kind === 'user' ? s.userPresets : s.charPresets;
    const d = readChat();
    const current = kind === 'user' ? d.user : (d.chars[orig] || '');
    const defaultName = kind === 'user' ? c.name1 : orig;

    const commit = (value) => {
        const v = String(value ?? '').trim();
        writeChat((data) => {
            if (kind === 'user') data.user = v;
            else if (v) data.chars[orig] = v;
            else delete data.chars[orig];
        });
    };

    const input = h('input', {
        class: 'text_pole cns-input',
        type: 'text',
        placeholder: `기본: ${defaultName}`,
        value: current,
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(input.value); } },
    });

    const select = h('select', { class: 'text_pole cns-select' });
    select.append(h('option', { value: '', text: '프리셋 선택…' }));
    for (const p of list) select.append(h('option', { value: p, text: p }));
    select.value = list.includes(current) ? current : '';
    select.addEventListener('change', () => {
        if (!select.value) return;
        input.value = select.value;
        commit(select.value);
    });

    const applyBtn = h('div', { class: 'cns-btn', title: '적용', text: '✓', onclick: () => commit(input.value) });

    const saveBtn = h('div', {
        class: 'cns-btn', title: '현재 입력값을 프리셋으로 저장', text: '💾',
        onclick: () => {
            const v = input.value.trim();
            if (!v) return toastr.info('저장할 이름을 입력해주세요');
            if (!list.includes(v)) { list.push(v); saveSettings(); }
            renderPopup();
        },
    });

    const delBtn = h('div', {
        class: 'cns-btn', title: '선택한 프리셋 삭제', text: '🗑',
        onclick: () => {
            if (!select.value) return toastr.info('삭제할 프리셋을 먼저 선택해주세요');
            const i = list.indexOf(select.value);
            if (i >= 0) { list.splice(i, 1); saveSettings(); }
            renderPopup();
        },
    });

    return h('div', { class: 'cns-section' },
        h('div', { class: 'cns-label' }, h('span', { class: 'cns-macro', text: label }), kind === 'user' ? `(원래: ${defaultName})` : ''),
        h('div', { class: 'cns-line' }, input, applyBtn),
        h('div', { class: 'cns-line' }, select, saveBtn, delBtn),
    );
}

function renderPopup() {
    const body = document.getElementById('cns_body');
    if (!body) return;
    body.replaceChildren();
    body.append(buildStatus());
    body.append(buildRow('user', null, '{{user}}'));

    const names = getCharNames();
    if (names.length === 0) {
        body.append(h('div', { class: 'cns-empty', text: '캐릭터/그룹 채팅을 열면 {{char}}도 바꿀 수 있어요.' }));
    }
    for (const n of names) {
        body.append(buildRow('char', n, names.length > 1 ? `{{char}} [${n}]` : '{{char}}'));
    }

    body.append(h('div', { class: 'cns-foot' },
        h('div', {
            class: 'cns-btn', text: '전체 초기화',
            onclick: () => writeChat((data) => { data.user = ''; data.chars = {}; }),
        }),
    ));
}

function buildPopup() {
    if (document.getElementById(POPUP_ID)) return;
    const popup = h('div', { id: POPUP_ID, class: 'cns-popup', style: 'display:none' },
        h('div', { class: 'cns-head' },
            h('span', { text: '💗 이 채팅 이름 바꾸기' }),
            h('span', { class: 'cns-close', text: '✕', onclick: closePopup }),
        ),
        h('div', { id: 'cns_body' }),
    );
    document.body.append(popup);

    document.addEventListener('pointerdown', (e) => {
        if (popup.style.display === 'none') return;
        if (popup.contains(e.target) || e.target.closest(`#${HEART_ID}`)) return;
        closePopup();
    });
    window.addEventListener('resize', () => { if (popup.style.display !== 'none') positionPopup(); });
}

function isMobileLayout() {
    try {
        return window.matchMedia('(max-width: 800px), (pointer: coarse)').matches;
    } catch (e) {
        return window.innerWidth <= 800;
    }
}

function positionPopup() {
    const popup = document.getElementById(POPUP_ID);
    const heart = document.getElementById(HEART_ID);
    if (!popup || !heart) return;

    if (isMobileLayout()) {
        // Phones: centered near the top of the visible area. Independent of the
        // heart position, so the on-screen keyboard / zoom cannot push it off-screen.
        const vv = window.visualViewport;
        const vh = vv ? vv.height : window.innerHeight;
        const top = (vv ? vv.offsetTop : 0) + 12;
        popup.style.left = '50%';
        popup.style.transform = 'translateX(-50%)';
        popup.style.bottom = 'auto';
        popup.style.top = `${top}px`;
        popup.style.maxHeight = `${Math.round(vh * 0.8)}px`;
        return;
    }

    // Desktop: above the heart button.
    const r = heart.getBoundingClientRect();
    const w = popup.offsetWidth || 310;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    popup.style.transform = '';
    popup.style.top = 'auto';
    popup.style.left = `${left}px`;
    popup.style.bottom = `${window.innerHeight - r.top + 8}px`;
    popup.style.maxHeight = `${Math.max(160, r.top - 16)}px`;
}

function openPopup() {
    const popup = document.getElementById(POPUP_ID);
    if (!popup) return;
    try {
        if (isMobileLayout()) document.activeElement?.blur?.(); // close the keyboard
        renderPopup();
        popup.style.display = 'block';
        positionPopup();
    } catch (e) {
        console.error(`[${MODULE}] open popup failed`, e);
        toastr.error(`팝업 열기 실패: ${e?.message || e}`);
    }
}

function closePopup() {
    const popup = document.getElementById(POPUP_ID);
    if (popup) popup.style.display = 'none';
}

function togglePopup() {
    const popup = document.getElementById(POPUP_ID);
    if (!popup) return;
    if (popup.style.display === 'none') openPopup(); else closePopup();
}

/* ------------------------------------------------------------------ */
/* Heart button                                                        */
/* ------------------------------------------------------------------ */

// Tap handling: listen in the capture phase on the document so nothing in ST's
// mobile UI can swallow the event, and de-duplicate (one tap fires pointerup,
// touchend and click in a row on phones).
let lastToggle = 0;
let heartEventsBound = false;

function onHeartActivate(e) {
    const t = e.target;
    if (!t || !t.closest || !t.closest(`#${HEART_ID}`)) return;
    if (e.type === 'pointerup' && e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;

    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    if (now - lastToggle < 450) return;
    lastToggle = now;
    togglePopup();
}

function bindHeartEvents() {
    if (heartEventsBound) return;
    heartEventsBound = true;
    for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
        document.addEventListener(type, onHeartActivate, true);
    }
}

function mountHeart() {
    if (document.getElementById(HEART_ID)) return true;
    const host = document.getElementById('leftSendForm') || document.getElementById('send_form');
    if (!host) return false;
    const heart = h('div', {
        id: HEART_ID,
        class: 'fa-solid fa-fw fa-heart interactable cns-heart',
        tabindex: '0',
        role: 'button',
        title: '이름 바꾸기',
    });
    host.append(heart);
    bindHeartEvents();
    return true;
}

function refreshUI() {
    const heart = document.getElementById(HEART_ID);
    if (heart) {
        const d = readChat();
        heart.classList.toggle('cns-active', isActive());
        const parts = [];
        if (d.user) parts.push(`{{user}} → ${d.user}`);
        for (const [orig, now] of Object.entries(d.chars)) parts.push(`{{char}}(${orig}) → ${now}`);
        heart.title = parts.length ? parts.join(' / ') : '이름 바꾸기';
    }
    const popup = document.getElementById(POPUP_ID);
    if (popup && popup.style.display !== 'none') renderPopup();
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

let started = false;
function start() {
    if (started) return;
    if (!mountHeart()) return;
    started = true;
    buildPopup();
    syncMacros();
    refreshUI();
}

(function init() {
    const { eventSource, event_types } = ctx();

    eventSource.on(event_types.CHAT_CHANGED, () => {
        closePopup();
        start();
        syncMacros();
        refreshUI();
    });
    eventSource.on(event_types.APP_READY, start);

    // In case the DOM is already ready, retry a few times.
    let tries = 0;
    const timer = setInterval(() => {
        start();
        if (started || ++tries > 40) clearInterval(timer);
    }, 500);
})();
