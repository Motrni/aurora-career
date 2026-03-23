/*
   AURORA CAREER RESPONSES — Autopilot Dashboard
   (c) 2024-2026 Aurora Career. All rights reserved.
*/

const API_BASE_URL = (window.location.hostname.includes('twc1.net') || window.location.hostname.includes('aurora-develop'))
    ? 'https://api.aurora-develop.ru'
    : 'https://api.aurora-career.ru';

let authMode = null;
let legacyUserId = null;
let legacySign = null;
let isAutopilotActive = false;
let eventSource = null;
let lastEventId = 0;
let rejectedPage = 0;
let rejectedCategory = 'already_applied';
let rejectedTotal = 0;

window.BOT_USERNAME = "Aurora_Career_Bot";

document.addEventListener("DOMContentLoaded", async () => {
    toggleGlobalLoading(true);

    const urlParams = new URLSearchParams(window.location.search);
    legacyUserId = urlParams.get('user_id');
    legacySign = urlParams.get('sign');

    try {
        const meResponse = await fetch(`${API_BASE_URL}/api/auth/me`, {
            method: "GET",
            credentials: "include"
        });
        if (meResponse.ok) {
            const meData = await meResponse.json();
            if (meData.status === "ok") {
                authMode = 'jwt';
            }
        }
    } catch (e) {
        console.log("[Auth] JWT check failed");
    }

    if (!authMode) {
        if (!legacyUserId || !legacySign) {
            showError("Ошибка доступа. Ссылка не содержит необходимых параметров.");
            toggleGlobalLoading(false);
            return;
        }
        authMode = 'legacy';
    }

    propagateAuthToNavLinks();
    await initPage();

    document.getElementById("returnBtn").addEventListener("click", () => {
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.close();
        }
        window.location.href = `https://t.me/${window.BOT_USERNAME}`;
    });
});

function propagateAuthToNavLinks() {
    if (authMode !== 'legacy' || !legacyUserId || !legacySign) return;
    const suffix = `?user_id=${legacyUserId}&sign=${legacySign}`;
    const navSettings = document.getElementById('nav-settings');
    const navSettingsMobile = document.getElementById('nav-settings-mobile');
    if (navSettings) navSettings.href = `settings.html${suffix}`;
    if (navSettingsMobile) navSettingsMobile.href = `settings.html${suffix}`;
}

function toggleGlobalLoading(isLoading) {
    const skeleton = document.getElementById("globalSkeleton");
    const content = document.getElementById("mainContent");
    if (isLoading) {
        if (skeleton) skeleton.style.display = "block";
        if (content) content.style.display = "none";
    } else {
        if (skeleton) skeleton.style.display = "none";
        if (content) content.style.display = "block";
    }
}

function showError(msg) {
    const el = document.getElementById("errorMsg");
    if (el) { el.innerText = msg; el.style.display = "block"; }
}

function buildAuthParams() {
    const p = new URLSearchParams();
    if (authMode === 'legacy' && legacyUserId && legacySign) {
        p.set('user_id', legacyUserId);
        p.set('sign', legacySign);
    }
    return p.toString();
}

async function apiFetch(path, opts = {}) {
    const url = `${API_BASE_URL}${path}`;
    const defaults = { credentials: "include" };
    return fetch(url, { ...defaults, ...opts });
}

// ============================================================================
// INIT PAGE
// ============================================================================

async function initPage() {
    try {
        const authQ = buildAuthParams();
        const url = `/api/campaign/status${authQ ? '?' + authQ : ''}`;
        const resp = await apiFetch(url);
        if (!resp.ok) throw new Error(`Status ${resp.status}`);
        const data = await resp.json();

        if (data.status !== "ok") throw new Error(data.detail || "Unknown");

        updateStatusPanel(data);

        if (data.is_active) {
            connectSSE();
        }

        await loadRejected(rejectedCategory);

    } catch (e) {
        console.error("[initPage]", e);
        showError("Не удалось загрузить данные. " + e.message);
    } finally {
        toggleGlobalLoading(false);
    }
}

