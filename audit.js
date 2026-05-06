// audit.js — Лид-магнит «Бесплатный аудит резюме»
// v4.3 — фиксы по фидбеку фаундера:
//        • при заходе на /audit/ без id — авто-редирект на свой live-аудит
//          (через localStorage → fallback на /api/audit/my-latest по cookie);
//          это защищает от потери результата при «Назад» из формы регистрации;
//        • квота — 3 попытки на (owner_token + email), 409 audit_limit_reached
//          с заглушкой и CTA в кабинет Авроры;
//        • soft-delete: «Удалить» теперь снимает аудит с сайта, но запись
//          остаётся в БД для подсчёта квоты (закрывает обход «удалил → могу снова»);
//        • после удаления — возврат на upload-экран (не «отчёт недоступен»),
//          чтобы не пугать юзера, который сам только что удалил;
//        • визуальный tooltip над корзиной + поясняющий текст;
//        • aurora-happy: вернули --aurora-height: 128%.

function apiBase() {
    if (window.AuroraSession && typeof window.AuroraSession.getApiBase === 'function') {
        return window.AuroraSession.getApiBase();
    }
    return (window.location.hostname.includes('twc1.net') || window.location.hostname.includes('aurora-develop'))
        ? 'https://api.aurora-develop.ru'
        : 'https://api.aurora-career.ru';
}

// На dev-стенде ведём на главную aurora-develop.ru, на проде — на aurora-career.ru.
function getHomeUrl() {
    const h = window.location.hostname;
    if (h.includes('twc1.net') || h.includes('aurora-develop')) {
        return 'https://aurora-develop.ru/';
    }
    return 'https://aurora-career.ru/';
}

const TURNSTILE_SITE_KEY = '0x4AAAAAAC2GxGcQ1mSylGca';

const AURORA_PORTRAITS = {
    greeting: 'audit/images/aurora/aurora-greeting.png',
    thinking: 'audit/images/aurora/aurora-thinking.png',
    happy:    'audit/images/aurora/aurora-happy.png',
    empathy:  'audit/images/aurora/aurora-empathy.png',
};

const MY_AUDITS_LS_KEY = 'aurora_my_audits';

let selectedFile = null;
let turnstileToken = null;
let userEmail = '';
let turnstileReady = false;
let _phaseTimer = null;
let _currentAudit = null; // { public_id, is_owner, is_shared, views_count, share_url }

// SEO-блок виден только когда показан #stepUpload (стартовый экран).
// На loading / result / loggedIn — скрываем, чтобы не «торчал» снизу при скролле.
function setSeoVisibility(visible) {
    const seo = document.getElementById('audit-seo');
    if (seo) seo.style.display = visible ? '' : 'none';
}

// ============================================================================
// MY AUDITS (localStorage) — резервный sticky-флаг владельца на случай,
// если cookie аудит-владельца была очищена (cookie остаётся источником истины).
// ============================================================================

function loadMyAudits() {
    try {
        const raw = localStorage.getItem(MY_AUDITS_LS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
}

function rememberMyAudit(publicId) {
    if (!publicId) return;
    const list = loadMyAudits();
    if (list.includes(publicId)) return;
    list.push(publicId);
    while (list.length > 50) list.shift(); // ограничиваем разбухание
    try { localStorage.setItem(MY_AUDITS_LS_KEY, JSON.stringify(list)); } catch (_) {}
}

function forgetMyAudit(publicId) {
    const list = loadMyAudits().filter(id => id !== publicId);
    try { localStorage.setItem(MY_AUDITS_LS_KEY, JSON.stringify(list)); } catch (_) {}
}

// ============================================================================
// INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(location.search);
    const auditId = params.get('id');

    if (auditId) {
        // Маршрут «открыть существующий аудит» — основной путь имеет приоритет
        // над всеми остальными (даже над checkLoggedInUser).
        bootstrapFromUrl(auditId);
        return;
    }

    // Авто-редирект «у меня уже есть свой live-аудит → открой его».
    // Это защищает от кейса: юзер случайно ушёл со страницы (back button,
    // случайный клик на лого) → возвращается на /audit/ → не теряет результат
    // и не запускает повторный анализ (что съест квоту в 3 попытки).
    const ownId = await findMyOwnLiveAudit();
    if (ownId) {
        try { history.replaceState({}, '', `?id=${encodeURIComponent(ownId)}`); } catch (_) {}
        bootstrapFromUrl(ownId);
        return;
    }

    await checkLoggedInUser();
    loadCounter();
    initDragDrop();
    initFileInput();
});

