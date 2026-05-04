// audit.js — Лид-магнит «Бесплатный аудит резюме»
// v4.0 — sharing-флоу: постоянная ссылка ?id=, owner cookie, публикация с consent (152-ФЗ),
//        страница 404 для просроченных/чужих ссылок, viewer sticky CTA, удаление аудита.

function apiBase() {
    if (window.AuroraSession && typeof window.AuroraSession.getApiBase === 'function') {
        return window.AuroraSession.getApiBase();
    }
    return (window.location.hostname.includes('twc1.net') || window.location.hostname.includes('aurora-develop'))
        ? 'https://api.aurora-develop.ru'
        : 'https://api.aurora-career.ru';
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

    await checkLoggedInUser();
    loadCounter();
    initDragDrop();
    initFileInput();
});

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
    // Сразу скрываем upload и SEO, показываем loading-экран без таймера фаз
    // (для уже готового аудита фразы «анализирую…» неуместны).
    document.getElementById('stepUpload').classList.add('hidden');
    setSeoVisibility(false);
    showLoadingScreen({ phases: false, customText: 'Открываем ваш разбор…' });

    try {
        const resp = await fetch(`${apiBase()}/api/audit/${encodeURIComponent(publicId)}`, {
            method: 'GET',
            credentials: 'include',
        });

        if (resp.status === 404) {
            stopLoadingPhases();
            document.getElementById('stepLoading').classList.add('hidden');
            showNotFound();
            return;
        }

        if (!resp.ok) {
            stopLoadingPhases();
            showLoadingError('Не удалось загрузить отчёт. Попробуйте позже.');
            return;
        }

        const data = await resp.json();
        stopLoadingPhases();
        document.getElementById('stepLoading').classList.add('hidden');

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
        if (code === 'email_already_used') {
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

    const greetEl = document.getElementById('greetingHello');
    if (greetEl) {
        const rawName = (result && result.candidate_first_name) || '';
        const name = String(rawName).trim().split(/\s+/)[0] || '';
        greetEl.textContent = name ? `Добрый день, ${name}!` : 'Добрый день!';
    }

    const portraitEl = document.getElementById('auroraPortraitResult');
    if (portraitEl) {
        const sNum = Number(result && result.score) || 0;
        const newSrc = sNum >= 7 ? AURORA_PORTRAITS.happy : AURORA_PORTRAITS.empathy;
        const wrapEl = document.getElementById('resultPortraitWrap');
        if (wrapEl) wrapEl.classList.remove('hidden');
        portraitEl.src = newSrc;
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
            reaction = 'Хорошая база, но несколько вещей мешают вам получать больше ответов.';
        } else if (s >= 1) {
            reaction = 'Не переживайте — я нашла конкретные причины, почему рекрутеры молчат. Это поправимо.';
        }
        reactionEl.textContent = reaction;
    }

    if (result.recruiter_first_impression) {
        const block = document.getElementById('impressionBlock');
        block.classList.remove('hidden');
        document.getElementById('impressionText').textContent = result.recruiter_first_impression;
    }

    const container = document.getElementById('issuesBlock');
    container.innerHTML = '';
    (result.critical_issues || []).forEach((issue, i) => {
        const card = document.createElement('details');
        card.className = 'issue-card glass-card rounded-xl p-4 shadow-lg group';
        if (i === 0) card.open = true;
        card.innerHTML = `
            <summary class="cursor-pointer list-none flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                    <h4 class="text-sm font-semibold text-on-surface flex items-center gap-2">
                        <span class="material-symbols-outlined text-base flex-shrink-0" style="font-size:16px;color:#f59e0b">warning</span>
                        <span class="min-w-0">${esc(issue.title)}</span>
                    </h4>
                    ${issue.quote ? `<p class="text-on-surface-variant text-xs mt-2 italic">&laquo;${esc(issue.quote)}&raquo;</p>` : ''}
                </div>
                <span class="material-symbols-outlined text-outline transition-transform group-open:rotate-180 flex-shrink-0"
                      style="font-size:20px">expand_more</span>
            </summary>
            <div class="mt-3 space-y-2 pl-1">
                ${issue.why_it_hurts ? `<p class="text-on-surface-variant text-xs leading-relaxed">${esc(issue.why_it_hurts)}</p>` : ''}
                ${issue.fix ? `<p class="text-primary text-xs font-medium leading-relaxed">${esc(issue.fix)}</p>` : ''}
            </div>
        `;
        container.appendChild(card);
    });

    if (result.hh_algo_problems) {
        const block = document.getElementById('algoBlock');
        block.classList.remove('hidden');
        document.getElementById('algoText').textContent = result.hh_algo_problems;
    }

    if (totalAudits) {
        const el = document.getElementById('counterValue');
        if (el) el.textContent = totalAudits.toLocaleString('ru-RU');
    }

    applyOwnerVsViewer(opts);
}

