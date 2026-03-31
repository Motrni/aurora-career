/*
   AURORA CAREER RESPONSES — Autopilot Dashboard
   (c) 2024-2026 Aurora Career. All rights reserved.
*/

const API_BASE_URL = window.AuroraSession
    ? window.AuroraSession.getApiBase()
    : ((window.location.hostname.includes('twc1.net') || window.location.hostname.includes('aurora-develop'))
        ? 'https://api.aurora-develop.ru'
        : 'https://api.aurora-career.ru');

let authMode = null;
let legacyUserId = null;
let legacySign = null;
let isAutopilotActive = false;
/** Пока бот подхватывает кампанию (до первого search_started / search_complete). */
let isAutopilotStarting = false;
let eventSource = null;
let lastEventId = 0;
let rejectedPage = 0;
let rejectedCategory = 'already_applied';
let rejectedTotal = 0;

let currentApplied = 0;
let currentDailyLimit = 20;
let isDailyPaused = false;
let dailyQuotaFull = true;
let hasActiveBoost = false;
let nextMorningMsk = "08:00";
let statusPollTimer = null;
let sseConnectedAt = null; // Момент подключения SSE — события ДО него исторические

let toastHideTimer = null;
let toastAfterTimer = null;

window.BOT_USERNAME = "Aurora_Career_Bot";

document.addEventListener("DOMContentLoaded", async () => {
    toggleGlobalLoading(true);

    const urlParams = new URLSearchParams(window.location.search);
    legacyUserId = urlParams.get('user_id');
    legacySign = urlParams.get('sign');

    try {
        let meResponse = await fetch(`${API_BASE_URL}/api/auth/me`, {
            method: "GET",
            credentials: "include"
        });
        if (meResponse.status === 401) {
            const refreshResp = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
                method: "POST",
                credentials: "include"
            });
            if (refreshResp.ok) {
                meResponse = await fetch(`${API_BASE_URL}/api/auth/me`, {
                    method: "GET",
                    credentials: "include"
                });
            }
        }
        if (meResponse.ok) {
            const meData = await meResponse.json();
            if (meData.status === "ok") {
                if (meData.current_step && meData.current_step.startsWith('onboarding_')) {
                    if (meData.current_step === 'onboarding_settings' || meData.current_step === 'onboarding_save_pending') {
                        window.location.href = 'settings.html';
                    } else {
                        window.location.href = 'onboarding.html';
                    }
                    return;
                }
                if (meData.subscription_status === 'none') {
                    window.location.href = 'cabinet.html';
                    return;
                }
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

    if (authMode === 'jwt' && window.AuroraSession) {
        window.AuroraSession.startPing();
    }

    propagateAuthToNavLinks();
    await initPage();
    initBoostModal();

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

/** Всплывашка у верхнего края окна, исчезает через durationMs (по умолчанию ~2.5 с). */
function showToast(message, durationMs = 2600) {
    const host = document.getElementById("pageToast");
    const text = document.getElementById("pageToastText");
    if (!host || !text) return;
    text.textContent = message;
    if (toastHideTimer) clearTimeout(toastHideTimer);
    if (toastAfterTimer) clearTimeout(toastAfterTimer);
    host.classList.add("toast-visible");
    host.setAttribute("aria-hidden", "false");

    toastHideTimer = setTimeout(() => {
        host.classList.remove("toast-visible");
        host.setAttribute("aria-hidden", "true");
        toastAfterTimer = setTimeout(() => {
            text.textContent = "";
        }, 320);
    }, durationMs);
}

function isRateLimitError(err) {
    if (!err) return false;
    if (err.status === 429) return true;
    const m = String(err.message || "").toLowerCase();
    return (
        m.includes("too many") ||
        m.includes("429") ||
        m.includes("rate limit") ||
        m.includes("слишком много")
    );
}

/** Ошибки кнопки автопилота — коротко и без «висящего» баннера. */
function showAutopilotActionError(err) {
    if (isRateLimitError(err)) {
        showToast("Не так часто — подождите пару секунд.");
        return;
    }
    const raw = err && err.message ? String(err.message) : "";
    if (!raw || raw.length > 100) {
        showToast("Не получилось переключить. Попробуйте ещё раз.");
        return;
    }
    showToast(raw);
}

function throwHttpError(resp, errBody) {
    const detail = errBody?.detail || `HTTP ${resp.status}`;
    const ex = new Error(detail);
    ex.status = resp.status;
    return ex;
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

        // Стартуем SSE с последнего известного event_id,
        // чтобы избежать реплицирования истории через SSE
        if (data.last_event_id) {
            lastEventId = data.last_event_id;
        }

        // Грузим историю лога отдельно (без влияния на UI-состояние)
        await loadLogHistory();

        if (data.is_active) {
            connectSSE();
            startStatusPolling();
        } else if (data.autopilot_paused_daily_limit) {
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

async function loadLogHistory() {
    try {
        const authQ = buildAuthParams();
        let url = `/api/campaign/history${authQ ? '?' + authQ : ''}`;
        const resp = await apiFetch(url);
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.status !== "ok" || !data.events) return;

        const container = document.getElementById("logContainer");
        const emptyMsg = document.getElementById("logEmpty");
        if (emptyMsg && data.events.length > 0) emptyMsg.remove();

        for (const evt of data.events) {
            // Рендерим только значимые события истории
            if (evt.type === 'vacancy_rejected') {
                if (!LOG_SILENT_REASONS.has(evt.details?.reason || '')) {
                    appendLogEntry(evt);
                }
            } else {
                appendLogEntry(evt);
            }
        }

        scrollLogToBottom();
    } catch (e) {
        console.warn("[loadLogHistory]", e);
    }
}

function scrollLogToBottom() {
    const container = document.getElementById("logContainer");
    if (!container) return;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
        });
    });
}