// Возвращает public_id живого аудита текущего пользователя, либо null.
// Источники: localStorage (быстро) → /api/audit/my-latest по cookie (фолбэк).
async function findMyOwnLiveAudit() {
    // 1) localStorage — пробуем последний (most recent) и идём вверх.
    const myList = loadMyAudits().slice().reverse();
    for (const id of myList) {
        try {
            const r = await fetch(
                `${apiBase()}/api/audit/${encodeURIComponent(id)}`,
                { method: 'GET', credentials: 'include' }
            );
            if (r.ok) {
                const data = await r.json().catch(() => null);
                // Доверяем только если это реально наш (owner). Если кто-то подсунул
                // чужой shared-id в localStorage — не редиректим.
                if (data && (data.is_owner === true)) return id;
            } else if (r.status === 404) {
                // Аудит мёртвый (удалён / истёк) — забываем его, идём дальше.
                forgetMyAudit(id);
            }
        } catch (_) { /* network — пропускаем, попробуем cookie-фолбэк */ }
    }

    // 2) Cookie-фолбэк: localStorage могло почиститься, но aurora_audit_owner
    //    cookie живёт 90 дней. Сервер сам найдёт последний аудит этого owner-а.
    try {
        const r = await fetch(`${apiBase()}/api/audit/my-latest`, {
            method: 'GET', credentials: 'include',
        });
        if (r.ok) {
            const data = await r.json().catch(() => null);
            if (data && data.public_id) {
                rememberMyAudit(data.public_id);
                return data.public_id;
            }
        }
    } catch (_) { /* fallthrough */ }

    return null;
}

async function checkLoggedInUser() {
    let r = await fetch(`${apiBase()}/api/auth/me`, { method: 'GET', credentials: 'include' });
    if (r.status === 401 && window.AuroraSession) {
        const ok = await AuroraSession.refreshNow();
        if (ok) {
            r = await fetch(`${apiBase()}/api/auth/me`, { method: 'GET', credentials: 'include' });
        }
    }
    if (!r.ok) return;
    const data = await r.json();
    if (data.status !== 'ok') return;
    document.getElementById('stepUpload').classList.add('hidden');
    document.getElementById('stepLoggedIn').classList.remove('hidden');
    setSeoVisibility(false);
}

function loadCounter() {
    fetch(`${apiBase()}/api/audit/counter`, { method: 'GET' })
        .then(r => { if (r.ok) return r.json(); throw new Error(r.status); })
        .then(data => {
            const el = document.getElementById('counterValue');
            if (el && data.total_audits) {
                el.textContent = data.total_audits.toLocaleString('ru-RU');
            }
        })
        .catch(() => {
            const el = document.getElementById('counterValue');
            if (el) el.textContent = '1 400+';
        });
}

// ============================================================================
// BOOTSTRAP FROM URL — открытие существующего аудита по public_id
// ============================================================================

async function bootstrapFromUrl(publicId) {
    // Сразу скрываем upload и SEO. Loading-экран показываем ОТЛОЖЕННО —
    // только если запрос идёт дольше 350мс. На быстрый ответ (или 404)
    // переключаемся напрямую на result/notfound — без моргания «Аврора думает».
    document.getElementById('stepUpload').classList.add('hidden');
    setSeoVisibility(false);

    let loaderShown = false;
    const loaderTimer = setTimeout(() => {
        loaderShown = true;
        showLoadingScreen({ phases: false, customText: 'Открываем ваш разбор…' });
    }, 350);

    const hideLoaderIfShown = () => {
        clearTimeout(loaderTimer);
        if (loaderShown) {
            stopLoadingPhases();
            document.getElementById('stepLoading').classList.add('hidden');
        }
    };

    try {
        const resp = await fetch(`${apiBase()}/api/audit/${encodeURIComponent(publicId)}`, {
            method: 'GET',
            credentials: 'include',
        });

        if (resp.status === 404) {
            hideLoaderIfShown();
            showNotFound();
            return;
        }

        if (!resp.ok) {
            // Для ошибки уместно показать «что-то пошло не так» поверх loading.
            if (!loaderShown) {
                showLoadingScreen({ phases: false, customText: 'Открываем ваш разбор…' });
            }
            stopLoadingPhases();
            showLoadingError('Не удалось загрузить отчёт. Попробуйте позже.');
            return;
        }

        const data = await resp.json();
        hideLoaderIfShown();

        // Если фронт «помнит» этот аудит локально — считаем владельцем
        // даже если сервер не отдал is_owner=true (на случай если cookie
        // ещё не подтвердилась из-за SameSite на новом домене).
        const localOwner = loadMyAudits().includes(data.public_id);
        const isOwner = !!data.is_owner || localOwner;

        showResult(data.result, null, {
            public_id: data.public_id,
            is_owner: isOwner,
            is_shared: !!data.is_shared,
            views_count: data.views_count || 0,
            share_url: data.share_url,
        });

    } catch (e) {
        if (!loaderShown) {
            showLoadingScreen({ phases: false, customText: 'Открываем ваш разбор…' });
        }
        stopLoadingPhases();
        showLoadingError('Ошибка сети. Проверьте соединение.');
    }
}

function showNotFound() {
    document.getElementById('stepUpload').classList.add('hidden');
    document.getElementById('stepLoading').classList.add('hidden');
    document.getElementById('stepResult').classList.add('hidden');
    setSeoVisibility(false);
    document.getElementById('stepNotFound').classList.remove('hidden');

    // Подставляем правильный домен (dev → aurora-develop.ru, prod → aurora-career.ru)
    const home = getHomeUrl();
    const brandLink = document.getElementById('notfoundBrandLink');
    const homeBtn = document.getElementById('notfoundHomeBtn');
    if (brandLink) brandLink.href = home;
    if (homeBtn) homeBtn.href = home;
}