// ============================================================================
// STATUS PANEL
// ============================================================================

function updateStatusPanel(data) {
    isAutopilotActive = data.is_active;

    const applied = data.applications_today || 0;
    const limit = data.daily_limit || 20;
    const pct = limit > 0 ? applied / limit : 0;

    document.getElementById("appliedCount").innerText = applied;
    document.getElementById("dailyLimit").innerText = limit;

    const circumference = 364.4;
    const offset = circumference * (1 - pct);
    document.getElementById("progressCircle").style.strokeDashoffset = offset;

    const pctRound = Math.round(pct * 100);
    const progressText = document.getElementById("progressText");

    if (isAutopilotActive) {
        progressText.innerText = `Автопилот работает — ${pctRound}%`;
    } else if (applied > 0) {
        progressText.innerText = `Автопилот выключен — ${pctRound}%`;
    } else {
        progressText.innerText = "Автопилот неактивен";
    }

    updateToggleButton();
}

function updateToggleButton() {
    const btn = document.getElementById("toggleBtn");
    const text = document.getElementById("toggleBtnText");
    const icon = document.getElementById("toggleBtnIcon");

    if (isAutopilotActive) {
        btn.classList.remove("bg-primary-container");
        btn.classList.add("bg-red-600/80");
        btn.style.boxShadow = "0 0 40px rgba(220,38,38,0.3)";
        text.innerText = "Остановить автопилот";
        icon.innerText = "stop_circle";
    } else {
        btn.classList.remove("bg-red-600/80");
        btn.classList.add("bg-primary-container");
        btn.style.boxShadow = "0 0 40px rgba(90,48,208,0.3)";
        text.innerText = "Запустить автопилот";
        icon.innerText = "bolt";
    }
}

// ============================================================================
// TOGGLE AUTOPILOT
// ============================================================================

window.toggleAutopilot = async function () {
    const btn = document.getElementById("toggleBtn");
    btn.disabled = true;

    try {
        const resp = await apiFetch("/api/campaign/toggle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        isAutopilotActive = data.is_active;
        updateToggleButton();

        const progressText = document.getElementById("progressText");
        if (isAutopilotActive) {
            progressText.innerText = "Автопилот запускается...";
            connectSSE();
        } else {
            progressText.innerText = "Автопилот остановлен";
            disconnectSSE();
        }

    } catch (e) {
        console.error("[toggleAutopilot]", e);
        showError("Ошибка переключения: " + e.message);
    } finally {
        btn.disabled = false;
    }
};

// ============================================================================
// SSE — SERVER-SENT EVENTS
// ============================================================================

function connectSSE() {
    disconnectSSE();

    const authQ = buildAuthParams();
    let url = `${API_BASE_URL}/api/campaign/events?after_id=${lastEventId}`;
    if (authQ) url += '&' + authQ;

    eventSource = new EventSource(url, { withCredentials: true });

    eventSource.onmessage = (e) => {
        if (!e.data || e.data.startsWith(':')) return;
        try {
            const evt = JSON.parse(e.data);
            lastEventId = evt.id || lastEventId;
            appendLogEntry(evt);
        } catch (err) {
            console.warn("[SSE] parse error", err);
        }
    };

    eventSource.onerror = () => {
        console.warn("[SSE] connection error, reconnecting in 5s...");
        disconnectSSE();
        setTimeout(() => {
            if (isAutopilotActive) connectSSE();
        }, 5000);
    };

    document.getElementById("liveIndicator").style.display = "flex";
}

function disconnectSSE() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    document.getElementById("liveIndicator").style.display = "none";
}

// ============================================================================
// LOG RENDERING
// ============================================================================