// ============================================================================
// OWNER vs VIEWER UI
// ============================================================================

function applyOwnerVsViewer(opts) {
    const ownerActions = document.getElementById('ownerActions');
    const ownerSharedBanner = document.getElementById('ownerSharedBanner');
    const ownerViewsCount = document.getElementById('ownerViewsCount');
    const shareBtnLabel = document.getElementById('shareBtnLabel');

    if (opts.is_owner && ownerActions) {
        ownerActions.classList.remove('hidden');

        if (opts.is_shared) {
            if (ownerSharedBanner) ownerSharedBanner.classList.remove('hidden');
            if (ownerViewsCount) ownerViewsCount.textContent = String(opts.views_count || 0);
            if (shareBtnLabel) shareBtnLabel.textContent = 'Скопировать ссылку';
        } else {
            if (ownerSharedBanner) ownerSharedBanner.classList.add('hidden');
            if (shareBtnLabel) shareBtnLabel.textContent = 'Поделиться результатом';
        }
        // Owner НЕ видит sticky-CTA — у него свои контролы выше.
        disableStickyBar();
    } else {
        if (ownerActions) ownerActions.classList.add('hidden');
        // Viewer (чужой shared-аудит) — показываем sticky-бар «Получить свой».
        enableStickyBar();
    }
}

// ============================================================================
// STICKY CTA BAR (только для viewer-а)
// ============================================================================

let _stickyHandler = null;

function enableStickyBar() {
    const bar = document.getElementById('auditStickyBar');
    if (!bar) return;

    document.body.classList.add('audit-has-sticky');
    bar.classList.remove('hidden');

    const update = () => {
        const stepResultVisible = !document.getElementById('stepResult').classList.contains('hidden');
        if (!stepResultVisible) {
            bar.classList.add('translate-y-full');
            return;
        }
        if (window.scrollY > 200) {
            bar.classList.remove('translate-y-full');
        } else {
            bar.classList.add('translate-y-full');
        }
    };

    if (_stickyHandler) {
        window.removeEventListener('scroll', _stickyHandler);
    }
    _stickyHandler = update;
    window.addEventListener('scroll', update, { passive: true });
    update();
}

function disableStickyBar() {
    const bar = document.getElementById('auditStickyBar');
    if (!bar) return;
    bar.classList.add('translate-y-full');
    bar.classList.add('hidden');
    document.body.classList.remove('audit-has-sticky');
    if (_stickyHandler) {
        window.removeEventListener('scroll', _stickyHandler);
        _stickyHandler = null;
    }
}

// ============================================================================
// SHARING — модалка с consent (152-ФЗ) + публикация / отзыв публикации
// ============================================================================

function openShareModal() {
    if (!_currentAudit || !_currentAudit.public_id) return;

    // Если уже опубликован — просто копируем ссылку без второго consent.
    if (_currentAudit.is_shared) {
        copyShareUrl(_currentAudit.share_url);
        showToast('Ссылка скопирована');
        return;
    }

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

        await copyShareUrl(data.share_url);
        closeShareModal();
        showToast('Ссылка скопирована');
        applyOwnerVsViewer(_currentAudit);

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
    const msg = 'Удалить аудит навсегда?\n\nЭто действие необратимо. ' +
        'Все данные о вашем разборе будут удалены из системы (152-ФЗ — право на забвение).';
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

        // Чистим URL и показываем NotFound (страница уже не существует).
        try { history.replaceState({}, '', '/audit/'); } catch (_) {}
        document.getElementById('stepResult').classList.add('hidden');
        showNotFound();
        // Подменяем заголовок «Отчёт недоступен» на нейтральный.
        const h = document.querySelector('#stepNotFound h1');
        if (h) h.textContent = 'Аудит удалён';

    } catch (_) {
        showToast('Ошибка сети');
    }
}

async function copyShareUrl(url) {
    if (!url) return;
    // Native Web Share — на мобилке откроет нативный шторку.
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Аудит резюме от Авроры',
                text: 'Аврора разобрала моё резюме — вот результат:',
                url,
            });
            return;
        } catch (_) {
            // Юзер закрыл шторку — fallback на копирование.
        }
    }
    try { await navigator.clipboard.writeText(url); } catch (_) {
        // Совсем старый браузер: показываем prompt
        try { window.prompt('Скопируйте ссылку:', url); } catch (_) {}
    }
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