// ============================================================================
// FILE UPLOAD
// ============================================================================

function initDragDrop() {
    const zone = document.getElementById('dropZone');
    if (!zone) return;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => { zone.classList.remove('dragover'); });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
}

function initFileInput() {
    const input = document.getElementById('fileInput');
    if (input) {
        input.addEventListener('change', () => {
            if (input.files.length) handleFile(input.files[0]);
        });
    }
}

function handleFile(file) {
    const errEl = document.getElementById('uploadError');
    const nameEl = document.getElementById('fileName');
    errEl.classList.add('hidden');

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx'].includes(ext)) {
        errEl.textContent = 'Поддерживаются только PDF и DOCX';
        errEl.classList.remove('hidden');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        errEl.textContent = 'Файл слишком большой (максимум 5 МБ)';
        errEl.classList.remove('hidden');
        return;
    }

    selectedFile = file;
    nameEl.textContent = file.name;
    nameEl.classList.remove('hidden');
    openEmailModal();
}

// ============================================================================
// EMAIL MODAL
// ============================================================================

function openEmailModal() {
    document.getElementById('emailModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('emailInput').focus(), 100);
    initTurnstile();
    initConsentCheckbox();
    updateSubmitButtonState();
}

function closeEmailModal() {
    document.getElementById('emailModal').classList.add('hidden');
}

function initTurnstile() {
    if (!TURNSTILE_SITE_KEY || turnstileReady) return;
    turnstileReady = true;
    updateSubmitButtonState();

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=renderTurnstile';
    script.async = true;
    document.head.appendChild(script);
}

window.renderTurnstile = function () {
    const container = document.getElementById('turnstileContainer');
    if (!container || !window.turnstile) return;
    window.turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'dark',
        callback: function (token) {
            turnstileToken = token;
            updateSubmitButtonState();
        },
    });
};

function initConsentCheckbox() {
    const cb = document.getElementById('auditConsentPrivacy');
    if (!cb || cb.dataset.bound === '1') return;
    cb.dataset.bound = '1';
    cb.addEventListener('change', () => {
        const errEl = document.getElementById('consentError');
        if (cb.checked && errEl) errEl.classList.add('hidden');
        updateSubmitButtonState();
    });
}

function updateSubmitButtonState() {
    const btn = document.getElementById('btnGetResult');
    if (!btn) return;
    const cb = document.getElementById('auditConsentPrivacy');
    const consentOk = !!(cb && cb.checked);
    const captchaOk = !TURNSTILE_SITE_KEY || !!turnstileToken;
    btn.disabled = !(consentOk && captchaOk);
}

// ============================================================================
// SUBMIT — сразу показывает loading, fetch идёт в фоне
// ============================================================================

async function submitAudit() {
    const emailInput = document.getElementById('emailInput');
    const emailErr = document.getElementById('emailError');
    const consentCb = document.getElementById('auditConsentPrivacy');
    const consentErr = document.getElementById('consentError');
    const btn = document.getElementById('btnGetResult');

    userEmail = emailInput.value.trim().toLowerCase();
    emailErr.classList.add('hidden');
    if (consentErr) consentErr.classList.add('hidden');

    if (!userEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
        emailErr.textContent = 'Введите корректный email';
        emailErr.classList.remove('hidden');
        return;
    }

    if (!consentCb || !consentCb.checked) {
        if (consentErr) consentErr.classList.remove('hidden');
        return;
    }

    btn.disabled = true;

    const privacyVersion = (window.AURORA_LEGAL_VERSIONS && window.AURORA_LEGAL_VERSIONS.privacy) || '';

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('email', userEmail);
    formData.append('consent_privacy', 'true');
    if (privacyVersion) formData.append('consent_privacy_version', privacyVersion);
    if (turnstileToken) formData.append('captcha_token', turnstileToken);

    closeEmailModal();
    showLoadingScreen();
    const startedAt = Date.now();

    const result = await fetchAuditWithRetry(formData, 2);

    // Минимум 8 с показа экрана «печатает» — только при успехе.
    if (result.type === 'success') {
        const elapsed = Date.now() - startedAt;
        const remain = LOADING_MIN_DURATION_MS - elapsed;
        if (remain > 0) await new Promise(r => setTimeout(r, remain));
    }

    stopLoadingPhases();

    if (result.type === 'conflict') {
        document.getElementById('stepLoading').classList.add('hidden');
        const code = result.data.error;
        if (code === 'audit_limit_reached') {
            showLimitReached(result.data);
        } else if (code === 'email_already_used') {
            // Backward-compat: старая версия бэка возвращала этот код.
            showAlreadyUsed(result.data);
        } else {
            showRegisteredEmail(result.data);
        }
        return;
    }

    if (result.type === 'error') {
        showLoadingError(result.message);
        return;
    }

    document.getElementById('stepLoading').classList.add('hidden');

    const publicId = result.data.public_id;
    if (publicId) {
        rememberMyAudit(publicId);
        // Меняем URL без перезагрузки — теперь рефреш не теряет результат.
        try { history.replaceState({}, '', `?id=${encodeURIComponent(publicId)}`); } catch (_) {}
    }

    showResult(result.data.result, result.data.total_audits, {
        public_id: publicId,
        is_owner: true,         // только что создал — точно владелец
        is_shared: false,
        views_count: 0,
        share_url: publicId
            ? `${location.origin}/audit/?id=${encodeURIComponent(publicId)}`
            : null,
    });
}