// ============================================================================
// STATUS PANEL
// ============================================================================

function updateStatusPanel(data) {
    isAutopilotActive = data.is_active;
    isDailyPaused = !!data.autopilot_paused_daily_limit;
    dailyQuotaFull = !!data.daily_quota_full;
    hasActiveBoost = !!data.has_active_boost;
    if (data.next_morning_autopilot_msk) {
        nextMorningMsk = data.next_morning_autopilot_msk;
    }
    currentApplied = data.applications_today || 0;
    currentDailyLimit = data.daily_limit || 20;

    renderProgress(currentApplied, currentDailyLimit);
    updateToggleButton();
    updateBoostUpsellVisibility();
}

function setProgressSpinnerVisible(visible) {
    const spinner = document.getElementById("progressSpinner");
    if (spinner) spinner.classList.toggle("hidden", !visible);
}

function renderProgress(applied, limit) {
    const pct = limit > 0 ? applied / limit : 0;

    document.getElementById("appliedCount").innerText = applied;
    document.getElementById("dailyLimit").innerText = limit;

    const circumference = 364.4;
    const offset = circumference * (1 - Math.min(pct, 1));
    document.getElementById("progressCircle").style.strokeDashoffset = offset;

    const pctRound = Math.round(pct * 100);
    const progressText = document.getElementById("progressText");
    if (!progressText) return;

    if (!isAutopilotActive) {
        isAutopilotStarting = false;
    }

    if (isDailyPaused) {
        setProgressSpinnerVisible(false);
        if (dailyQuotaFull) {
            progressText.innerText =
                `На сегодня лимит откликов исчерпан. Следующий автозапуск — завтра в ${nextMorningMsk} (МСК).`;
        } else {
            progressText.innerText =
                `Лимит откликов на сегодня обновлён. Можно запустить сейчас или дождаться утреннего автозапуска в ${nextMorningMsk} по МСК.`;
        }
        return;
    }

    if (isAutopilotActive && isAutopilotStarting) {
        progressText.innerText = "Автопилот запускается";
        setProgressSpinnerVisible(true);
        return;
    }

    setProgressSpinnerVisible(false);

    if (isAutopilotActive) {
        progressText.innerText = "Автопилот работает";
    } else if (applied > 0) {
        progressText.innerText = `Автопилот выключен — ${pctRound}%`;
    } else {
        progressText.innerText = "Автопилот неактивен";
    }
}