const EVENT_CONFIG = {
    'search_started':    { icon: 'verified_user',  color: 'text-primary',  label: 'Поиск запущен' },
    'vacancy_analyzed':  { icon: 'info',           color: 'text-on-tertiary-container', label: 'Анализ' },
    'vacancy_applied':   { icon: 'check_circle',   color: 'text-primary',  label: 'Отклик' },
    'vacancy_rejected':  { icon: 'warning',        color: 'text-error',    label: 'Пропущено' },
    'vacancy_test':      { icon: 'quiz',           color: 'text-[#fbbf24]', label: 'Тест' },
    'search_complete':   { icon: 'flag',           color: 'text-primary',  label: 'Поиск завершен' },
    'error':             { icon: 'error',          color: 'text-error',    label: 'Ошибка' },
};

function appendLogEntry(evt) {
    const container = document.getElementById("logContainer");
    const emptyMsg = document.getElementById("logEmpty");
    if (emptyMsg) emptyMsg.remove();

    const cfg = EVENT_CONFIG[evt.type] || { icon: 'info', color: 'text-on-surface-variant', label: evt.type };
    const ts = evt.ts ? new Date(evt.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

    const row = document.createElement("div");
    row.className = "flex gap-3 md:gap-4 items-start";
    row.style.animation = "fadeIn 0.3s ease";

    let description = '';

    if (evt.type === 'vacancy_applied') {
        description = `Успешный отклик: <span class="text-on-surface">${esc(evt.vacancy_name || '')} @ ${esc(evt.employer || '')}</span>`;
    } else if (evt.type === 'vacancy_analyzed') {
        const score = evt.details?.score || '?';
        description = `Анализ: <span class="text-on-surface">${esc(evt.vacancy_name || '')}</span> — ${score}% совпадение`;
    } else if (evt.type === 'vacancy_rejected') {
        const reason = formatRejectionReason(evt.details?.reason);
        const score = evt.details?.score;
        let extra = '';
        if (score !== undefined) extra = ` (${score}%)`;
        description = `Пропущено: <span class="text-on-surface">${esc(evt.vacancy_name || '')}</span>. Причина: <span class="text-error italic">${reason}${extra}</span>`;
    } else if (evt.type === 'search_started') {
        const found = evt.details?.found_total || 0;
        description = `Поиск запущен. Найдено ${found} вакансий.`;
    } else if (evt.type === 'search_complete') {
        const stats = evt.details?.filter_stats;
        if (stats) {
            const added = stats.added_to_queue || 0;
            description = `Поиск завершен. В очередь: ${added}`;
        } else {
            description = 'Поиск завершен.';
        }
    } else if (evt.type === 'error') {
        description = `Ошибка: ${esc(evt.details?.message || '')}`;
    } else {
        description = esc(JSON.stringify(evt.details || {}));
    }

    row.innerHTML = `
        <span class="text-primary-fixed-dim font-mono text-xs md:text-sm opacity-50 shrink-0 pt-0.5">${ts}</span>
        <span class="material-symbols-outlined ${cfg.color} text-base md:text-lg shrink-0">${cfg.icon}</span>
        <p class="text-on-surface-variant font-mono text-xs md:text-sm leading-relaxed">${description}</p>
    `;

    container.appendChild(row);

    requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
    });
}

function formatRejectionReason(reason) {
    const map = {
        'filter_already_applied': 'Уже есть отклик',
        'filter_test_required': 'Требуется тест',
        'filter_ai_match_low': 'Не прошел ИИ-оценку',
        'filter_archived': 'Вакансия в архиве',
        'filter_manual_declined': 'Отклонено вручную',
        'filter_employer_blacklist': 'Работодатель в блэклисте',
        'filter_duplicate_title': 'Дубль вакансии',
        'filter_in_queue': 'Уже в очереди',
        'filter_rpc_check_failed': 'Ошибка проверки',
    };
    return map[reason] || reason || 'Неизвестно';
}

function esc(str) {
    const d = document.createElement('div');
    d.innerText = str;
    return d.innerHTML;
}

// ============================================================================
// REJECTED VACANCIES
// ============================================================================