// ============================================================================
// FETCH С РЕТРАЯМИ
// ============================================================================

async function fetchAuditWithRetry(formData, maxRetries) {
    let lastError = 'Что-то пошло не так. Попробуйте позже.';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
            await new Promise(r => setTimeout(r, 2000));
        }

        try {
            const resp = await fetch(`${apiBase()}/api/audit/analyze`, {
                method: 'POST',
                body: formData,
                credentials: 'include', // нужно для приёма Set-Cookie aurora_audit_owner
            });

            let data = {};
            const rawText = await resp.text();
            try { data = rawText ? JSON.parse(rawText) : {}; } catch (_) { data = {}; }

            if (resp.status === 409) {
                return { type: 'conflict', data };
            }

            if (resp.status >= 400 && resp.status < 500) {
                return { type: 'error', message: data.detail || data.message || 'Произошла ошибка' };
            }

            if (!resp.ok) {
                lastError = data.detail || data.message || `Ошибка сервера (${resp.status})`;
                continue;
            }

            return { type: 'success', data };

        } catch (_) {
            lastError = 'Ошибка сети. Проверьте соединение.';
        }
    }

    return { type: 'error', message: lastError };
}

// ============================================================================
// LOADING SCREEN
// ============================================================================

const LOADING_PHASES = [
    'Анализирую структуру резюме...',
    'Проверяю ключевые слова для hh.ru...',
    'Оцениваю первое впечатление рекрутера...',
    'Готовлю рекомендации...',
];

const LOADING_MIN_DURATION_MS = 8000;

function showLoadingScreen(opts) {
    opts = opts || {};
    document.getElementById('stepUpload').classList.add('hidden');
    setSeoVisibility(false);
    const el = document.getElementById('stepLoading');
    el.classList.remove('hidden');

    const textEl = document.getElementById('loadingText');
    if (textEl) textEl.textContent = opts.customText || LOADING_PHASES[0];

    if (opts.phases === false) return; // bootstrap-режим без ротации фраз

    let idx = 0;
    const stepMs = Math.max(1500, Math.floor(LOADING_MIN_DURATION_MS / LOADING_PHASES.length));
    _phaseTimer = setInterval(() => {
        idx = (idx + 1) % LOADING_PHASES.length;
        if (!textEl) return;
        textEl.style.opacity = '0';
        setTimeout(() => {
            textEl.textContent = LOADING_PHASES[idx];
            textEl.style.opacity = '1';
        }, 200);
    }, stepMs);
}

function stopLoadingPhases() {
    if (_phaseTimer) {
        clearInterval(_phaseTimer);
        _phaseTimer = null;
    }
}

function showLoadingError(message) {
    const textEl = document.getElementById('loadingText');
    const errEl = document.getElementById('loadingError');
    const retryBtn = document.getElementById('loadingRetryBtn');
    const typingEl = document.getElementById('loadingTypingWrap');

    if (textEl) textEl.textContent = 'Что-то пошло не так';
    if (errEl) {
        errEl.textContent = message || 'Попробуйте позже';
        errEl.classList.remove('hidden');
    }
    if (retryBtn) retryBtn.classList.remove('hidden');
    if (typingEl) typingEl.classList.add('hidden');
}

function retryAudit() {
    disableStickyBar();
    selectedFile = null;
    turnstileToken = null;
    userEmail = '';
    turnstileReady = false;

    const consentCb = document.getElementById('auditConsentPrivacy');
    if (consentCb) consentCb.checked = false;
    const consentErr = document.getElementById('consentError');
    if (consentErr) consentErr.classList.add('hidden');

    document.getElementById('stepLoading').classList.add('hidden');
    document.getElementById('stepUpload').classList.remove('hidden');
    setSeoVisibility(true);

    const nameEl = document.getElementById('fileName');
    if (nameEl) { nameEl.textContent = ''; nameEl.classList.add('hidden'); }

    const errEl = document.getElementById('loadingError');
    if (errEl) errEl.classList.add('hidden');

    const retryBtn = document.getElementById('loadingRetryBtn');
    if (retryBtn) retryBtn.classList.add('hidden');

    const typingEl = document.getElementById('loadingTypingWrap');
    if (typingEl) typingEl.classList.remove('hidden');

    if (window.turnstile) {
        const container = document.getElementById('turnstileContainer');
        if (container) window.turnstile.remove(container);
    }
}

// ============================================================================
// RESULT
// ============================================================================