function updateBoostUpsellVisibility() {
    const block = document.getElementById("boostUpsellBlock");
    if (!block) return;
    const show = isDailyPaused && dailyQuotaFull && !hasActiveBoost;
    block.classList.toggle("hidden", !show);
}

function openBoostModal() {
    const modal = document.getElementById("boostModal");
    const card = document.getElementById("boostModalCard");
    if (!modal) return;

    boostShowStep1();

    modal.classList.remove("pointer-events-none");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("overflow-hidden");

    requestAnimationFrame(() => {
        modal.classList.add("opacity-100");
        modal.classList.remove("opacity-0");
        card.classList.add("scale-100", "opacity-100");
        card.classList.remove("scale-95", "opacity-0");
    });
}

function closeBoostModal() {
    const modal = document.getElementById("boostModal");
    const card = document.getElementById("boostModalCard");
    if (!modal) return;

    modal.classList.remove("opacity-100");
    modal.classList.add("opacity-0");
    card.classList.remove("scale-100", "opacity-100");
    card.classList.add("scale-95", "opacity-0");

    const onDone = () => {
        modal.classList.add("pointer-events-none");
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("overflow-hidden");
        modal.removeEventListener("transitionend", onDone);
    };
    modal.addEventListener("transitionend", onDone, { once: true });
}

function boostShowStep1() {
    const s1 = document.getElementById("boostStep1");
    const s2 = document.getElementById("boostStep2");
    const err = document.getElementById("boostError");
    if (s1) s1.classList.remove("hidden");
    if (s2) s2.classList.add("hidden");
    if (err) { err.classList.add("hidden"); err.textContent = ""; }
    document.querySelectorAll(".boost-tier-btn").forEach((b) => { b.disabled = false; });
}

function boostShowStep2(paymentUrl, amount, description) {
    document.getElementById("boostStep1").classList.add("hidden");
    document.getElementById("boostStep2").classList.remove("hidden");
    document.getElementById("boostStep2Desc").textContent = description;
    document.getElementById("boostStep2Price").textContent = Math.round(amount);
    document.getElementById("boostPayLink").href = paymentUrl;
}

async function purchaseBoost(tier) {
    const btn = document.querySelector(`.boost-tier-btn[data-boost-tier="${tier}"]`);
    const errEl = document.getElementById("boostError");

    document.querySelectorAll(".boost-tier-btn").forEach((b) => { b.disabled = true; });
    if (errEl) { errEl.classList.add("hidden"); errEl.textContent = ""; }

    try {
        const authQ = buildAuthParams();
        const url = `/api/boost/purchase${authQ ? '?' + authQ : ''}`;
        const resp = await apiFetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tier: String(tier) }),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        if (!data.payment_url) throw new Error("Не удалось сформировать ссылку на оплату");

        boostShowStep2(data.payment_url, data.amount, data.description);

    } catch (e) {
        console.error("[purchaseBoost]", e);
        if (errEl) {
            errEl.textContent = e.message || "Произошла ошибка";
            errEl.classList.remove("hidden");
        }
        document.querySelectorAll(".boost-tier-btn").forEach((b) => { b.disabled = false; });
    }
}

function initBoostModal() {
    const modal = document.getElementById("boostModal");
    const backdrop = document.getElementById("boostModalBackdrop");
    const openBtn = document.getElementById("openBoostModalBtn");

    openBtn?.addEventListener("click", openBoostModal);

    modal?.addEventListener("click", (e) => {
        if (e.target === backdrop) closeBoostModal();
    });

    document.querySelectorAll("#boostModalClose, .boost-modal-close-btn").forEach((b) => {
        b.addEventListener("click", closeBoostModal);
    });

    document.querySelectorAll(".boost-tier-btn").forEach((b) => {
        b.addEventListener("click", () => purchaseBoost(b.dataset.boostTier));
    });

    document.getElementById("boostBackBtn")?.addEventListener("click", boostShowStep1);

    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || !modal || modal.getAttribute("aria-hidden") === "true") return;
        closeBoostModal();
    });
}