function switchRejTab(btn) {
    document.querySelectorAll('.rej-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    rejectedCategory = btn.dataset.cat;
    rejectedPage = 0;
    loadRejected(rejectedCategory);
}

async function loadRejected(category) {
    const list = document.getElementById("rejectedList");
    const loadMoreBtn = document.getElementById("loadMoreBtn");

    if (rejectedPage === 0) {
        list.innerHTML = '<div class="text-center py-8 text-on-surface-variant/50 text-sm">Загрузка...</div>';
    }

    try {
        const authQ = buildAuthParams();
        let url = `/api/campaign/rejected?category=${category}&page=${rejectedPage}`;
        if (authQ) url += '&' + authQ;

        const resp = await apiFetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (data.status !== "ok") throw new Error("API error");

        rejectedTotal = data.total || 0;
        document.getElementById("rejectedBadge").innerText = `${rejectedTotal} всего`;

        if (rejectedPage === 0) list.innerHTML = '';

        if (data.items.length === 0 && rejectedPage === 0) {
            list.innerHTML = `
                <div id="rejectedEmpty" class="glass-panel p-8 rounded-xl text-center text-on-surface-variant/50 text-sm">
                    <span class="material-symbols-outlined text-3xl mb-2 block">filter_alt</span>
                    Нет отбракованных вакансий в этой категории
                </div>`;
            loadMoreBtn.style.display = "none";
            return;
        }

        data.items.forEach(item => {
            list.appendChild(createRejectedCard(item));
        });

        const loaded = (rejectedPage + 1) * 20;
        loadMoreBtn.style.display = loaded < rejectedTotal ? "block" : "none";

    } catch (e) {
        console.error("[loadRejected]", e);
        if (rejectedPage === 0) {
            list.innerHTML = '<div class="text-center py-8 text-error text-sm">Ошибка загрузки</div>';
        }
    }
}

function loadMoreRejected() {
    rejectedPage++;
    loadRejected(rejectedCategory);
}

function createRejectedCard(item) {
    const card = document.createElement("div");
    card.className = "glass-panel p-4 md:p-6 rounded-xl group hover:bg-surface-container-highest transition-colors cursor-pointer";

    const vacId = item.vacancy_id;
    const hhUrl = vacId ? `https://hh.ru/vacancy/${vacId}` : '#';
    const reason = formatRejectionReason(item.details?.reason);
    const score = item.details?.score;
    const reasoning = item.details?.reasoning;
    const time = item.created_at ? timeAgo(new Date(item.created_at)) : '';

    let tagsHtml = `<span class="px-3 py-1 bg-error/10 text-error text-[10px] font-bold uppercase tracking-wider rounded-full">${esc(reason)}</span>`;
    if (score !== undefined) {
        tagsHtml += `<span class="px-3 py-1 bg-surface-container-highest text-on-surface-variant text-[10px] font-bold uppercase tracking-wider rounded-full">Score: ${score}%</span>`;
    }

    let reasoningHtml = '';
    if (reasoning) {
        reasoningHtml = `<p class="text-[11px] text-on-surface-variant/60 mt-2 line-clamp-2">${esc(reasoning)}</p>`;
    }

    card.innerHTML = `
        <a href="${hhUrl}" target="_blank" rel="noopener" class="flex items-start gap-3 md:gap-4 no-underline">
            <div class="w-10 h-10 md:w-12 md:h-12 rounded-lg bg-surface-container-highest flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined text-on-surface-variant text-xl md:text-2xl">work_outline</span>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex justify-between items-start mb-1 gap-2">
                    <h4 class="font-bold text-on-surface group-hover:text-primary transition-colors text-sm md:text-base truncate">${esc(item.employer_name || 'Компания')}</h4>
                    <span class="text-[10px] md:text-xs text-on-surface-variant shrink-0">${time}</span>
                </div>
                <p class="text-xs md:text-sm text-on-surface-variant mb-2 md:mb-3 truncate">${esc(item.vacancy_name || 'Вакансия')}</p>
                <div class="flex flex-wrap gap-1.5 md:gap-2">${tagsHtml}</div>
                ${reasoningHtml}
            </div>
        </a>
    `;

    return card;
}

function timeAgo(date) {
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'только что';
    if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
    return `${Math.floor(diff / 86400)} д назад`;
}