function showResult(result, totalAudits, opts) {
    opts = opts || { is_owner: true, is_shared: false, views_count: 0, public_id: null };
    _currentAudit = opts;

    document.getElementById('stepResult').classList.remove('hidden');
    setSeoVisibility(false);

    // Бренд-линк → главная (с учётом dev/prod)
    const brandLink = document.getElementById('resultBrandLink');
    if (brandLink) brandLink.href = getHomeUrl();

    applyGreeting(result, opts);

    // Аврора слева: happy если score >= 7, empathy иначе
    const portraitEl = document.getElementById('auroraPortraitResult');
    if (portraitEl) {
        const sNum = Number(result && result.score) || 0;
        portraitEl.src = sNum >= 7 ? AURORA_PORTRAITS.happy : AURORA_PORTRAITS.empathy;
    }

    document.getElementById('scoreValue').textContent = result.score || '?';
    document.getElementById('verdictText').textContent = result.verdict || '';

    const reactionEl = document.getElementById('scoreReaction');
    if (reactionEl) {
        const s = Number(result.score) || 0;
        let reaction = '';
        if (s >= 8) {
            reaction = 'Отличное резюме! Есть пара деталей, которые сделают его безупречным.';
        } else if (s >= 5) {
            reaction = 'Хорошая база, но несколько вещей мешают получать больше ответов.';
        } else if (s >= 1) {
            reaction = 'Не переживайте — есть конкретные причины, почему рекрутеры молчат. Это поправимо.';
        }
        reactionEl.textContent = reaction;
    }

    // Аккордеон «Первое впечатление рекрутера» — закрыт по умолчанию.
    if (result.recruiter_first_impression) {
        const block = document.getElementById('impressionBlock');
        block.classList.remove('hidden');
        block.open = false;
        document.getElementById('impressionText').textContent = result.recruiter_first_impression;
    }

    // Critical issues: набор аккордеонов, ВСЕ закрыты по умолчанию.
    // UX: «прогрессивное раскрытие» — пользователь сам выбирает что прочитать.
    const container = document.getElementById('issuesBlock');
    container.innerHTML = '';
    (result.critical_issues || []).forEach((issue) => {
        const card = document.createElement('details');
        card.className = 'result-accordion acc-warning';
        card.innerHTML = `
            <summary>
                <span class="acc-icon">
                    <span class="material-symbols-outlined">warning</span>
                </span>
                <span class="flex-1 min-w-0">
                    <span class="acc-title">${esc(issue.title || 'Критический момент')}</span>
                    ${issue.quote ? `<span class="acc-subtitle">«${esc(issue.quote)}»</span>` : ''}
                </span>
                <span class="material-symbols-outlined acc-chevron">expand_more</span>
            </summary>
            <div class="acc-body">
                ${issue.quote ? `<p class="acc-quote">«${esc(issue.quote)}»</p>` : ''}
                ${issue.why_it_hurts ? `<p>${esc(issue.why_it_hurts)}</p>` : ''}
                ${issue.fix ? `<p class="acc-fix">${esc(issue.fix)}</p>` : ''}
            </div>
        `;
        container.appendChild(card);
    });

    // Аккордеон «Алгоритм hh.ru» — закрыт по умолчанию.
    if (result.hh_algo_problems) {
        const block = document.getElementById('algoBlock');
        block.classList.remove('hidden');
        block.open = false;
        document.getElementById('algoText').textContent = result.hh_algo_problems;
    }

    if (totalAudits) {
        const el = document.getElementById('counterValue');
        if (el) el.textContent = totalAudits.toLocaleString('ru-RU');
    }

    applyOwnerVsViewer(opts);

    // На всякий: проскроллить контент-сайд в начало (после прежней сессии).
    const contentSide = document.querySelector('#stepResult .content-side');
    if (contentSide) contentSide.scrollTop = 0;
}

// ============================================================================
// GREETING (разные шапки для owner и viewer)
// ============================================================================

// Русское склонение слова «балл»: 1 балл / 2 балла / 5 баллов.
function pluralPoints(n) {
    n = Math.abs(Number(n) || 0);
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 14) return 'баллов';
    if (mod10 === 1) return 'балл';
    if (mod10 >= 2 && mod10 <= 4) return 'балла';
    return 'баллов';
}

// Русское склонение «критический момент»: 1 момент / 2 момента / 5 моментов.
function pluralIssues(n) {
    n = Math.abs(Number(n) || 0);
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 14) return 'критических моментов';
    if (mod10 === 1) return 'критический момент';
    if (mod10 >= 2 && mod10 <= 4) return 'критических момента';
    return 'критических моментов';
}