function updateToggleButton() {
    const btn = document.getElementById("toggleBtn");
    const text = document.getElementById("toggleBtnText");
    const icon = document.getElementById("toggleBtnIcon");
    const resumeBtn = document.getElementById("resumeNowBtn");

    if (resumeBtn) {
        const showResume = isDailyPaused && !dailyQuotaFull;
        if (showResume) resumeBtn.classList.remove("hidden");
        else resumeBtn.classList.add("hidden");
    }

    if (isDailyPaused) {
        btn.classList.remove("bg-primary-container");
        btn.classList.add("bg-red-600/80");
        btn.style.boxShadow = "0 0 40px rgba(220,38,38,0.35)";
        text.innerText = "Отключить автозапуск";
        icon.innerText = "event_busy";
        btn.disabled = false;
        return;
    }

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

async function refreshStatusFromServer() {
    try {
        const authQ = buildAuthParams();
        const url = `/api/campaign/status${authQ ? '?' + authQ : ''}`;
        const resp = await apiFetch(url);
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.status !== "ok") return;
        updateStatusPanel(data);
    } catch (e) {
        console.warn("[refreshStatus]", e);
    }
}

// ============================================================================
// STATUS POLLING (real-time counter updates)
// ============================================================================

function startStatusPolling() {
    stopStatusPolling();
    statusPollTimer = setInterval(async () => {
        try {
            const authQ = buildAuthParams();
            const url = `/api/campaign/status${authQ ? '?' + authQ : ''}`;
            const resp = await apiFetch(url);
            if (!resp.ok) return;
            const data = await resp.json();
            if (data.status !== "ok") return;

            const wasActive = isAutopilotActive;

            if (data.autopilot_paused_daily_limit) {
                updateStatusPanel(data);
                disconnectSSE();
                stopStatusPolling();
                return;
            }

            updateStatusPanel(data);

            if (!data.is_active && wasActive) {
                disconnectSSE();
                stopStatusPolling();
            }
        } catch (e) {
            console.warn("[StatusPoll]", e);
        }
    }, 15000);
}

function stopStatusPolling() {
    if (statusPollTimer) {
        clearInterval(statusPollTimer);
        statusPollTimer = null;
    }
}

// ============================================================================
// TOGGLE AUTOPILOT
// ============================================================================

window.toggleAutopilot = async function () {
    const btn = document.getElementById("toggleBtn");
    btn.disabled = true;

    try {
        const authQ = buildAuthParams();

        if (isDailyPaused) {
            const url = `/api/campaign/cancel-scheduled${authQ ? '?' + authQ : ''}`;
            const resp = await apiFetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw throwHttpError(resp, err);
            }
            await refreshStatusFromServer();
            disconnectSSE();
            stopStatusPolling();
            return;
        }

        const toggleUrl = `/api/campaign/toggle${authQ ? '?' + authQ : ''}`;
        const resp = await apiFetch(toggleUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw throwHttpError(resp, err);
        }

        const data = await resp.json();
        isAutopilotActive = data.is_active;
        if (isAutopilotActive) {
            isAutopilotStarting = true;
        } else {
            isAutopilotStarting = false;
        }
        await refreshStatusFromServer();

        if (isAutopilotActive) {
            connectSSE();
            startStatusPolling();
        } else {
            disconnectSSE();
            stopStatusPolling();
        }

    } catch (e) {
        console.error("[toggleAutopilot]", e);
        showAutopilotActionError(e);
    } finally {
        btn.disabled = false;
    }
};