function applyGreeting(result, opts) {
    const greetEl = document.getElementById('greetingHello');
    const introEl = document.getElementById('greetingIntro');
    if (!greetEl || !introEl) return;

    const isOwner = !!(opts && opts.is_owner);
    const score = Number(result && result.score) || 0;
    const issuesCount = Array.isArray(result && result.critical_issues)
        ? result.critical_issues.length : 0;
    const positionTitle = String((result && result.position_title) || '').trim();

    // Очищаем старые tailwind-классы, унаследованные между перерисовками.
    introEl.classList.remove('max-w-xs', 'mx-auto');

    if (isOwner) {
        // Владелец / только что прошёл аудит — личное приветствие по имени.
        const rawName = (result && result.candidate_first_name) || '';
        const name = String(rawName).trim().split(/\s+/)[0] || '';
        greetEl.textContent = name ? `Добрый день, ${name}!` : 'Добрый день!';
        introEl.innerHTML =
            '<span class="greet-line">Я Аврора — ваш <strong>личный карьерный ассистент</strong>.</span>' +
            '<span class="greet-line">Проанализировала ваше резюме и готова рассказать, ' +
            'почему рекрутеры могут его игнорировать — и как это исправить.</span>';
        return;
    }

    // Viewer (открыл чужой опубликованный аудит) — без имени, обезличенно.
    greetEl.textContent = positionTitle
        ? `Разбор резюме «${esc(positionTitle)}»`
        : 'Разбор резюме';

    const scoreLine =
        `Я оценила его в <span class="accent">${score}/10</span>` +
        (issuesCount > 0
            ? ` и нашла <strong>${issuesCount}</strong> ${pluralIssues(issuesCount)}.`
            : '.');

    introEl.innerHTML =
        '<span class="greet-line">Я Аврора — карьерный ИИ-ассистент.</span>' +
        `<span class="greet-line">${scoreLine}</span>`;
}

// ============================================================================
// OWNER vs VIEWER UI
// ============================================================================

function applyOwnerVsViewer(opts) {
    const ownerActions = document.getElementById('ownerActions');
    const ownerSharedBanner = document.getElementById('ownerSharedBanner');
    const ownerViewsCount = document.getElementById('ownerViewsCount');
    const shareBtnLabel = document.getElementById('shareBtnLabel');
    const shareBtn = document.getElementById('shareBtn');
    const shareBtnIcon = document.getElementById('shareBtnIcon');

    if (opts.is_owner && ownerActions) {
        ownerActions.classList.remove('hidden');

        // Сбрасываем «зелёное» состояние перед каждой перерисовкой.
        // markShareButtonCopied() переустановит его, если только что копировали.
        if (shareBtn) shareBtn.classList.remove('share-btn-copied');
        if (shareBtnIcon) shareBtnIcon.textContent = 'share';

        if (opts.is_shared) {
            if (ownerSharedBanner) ownerSharedBanner.classList.remove('hidden');
            if (ownerViewsCount) ownerViewsCount.textContent = String(opts.views_count || 0);
            if (shareBtnLabel) shareBtnLabel.textContent = 'Скопировать ссылку';
        } else {
            if (ownerSharedBanner) ownerSharedBanner.classList.add('hidden');
            if (shareBtnLabel) shareBtnLabel.textContent = 'Поделиться результатом';
        }
        // Owner НЕ видит sticky-CTA — у него свои контролы выше.
        disableViewerCta();
    } else {
        if (ownerActions) ownerActions.classList.add('hidden');
        // Viewer (чужой shared-аудит) — показываем плавающий FAB «Получить свой».
        enableViewerCta();
    }
}

// ============================================================================
// STICKY CTA BAR (только для viewer-а)
// ============================================================================
// На stepResult правая колонка имеет внутренний overflow-y: auto, поэтому
// window.scrollY не реагирует. Решение: для viewer показываем sticky сразу
// (его всё равно нужно показать — он не помешает, наоборот, пушит к конверсии).

// Viewer CTA (плавающая FAB-кнопка) — показывается только если открыли
// чужой shared-аудит. Owner-у не показываем (у него свой #ownerActions).
function enableViewerCta() {
    const fab = document.getElementById('auditViewerFab');
    if (!fab) return;
    document.body.classList.add('audit-has-viewer-cta');
    fab.classList.remove('hidden');
}
function disableViewerCta() {
    const fab = document.getElementById('auditViewerFab');
    if (!fab) return;
    fab.classList.add('hidden');
    document.body.classList.remove('audit-has-viewer-cta');
}

// Backward-compat алиасы — чтобы старый код, который их вызывает, не падал.
function enableStickyBar()  { enableViewerCta();  }
function disableStickyBar() { disableViewerCta(); }

// ============================================================================
// SHARING — модалка с consent (152-ФЗ) + публикация / отзыв публикации
// ============================================================================

function openShareModal() {
    if (!_currentAudit || !_currentAudit.public_id) return;

    // Уже опубликован — модалку не открываем (этот путь обрабатывается в
    // onShareBtnClick: copy → зелёная кнопка). Здесь — только консент-сценарий.
    if (_currentAudit.is_shared) return;

    const modal = document.getElementById('shareModal');
    const cb = document.getElementById('shareConsentCheckbox');
    const btn = document.getElementById('sharePublishBtn');
    const err = document.getElementById('shareModalError');

    if (cb) cb.checked = false;
    if (btn) btn.disabled = true;
    if (err) err.classList.add('hidden');

    if (cb && cb.dataset.bound !== '1') {
        cb.dataset.bound = '1';
        cb.addEventListener('change', () => {
            if (btn) btn.disabled = !cb.checked;
            if (cb.checked && err) err.classList.add('hidden');
        });
    }

    modal.classList.remove('hidden');
}