window.resumeAutopilotNow = async function () {
    const btn = document.getElementById("resumeNowBtn");
    if (btn) btn.disabled = true;

    try {
        const authQ = buildAuthParams();
        const toggleUrl = `/api/campaign/toggle${authQ ? '?' + authQ : ''}`;
        const resp = await apiFetch(toggleUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw throwHttpError(resp, err);
        }

        await refreshStatusFromServer();

        if (isAutopilotActive) {
            isAutopilotStarting = true;
            renderProgress(currentApplied, currentDailyLimit);
            connectSSE();
            startStatusPolling();
        }
    } catch (e) {
        console.error("[resumeAutopilotNow]", e);
        showAutopilotActionError(e);
    } finally {
        if (btn) btn.disabled = false;
    }
};

// ============================================================================
// SSE — SERVER-SENT EVENTS
// ============================================================================

function connectSSE() {
    disconnectSSE();
    sseConnectedAt = Date.now();

    const authQ = buildAuthParams();
    let url = `${API_BASE_URL}/api/campaign/events?after_id=${lastEventId}`;
    if (authQ) url += '&' + authQ;

    eventSource = new EventSource(url, { withCredentials: true });

    eventSource.onmessage = (e) => {
        if (!e.data || e.data.startsWith(':')) return;
        try {
            const evt = JSON.parse(e.data);
            lastEventId = evt.id || lastEventId;
            handleSSEEvent(evt);
        } catch (err) {
            console.warn("[SSE] parse error", err);
        }
    };

    eventSource.onerror = () => {
        console.warn("[SSE] connection error, reconnecting in 5s...");
        disconnectSSE();
        setTimeout(() => {
            if (isAutopilotActive || isDailyPaused) connectSSE();
        }, 5000);
    };

    document.getElementById("liveIndicator").style.display = "flex";
}

function isLiveEvent(evt) {
    if (!evt.ts || !sseConnectedAt) return true;
    // Историческое если событие старше момента подключения минус 10 секунд буфера
    return new Date(evt.ts).getTime() >= (sseConnectedAt - 10000);
}

function disconnectSSE() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    document.getElementById("liveIndicator").style.display = "none";
}

const LOG_SILENT_REASONS = new Set([
    'filter_already_applied',
    'filter_duplicate_title',
    'filter_in_queue',
    'filter_archived',
    'filter_manual_declined',
    'filter_employer_blacklist',
    'filter_rpc_check_failed',
]);

function clearAutopilotLog() {
    const container = document.getElementById("logContainer");
    if (!container) return;
    container.innerHTML = "";
}

function handleSSEEvent(evt) {
    const live = isLiveEvent(evt);

    if (evt.type === "daily_quota_reset") {
        if (live) {
            clearAutopilotLog();
            currentApplied = 0;
            dailyQuotaFull = false;
            renderProgress(0, currentDailyLimit);
            updateBoostUpsellVisibility();
            void refreshStatusFromServer();
            appendLogEntry(evt);
        }
        return;
    }

    if (evt.type === 'vacancy_rejected') {
        const reason = evt.details?.reason || '';

        // Панель отбракованных обновляем только от живых событий
        // (история уже загружена через loadRejected REST)
        if (live) {
            const cat = REASON_TO_CATEGORY[reason];
            if (cat) {
                rejectedTotal++;
                document.getElementById("rejectedBadge").innerText = `${rejectedTotal} всего`;
                if (cat === rejectedCategory) prependRejectedCard(evt);
            }
        }

        // Лог: значимые причины показываем всегда (история + живые)
        if (!LOG_SILENT_REASONS.has(reason)) {
            appendLogEntry(evt);
        }

    } else {
        appendLogEntry(evt);
    }

    if (live) {
        if (evt.type === 'vacancy_applied') {
            refreshStatusFromServer();
        }

        if (evt.type === 'search_started') {
            isAutopilotStarting = false;
            void refreshStatusFromServer();
        }

        if (evt.type === 'search_complete') {
            isAutopilotStarting = false;
            refreshStatusFromServer();
            const progressText = document.getElementById("progressText");
            if (progressText) {
                const pct = currentDailyLimit > 0 ? Math.round(currentApplied / currentDailyLimit * 100) : 0;
                progressText.innerText = `Поиск завершён — ${pct}%`;
            }
        }

        if (evt.type === 'search_exhausted') {
            isAutopilotStarting = false;
            refreshStatusFromServer();
            const progressText = document.getElementById("progressText");
            if (progressText) {
                progressText.innerText = `Все вакансии обработаны. Автопилот остановлен.`;
            }
        }

        if (evt.type === 'autopilot_daily_sleep') {
            isAutopilotActive = false;
            stopStatusPolling();
            void refreshStatusFromServer();
        }
    }
}

const REASON_TO_CATEGORY = {
    'filter_already_applied': 'already_applied',
    'filter_test_required': 'has_test',
    'filter_ai_match_low': 'ai_low',
    'filter_archived': 'already_applied',
    'filter_duplicate_title': 'already_applied',
    'filter_in_queue': 'already_applied',
    'filter_employer_blacklist': 'already_applied',
    'filter_rpc_check_failed': 'already_applied',
    'filter_manual_declined': 'already_applied',
};

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
    'search_exhausted':  { icon: 'inventory_2',    color: 'text-[#fbbf24]', label: 'Вакансии исчерпаны' },
    'autopilot_daily_sleep': { icon: 'bedtime', color: 'text-[#fbbf24]', label: 'Лимит на сегодня' },
    'daily_quota_reset': { icon: 'restart_alt', color: 'text-primary', label: 'Новый день' },
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

    let description = buildLogDescription(evt);

    row.innerHTML = `
        <span class="text-primary-fixed-dim font-mono text-xs md:text-sm opacity-50 shrink-0 pt-0.5">${ts}</span>
        <span class="material-symbols-outlined ${cfg.color} text-base md:text-lg shrink-0">${cfg.icon}</span>
        <p class="text-on-surface-variant font-mono text-xs md:text-sm leading-relaxed">${description}</p>
    `;

    container.appendChild(row);

    scrollLogToBottom();
}