function closeShareModal() {
    document.getElementById('shareModal').classList.add('hidden');
}

async function publishAudit() {
    const btn = document.getElementById('sharePublishBtn');
    const err = document.getElementById('shareModalError');
    if (err) err.classList.add('hidden');

    if (!_currentAudit || !_currentAudit.public_id) {
        showShareError('Аудит не загружен — обновите страницу.');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Публикуем…';

    try {
        const resp = await fetch(
            `${apiBase()}/api/audit/${encodeURIComponent(_currentAudit.public_id)}/share`,
            {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ consent: true }),
            }
        );

        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            showShareError(data.detail || data.message || 'Не удалось опубликовать');
            return;
        }

        const data = await resp.json();
        _currentAudit.is_shared = true;
        _currentAudit.share_url = data.share_url;

        const copied = await copyShareUrl(data.share_url);
        closeShareModal();
        applyOwnerVsViewer(_currentAudit);
        if (copied) {
            // Та же зелёная галочка — единое поведение с повторным копированием.
            markShareButtonCopied();
        } else {
            showToast('Опубликовано. Ссылка: ' + data.share_url);
        }

    } catch (_) {
        showShareError('Ошибка сети — попробуйте ещё раз.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Опубликовать и скопировать ссылку';
    }
}

async function unshareAudit() {
    if (!_currentAudit || !_currentAudit.public_id) return;
    if (!confirm('Скрыть публикацию? Ссылка перестанет работать для всех, кроме вас.')) return;

    try {
        const resp = await fetch(
            `${apiBase()}/api/audit/${encodeURIComponent(_currentAudit.public_id)}/unshare`,
            { method: 'POST', credentials: 'include' }
        );
        if (!resp.ok) {
            showToast('Не удалось скрыть публикацию');
            return;
        }
        _currentAudit.is_shared = false;
        applyOwnerVsViewer(_currentAudit);
        showToast('Публикация скрыта');
    } catch (_) {
        showToast('Ошибка сети');
    }
}

async function confirmDeleteAudit() {
    if (!_currentAudit || !_currentAudit.public_id) return;
    const msg =
        'Удалить разбор с сайта насовсем?\n\n' +
        '• Этот разбор будет снят с сайта, ссылка перестанет работать (в т.ч. для тех, ' +
        'кому вы её отправили).\n' +
        '• Восстановить нельзя — данные удаляются по 152-ФЗ (право на забвение).\n' +
        '• Бесплатно сделать новый разбор можно ещё несколько раз.';
    if (!confirm(msg)) return;

    try {
        const resp = await fetch(
            `${apiBase()}/api/audit/${encodeURIComponent(_currentAudit.public_id)}`,
            { method: 'DELETE', credentials: 'include' }
        );
        if (!resp.ok) {
            showToast('Не удалось удалить аудит');
            return;
        }

        forgetMyAudit(_currentAudit.public_id);
        _currentAudit = null;

        // Чистим URL и возвращаем юзера на чистый /audit/ — пусть видит upload-экран,
        // а не «отчёт недоступен» (он же сам только что удалил, не нужно пугать).
        try { history.replaceState({}, '', '/audit/'); } catch (_) {}
        ['stepResult', 'stepLoading', 'stepNotFound', 'stepLoggedIn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        document.getElementById('stepUpload').classList.remove('hidden');
        setSeoVisibility(true);

        // Сбрасываем кэш-флаг «у меня уже создан аудит», иначе следующий
        // submit будет восприниматься как retry (и UI покажет старый toast).
        selectedFile = null;
        turnstileToken = null;
        userEmail = '';

        showToast('Разбор удалён с сайта');

    } catch (_) {
        showToast('Ошибка сети');
    }
}

// Копирует ссылку в буфер. БЕЗ navigator.share и без window.prompt —
// чтобы не было «двух окон» поверх друг друга на iOS/macOS.
// Возвращает true при успехе, false при ошибке.
async function copyShareUrl(url) {
    if (!url) return false;

    // Современный путь.
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(url);
            return true;
        } catch (_) { /* провалимся в legacy */ }
    }

    // Legacy fallback через скрытый textarea + execCommand('copy').
    try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, url.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return !!ok;
    } catch (_) {
        return false;
    }
}

// Метит кнопку «Поделиться» как успешно скопированную: зелёный фон,
// иконка «check», лейбл «Ссылка скопирована». Сохраняется до reload.
function markShareButtonCopied() {
    const btn = document.getElementById('shareBtn');
    const label = document.getElementById('shareBtnLabel');
    const icon = document.getElementById('shareBtnIcon');
    if (btn) btn.classList.add('share-btn-copied');
    if (label) label.textContent = 'Ссылка скопирована';
    if (icon) icon.textContent = 'check';
}

// Хэндлер клика на кнопку «Поделиться/Скопировать».
// Если уже опубликовано — копируем сразу, без модалки.
// Если ещё не опубликовано — открываем модалку с consent.
async function onShareBtnClick() {
    if (!_currentAudit || !_currentAudit.public_id) return;
    if (_currentAudit.is_shared) {
        const ok = await copyShareUrl(_currentAudit.share_url);
        if (ok) {
            markShareButtonCopied();
        } else {
            showToast('Не удалось скопировать. Попробуйте ещё раз');
        }
        return;
    }
    openShareModal();
}