function buildLogDescription(evt) {
    if (evt.type === 'vacancy_applied') {
        return `Успешный отклик: <span class="text-on-surface">${esc(evt.vacancy_name || '')} @ ${esc(evt.employer || '')}</span>`;
    }
    if (evt.type === 'vacancy_analyzed') {
        const score = evt.details?.score;
        const reasoning = evt.details?.reasoning;
        const scoreStr = (score !== undefined && score !== null) ? `${score}%` : '';
        let text = `Анализ: <span class="text-on-surface">${esc(evt.vacancy_name || '')}</span>${scoreStr ? ` — ${scoreStr} совпадение` : ''}`;
        if (reasoning) text += `. <span class="text-on-surface-variant/60 italic text-[11px]">${esc(reasoning)}</span>`;
        return text;
    }
    if (evt.type === 'vacancy_rejected') {
        const reason = formatRejectionReason(evt.details?.reason);
        const score = evt.details?.score;
        const reasoning = evt.details?.reasoning;
        let parts = [];
        parts.push(`Пропущено: <span class="text-on-surface">${esc(evt.vacancy_name || '')}</span>`);
        parts.push(`Причина: <span class="text-error italic">${reason}</span>`);
        if (score !== undefined) parts.push(`Score: ${score}%`);
        if (reasoning) parts.push(`<span class="text-on-surface-variant/60 italic text-[11px]">${esc(reasoning)}</span>`);
        return parts.join('. ');
    }
    if (evt.type === 'search_started') {
        const found = evt.details?.found_total || 0;
        return `Поиск запущен. Найдено <span class="text-on-surface font-bold">${found}</span> вакансий.`;
    }
    if (evt.type === 'search_complete') {
        if (evt.details?.daily_limit_reached) {
            return '🛑 Достигнут дневной лимит откликов.';
        }
        if (evt.details?.stopped_by_user) {
            return 'Поиск остановлен пользователем.';
        }
        if (evt.details?.error) {
            return `Поиск завершен с ошибкой: ${esc(evt.details.error)}`;
        }
        const stats = evt.details?.filter_stats;
        if (stats) {
            const added = stats.added_to_queue || 0;
            return `Поиск завершен. В очередь добавлено: <span class="text-on-surface font-bold">${added}</span>`;
        }
        return 'Поиск завершен.';
    }
    if (evt.type === 'search_exhausted') {
        return `Все найденные вакансии уже обработаны. Новых подходящих вакансий не найдено. Автопилот остановлен.`;
    }
    if (evt.type === 'autopilot_daily_sleep') {
        return `Дневной лимит откликов исчерпан. Автопилот на паузе до следующего дня.`;
    }
    if (evt.type === 'daily_quota_reset') {
        return 'Новый календарный день: счётчики откликов сброшены. Отчёт очищен.';
    }
    if (evt.type === 'error') {
        return `Ошибка: ${esc(evt.details?.message || '')}`;
    }
    return esc(JSON.stringify(evt.details || {}));
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

function prependRejectedCard(evt) {
    const list = document.getElementById("rejectedList");
    const emptyEl = document.getElementById("rejectedEmpty");
    if (emptyEl) emptyEl.remove();

    const item = {
        id: evt.id,
        vacancy_id: evt.vacancy_id,
        vacancy_name: evt.vacancy_name,
        employer_name: evt.employer,
        details: evt.details || {},
        created_at: evt.ts,
    };

    const card = createRejectedCard(item);
    card.style.animation = "fadeIn 0.4s ease";
    card.style.opacity = "0";

    list.prepend(card);

    requestAnimationFrame(() => {
        card.style.opacity = "1";
    });
}

function createRejectedCard(item) {
    const card = document.createElement("div");
    card.className = "glass-panel p-3 md:p-4 rounded-xl group hover:bg-surface-container-highest transition-all cursor-pointer";

    const vacId = item.vacancy_id;
    const hhUrl = vacId ? `https://hh.ru/vacancy/${vacId}` : '#';
    const reason = formatRejectionReason(item.details?.reason);
    const score = item.details?.score;
    const reasoning = item.details?.reasoning;
    const time = item.created_at ? timeAgo(new Date(item.created_at)) : '';

    let tagsHtml = `<span class="px-2 py-0.5 bg-error/10 text-error text-[9px] font-bold uppercase tracking-wider rounded-full">${esc(reason)}</span>`;
    if (score !== undefined && score !== null) {
        tagsHtml += `<span class="px-2 py-0.5 bg-surface-container-highest text-on-surface-variant text-[9px] font-bold uppercase tracking-wider rounded-full">${score}%</span>`;
    }

    let reasoningHtml = '';
    if (reasoning) {
        reasoningHtml = `<p class="text-[10px] text-on-surface-variant/60 mt-1.5 line-clamp-2 italic">${esc(reasoning)}</p>`;
    }

    card.innerHTML = `
        <a href="${hhUrl}" target="_blank" rel="noopener" class="flex items-center gap-3 no-underline">
            <div class="w-8 h-8 rounded-md bg-surface-container-highest flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined text-on-surface-variant text-base">work_outline</span>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex justify-between items-center gap-2">
                    <h4 class="font-semibold text-on-surface group-hover:text-primary transition-colors text-xs md:text-sm truncate">${esc(item.employer_name || 'Компания')}</h4>
                    <span class="text-[9px] text-on-surface-variant shrink-0">${time}</span>
                </div>
                <p class="text-[11px] md:text-xs text-on-surface-variant truncate">${esc(item.vacancy_name || 'Вакансия')}</p>
                <div class="flex flex-wrap gap-1 mt-1">${tagsHtml}</div>
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

async function handleNavLogout() {
    try {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
            method: 'POST', credentials: 'include',
        });
    } catch (_) {}
    window.location.href = 'auth.html';
}