function showShareError(msg) {
    const err = document.getElementById('shareModalError');
    if (!err) return;
    err.textContent = msg;
    err.classList.remove('hidden');
}

function showToast(msg) {
    const toast = document.getElementById('auditToast');
    const text = document.getElementById('auditToastText');
    if (!toast) return;
    if (text) text.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.add('hidden'), 2400);
}

// ============================================================================
// ALREADY USED / CTA
// ============================================================================

function resetEmailModalButton() {
    const btn = document.getElementById('btnGetResult');
    if (btn) {
        btn.textContent = 'Получить разбор';
        updateSubmitButtonState();
    }
}

function showAlreadyUsed(data) {
    resetEmailModalButton();
    disableStickyBar();
    document.getElementById('stepUpload').classList.add('hidden');
    setSeoVisibility(false);

    const stepResult = document.getElementById('stepResult');
    stepResult.classList.remove('hidden');
    stepResult.innerHTML = `
        <div class="glass-card rounded-2xl p-8 shadow-2xl text-center fade-in">
            <span class="material-symbols-outlined text-4xl text-primary mb-3" style="display:block">check_circle</span>
            <h2 class="text-lg font-bold text-on-surface">Вы уже получили бесплатный разбор резюме</h2>
            <p class="text-on-surface-variant text-sm mt-3 leading-relaxed">
                Чтобы Аврора писала сопроводительные письма под каждую вакансию
                и отправляла до 20 откликов в день — попробуйте бесплатно.
            </p>
            <a href="${data.cta_url || '/auth/?source=audit'}"
               class="btn-primary block mt-6 py-3.5 rounded-xl text-white font-semibold text-center text-sm">
                Попробовать 10 откликов бесплатно
            </a>
        </div>
    `;
}

// 4-я (и последующие) попытка аудита для одного пользователя — мягкая стенка.
// Не афишируем число «3» в UI до этого момента: лимит — анти-абуз, а не фича.
// CTA ведёт в кабинет Авроры, где нормальный анализ резюме без квот.
function showLimitReached(data) {
    resetEmailModalButton();
    disableStickyBar();
    document.getElementById('stepUpload').classList.add('hidden');
    setSeoVisibility(false);

    const stepResult = document.getElementById('stepResult');
    stepResult.classList.remove('hidden');
    const msg = data && data.message
        ? data.message
        : 'Вы уже сделали несколько бесплатных разборов. В кабинете Авроры доступен полноценный анализ резюме без лимитов.';
    const cta = (data && data.cta_url) || '/auth/?source=audit';
    const ctaText = (data && data.cta_text) || 'Открыть Аврору';
    stepResult.innerHTML = `
        <div class="glass-card rounded-2xl p-8 shadow-2xl text-center fade-in">
            <span class="material-symbols-outlined text-4xl text-primary mb-3" style="display:block">workspace_premium</span>
            <h2 class="text-lg font-bold text-on-surface">Лимит бесплатных разборов исчерпан</h2>
            <p class="text-on-surface-variant text-sm mt-3 leading-relaxed">
                ${esc(msg)}
            </p>
            <a href="${cta.replace(/"/g, '')}"
               class="btn-primary block mt-6 py-3.5 rounded-xl text-white font-semibold text-center text-sm">
                ${esc(ctaText)}
            </a>
            <p class="text-on-surface-variant text-xs mt-4">
                В кабинете Авроры есть полный анализ резюме —
                с конкретными рекомендациями по каждому блоку.
            </p>
        </div>
    `;
}

function showRegisteredEmail(data) {
    resetEmailModalButton();
    disableStickyBar();
    document.getElementById('stepUpload').classList.add('hidden');
    setSeoVisibility(false);

    const stepResult = document.getElementById('stepResult');
    stepResult.classList.remove('hidden');
    const msg = data.message || 'Этот email уже привязан к аккаунту.';
    const cta = data.cta_url || '/cabinet/';
    const ctaText = data.cta_text || 'Перейти в кабинет';
    stepResult.innerHTML = `
        <div class="glass-card rounded-2xl p-8 shadow-2xl text-center fade-in">
            <span class="material-symbols-outlined text-4xl text-primary mb-3" style="display:block">login</span>
            <h2 class="text-lg font-bold text-on-surface">${esc(msg)}</h2>
            <p class="text-on-surface-variant text-sm mt-3 leading-relaxed">
                Войдите в кабинет, чтобы пользоваться сервисом.
            </p>
            <a href="${cta.replace(/"/g, '')}"
               class="btn-primary block mt-6 py-3.5 rounded-xl text-white font-semibold text-center text-sm">
                ${esc(ctaText)}
            </a>
        </div>
    `;
}

function goToRegister() {
    const email = encodeURIComponent(userEmail);
    window.location.href = `/auth/?email=${email}&source=audit`;
}

// ============================================================================
// UTILS
// ============================================================================

function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}
