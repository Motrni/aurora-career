/*
   AURORA CAREER — Resume Analysis & Improvement
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

let resumeList = [];
let currentResumeId = null;
let analysisLimits = { used: 0, limit: 5 };
let improvementAvailable = true;
let improvementReason = null;

let analysisPollTimer = null;
let toastHideTimer = null;
let syncPollTimer = null;

window.BOT_USERNAME = "Aurora_Career_Bot";

// ============================================================================
// INIT
// ============================================================================

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
        if (meResponse.status === 401 && window.AuroraSession) {
            const ok = await AuroraSession.refreshNow();
            if (ok) {
                meResponse = await fetch(`${API_BASE_URL}/api/auth/me`, {
                    method: "GET",
                    credentials: "include"
                });
            }
        }
        if (meResponse.ok) {
            const meData = await meResponse.json();
            if (meData.status === "ok") {
                if (meData.need_reauth) {
                    window.location.href = '/reauth/';
                    return;
                }
                if (meData.current_step && meData.current_step.startsWith('onboarding_')) {
                    if (meData.current_step === 'onboarding_settings' || meData.current_step === 'onboarding_save_pending') {
                        window.location.href = '/settings/';
                    } else {
                        window.location.href = '/onboarding/';
                    }
                    return;
                }
                if (!meData.has_access) {
                    window.location.href = '/cabinet/';
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
    await loadResumes();

    document.getElementById("returnBtn").addEventListener("click", () => {
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.close();
        }
        window.location.href = `https://t.me/${window.BOT_USERNAME}`;
    });
});

// ============================================================================
// AUTH HELPERS
// ============================================================================

function propagateAuthToNavLinks() {
    if (authMode !== 'legacy' || !legacyUserId || !legacySign) return;
    const suffix = `?user_id=${legacyUserId}&sign=${legacySign}`;
    document.querySelectorAll('nav a[href^="/settings/"], nav a[href^="/responses/"], nav a[href^="/cabinet/"]').forEach(a => {
        a.href = a.getAttribute('href').split('?')[0] + suffix;
    });
    document.querySelectorAll('#mobile-menu a[href^="/settings/"], #mobile-menu a[href^="/responses/"], #mobile-menu a[href^="/cabinet/"]').forEach(a => {
        a.href = a.getAttribute('href').split('?')[0] + suffix;
    });
}

function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (authMode === 'legacy') {
        headers['X-User-Id'] = legacyUserId;
        headers['X-Sign'] = legacySign;
    }
    return headers;
}

function getFetchOpts(method, body) {
    const opts = {
        method: method || 'GET',
        headers: getAuthHeaders(),
        credentials: 'include'
    };
    if (body) opts.body = JSON.stringify(body);
    return opts;
}

async function authFetch(url, opts) {
    let resp = await fetch(url, opts);
    if (resp.status === 401 && authMode === 'jwt' && window.AuroraSession) {
        const ok = await AuroraSession.refreshNow();
        if (ok) {
            resp = await fetch(url, opts);
        }
    }
    if (resp.status === 403) {
        const subHeader = resp.headers.get('X-Sub-Status');
        if (subHeader) {
            window.location.href = '/cabinet/';
            return null;
        }
    }
    return resp;
}

function handleNavLogout() {
    fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' })
        .finally(() => { window.location.href = '/auth/'; });
}
window.handleNavLogout = handleNavLogout;

// ============================================================================
// LOADING & ERROR
// ============================================================================

function toggleGlobalLoading(isLoading) {
    const skeleton = document.getElementById("globalSkeleton");
    const content = document.getElementById("mainContent");
    if (isLoading) {
        skeleton.style.display = "";
        content.style.display = "none";
    } else {
        skeleton.style.display = "none";
        content.style.display = "";
    }
}

function showError(msg) {
    const el = document.getElementById("errorMsg");
    el.textContent = msg;
    el.style.display = "block";
}

function showToast(text, durationMs) {
    const host = document.getElementById('pageToast');
    const span = document.getElementById('pageToastText');
    if (!host || !span) return;
    span.textContent = text;
    host.setAttribute('aria-hidden', 'false');
    host.classList.add('toast-visible');
    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => {
        host.classList.remove('toast-visible');
        host.setAttribute('aria-hidden', 'true');
    }, durationMs || 3500);
}

// ============================================================================
// LOAD RESUMES
// ============================================================================

async function loadResumes() {
    try {
        const resp = await authFetch(
            `${API_BASE_URL}/api/resumes/list`,
            getFetchOpts('GET')
        );
        if (!resp) return;

        if (!resp.ok) {
            showError("Не удалось загрузить список резюме.");
            toggleGlobalLoading(false);
            return;
        }

        const data = await resp.json();
        resumeList = data.resumes || [];
        analysisLimits = {
            used: data.analysis_used || 0,
            limit: data.analysis_limit || 5
        };
        improvementAvailable = data.improvement_available !== false;
        improvementReason = data.improvement_reason || null;

        updateLimitsBar();
        renderResumeCards(true);
        toggleGlobalLoading(false);

    } catch (e) {
        console.error("[Resume] Load failed:", e);
        showError("Ошибка загрузки. Проверьте подключение к интернету.");
        toggleGlobalLoading(false);
    }
}

// ============================================================================
// LIMITS BAR
// ============================================================================

function updateLimitsBar() {
    const remaining = Math.max(0, analysisLimits.limit - analysisLimits.used);
    const elRemaining = document.getElementById('analysisRemaining');
    const elLimit = document.getElementById('analysisLimit');
    const elImprovement = document.getElementById('improvementStatus');

    if (elRemaining) elRemaining.textContent = remaining;
    if (elLimit) elLimit.textContent = analysisLimits.limit;
    if (elImprovement) {
        if (improvementAvailable) {
            elImprovement.textContent = '1 улучшение · доступно';
            elImprovement.style.color = '';
        } else if (improvementReason && improvementReason !== 'PAYWALL') {
            // Show cooldown e.g. "Доступно раз в неделю. Ждать осталось: 3 дн. 12 ч."
            elImprovement.textContent = improvementReason;
            elImprovement.style.color = 'rgba(202,195,215,0.6)';
        } else {
            elImprovement.textContent = 'Недоступно на вашем тарифе';
            elImprovement.style.color = 'rgba(255,180,171,0.7)';
        }
    }
}

// ============================================================================
// RENDER CARDS
// ============================================================================

function renderResumeCards(animateEntrance = false) {
    const grid = document.getElementById('resumeGrid');
    const empty = document.getElementById('resumeEmpty');

    if (!resumeList.length) {
        grid.style.display = 'none';
        empty.classList.remove('hidden');
        return;
    }

    grid.style.display = '';
    empty.classList.add('hidden');
    grid.innerHTML = '';

    resumeList.forEach((r, idx) => {
        const card = createResumeCard(r, idx, animateEntrance);
        grid.appendChild(card);
    });
}

function getScoreTierStroke(score) {
    if (score === null || score === undefined || Number.isNaN(score)) return '#49454f';
    const s = Math.max(0, Math.min(100, Math.round(Number(score))));
    if (s <= 25) return '#ef4444';
    if (s <= 49) return '#fb923c';
    if (s <= 74) return '#3b82f6';
    return '#34d399';
}

function createResumeCard(resume, index, animateEntrance = false) {
    const hasReport = !!resume.resume_analysis_report;
    const score = hasReport ? extractScore(resume.resume_analysis_report) : null;
    const title = resume.resume_title || 'Резюме без названия';
    const updated = resume.last_synced_at
        ? formatDate(resume.last_synced_at)
        : '—';

    const scorePercent = score !== null ? score : 0;
    const circumference = 2 * Math.PI * 28; // r=28
    const offset = circumference - (scorePercent / 100) * circumference;
    const ringStroke = hasReport ? getScoreTierStroke(score) : '#49454f';

    const statusIcon = hasReport ? 'check_circle' : 'schedule';
    const statusText = hasReport ? 'Анализ готов' : 'Анализ не проведен';
    const statusColor = hasReport ? 'text-primary' : 'text-on-surface-variant';
    const statusIconFill = hasReport ? ` style="font-variation-settings:'FILL' 1"` : '';

    const card = document.createElement('div');
    card.className =
        'glass-panel rounded-xl p-6 md:p-8 flex flex-col h-full resume-card cursor-default border border-outline-variant/10 relative overflow-hidden' +
        (animateEntrance ? ' resume-card-animate' : '');
    card.style.animationDelay = animateEntrance ? (index * 0.08) + 's' : '';
    card.dataset.resumeId = resume.resume_id;

    if (animateEntrance) {
        card.addEventListener(
            'animationend',
            (ev) => {
                if (ev.animationName !== 'card-in') return;
                card.classList.remove('resume-card-animate');
                card.style.animationDelay = '';
            },
            { once: true }
        );
    }

    card.innerHTML = `
        <div class="flex justify-between items-start mb-6">
            <div class="min-w-0 flex-1 pr-3">
                <h3 class="text-lg md:text-xl font-bold text-on-surface mb-1 leading-snug truncate">${escapeHtml(title)}</h3>
                <p class="text-xs text-on-surface-variant">Обновлено: ${updated}</p>
            </div>
            <div class="relative w-14 h-14 flex items-center justify-center shrink-0">
                <svg class="w-full h-full -rotate-90 block" viewBox="0 0 64 64">
                    <circle class="score-ring-track" cx="32" cy="32" fill="transparent" r="28" stroke="currentColor" stroke-width="4"></circle>
                    <circle class="score-ring-value" cx="32" cy="32" fill="transparent" r="28" stroke="${ringStroke}" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${hasReport ? offset.toFixed(1) : circumference.toFixed(1)}" stroke-width="4"></circle>
                </svg>
                <span class="absolute text-xs font-black" style="color: ${hasReport ? ringStroke : 'inherit'}">${score !== null ? score + '%' : '—'}</span>
            </div>
        </div>

        <div class="mb-6 flex-grow">
            <div class="flex items-center gap-2 mb-4">
                <span class="material-symbols-outlined ${statusColor} text-sm"${statusIconFill}>${statusIcon}</span>
                <span class="text-[10px] uppercase tracking-widest ${statusColor} font-bold">${statusText}</span>
            </div>
            <div class="space-y-2.5">
                <div class="h-1.5 w-full bg-surface-container rounded-full overflow-hidden">
                    <div class="h-full bg-primary rounded-full opacity-30" style="width: ${hasReport ? '100%' : '0%'}"></div>
                </div>
                <div class="h-1.5 w-3/4 bg-surface-container rounded-full overflow-hidden">
                    <div class="h-full bg-primary rounded-full opacity-30" style="width: ${hasReport ? '100%' : '0%'}"></div>
                </div>
                <div class="h-1.5 w-5/6 bg-surface-container rounded-full overflow-hidden">
                    <div class="h-full bg-primary rounded-full opacity-30" style="width: ${hasReport ? '100%' : '0%'}"></div>
                </div>
            </div>
        </div>

        <div class="flex flex-col gap-2.5" data-card-actions>
            ${hasReport ? `
                <button onclick="openAnalysisModal('${resume.resume_id}')" class="w-full py-3.5 bg-surface-container-highest text-on-surface rounded-xl font-bold hover:bg-surface-bright transition-all flex items-center justify-center gap-2 text-sm cursor-pointer active:scale-[0.97]">
                    <span class="material-symbols-outlined text-primary text-lg">analytics</span>
                    Просмотреть анализ
                </button>
            ` : `
                <button onclick="handleAnalyzeClick('${resume.resume_id}')" class="w-full py-3.5 bg-surface-container-highest text-on-surface rounded-xl font-bold hover:bg-surface-bright transition-all flex items-center justify-center gap-2 text-sm cursor-pointer active:scale-[0.97]">
                    <span class="material-symbols-outlined text-primary text-lg">analytics</span>
                    Запустить анализ
                </button>
            `}
            <button onclick="handleImproveClick('${resume.resume_id}')" class="w-full py-3.5 bg-primary-container text-on-primary-container rounded-xl font-bold hover:shadow-[0_0_20px_rgba(90,48,208,0.4)] transition-all active:scale-[0.97] text-sm cursor-pointer">
                Улучшить резюме
            </button>
        </div>
    `;

    return card;
}

// ============================================================================
// ANALYSIS
// ============================================================================

function handleAnalyzeClick(resumeId) {
    const remaining = analysisLimits.limit - analysisLimits.used;
    if (remaining <= 0) {
        openLimitModal(
            'Лимит анализов исчерпан',
            `Вы использовали все ${analysisLimits.limit} попыток анализа на сегодня. Лимиты обновятся завтра.`
        );
        return;
    }
    currentResumeId = resumeId;
    requestAnalysis();
}

async function requestAnalysis() {
    if (!currentResumeId) return;

    const resumeId = currentResumeId;

    closeAnalysisModal();

    const card = document.querySelector(`[data-resume-id="${resumeId}"]`);
    clearCardNoChangesState(card);
    setCardProcessing(card, true);

    try {
        const resp = await authFetch(
            `${API_BASE_URL}/api/resumes/analyze`,
            getFetchOpts('POST', { resume_id: resumeId })
        );
        if (!resp) {
            setCardProcessing(card, false);
            return;
        }

        const data = await resp.json();

        if (data.error === 'no_changes') {
            setCardProcessing(card, false);
            const msg =
                data.message ||
                'Резюме не изменилось на hh.ru. Новый анализ не требуется.';
            showCardNoChangesState(card, msg);
            return;
        }

        if (!resp.ok) {
            setCardProcessing(card, false);
            if (data.error === 'limit_reached') {
                openLimitModal('Лимит анализов исчерпан', data.message || 'Попробуйте завтра.');
            } else if (data.error === 'cooldown') {
                showToast(data.message || 'Подождите перед повторным запросом', 4000);
            } else {
                showToast(data.message || 'Ошибка при запуске анализа', 4000);
            }
            scrollToCard(card, { scroll: 'if-needed', highlight: false });
            return;
        }

        if (data.status === 'queued') {
            if (typeof data.analysis_used === 'number') {
                analysisLimits.used = data.analysis_used;
                if (typeof data.analysis_limit === 'number') {
                    analysisLimits.limit = data.analysis_limit;
                }
            } else {
                analysisLimits.used++;
            }
            updateLimitsBar();
            showToast(`Анализ поставлен в очередь. Ожидание: ~${data.wait_minutes || 1} мин.`, 5000);
            scrollToCard(card, { scroll: 'if-needed', highlight: false });
            startAnalysisPoll(resumeId);
        } else if (data.status === 'ready') {
            setCardProcessing(card, false);
            updateResumeInList(resumeId, data);
            renderResumeCards(false);
            if (typeof data.analysis_used === 'number') {
                analysisLimits.used = data.analysis_used;
                if (typeof data.analysis_limit === 'number') {
                    analysisLimits.limit = data.analysis_limit;
                }
            } else {
                analysisLimits.used++;
            }
            updateLimitsBar();
            showToast('Анализ завершен!', 3000);
            const updatedCard = document.querySelector(`[data-resume-id="${resumeId}"]`);
            scrollToCard(updatedCard, { scroll: 'if-needed', highlight: true });
        }

    } catch (e) {
        console.error("[Analysis] Request failed:", e);
        setCardProcessing(card, false);
        showToast('Ошибка сети. Попробуйте позже.', 4000);
    }
}

function startAnalysisPoll(resumeId) {
    if (analysisPollTimer) clearInterval(analysisPollTimer);
    let attempts = 0;
    const maxAttempts = 60;

    analysisPollTimer = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
            clearInterval(analysisPollTimer);
            analysisPollTimer = null;
            const card = document.querySelector(`[data-resume-id="${resumeId}"]`);
            setCardProcessing(card, false);
            showToast('Анализ занимает больше времени. Обновите страницу позже.', 5000);
            return;
        }

        try {
            const resp = await authFetch(
                `${API_BASE_URL}/api/resumes/analysis-status?resume_id=${encodeURIComponent(resumeId)}`,
                getFetchOpts('GET')
            );
            if (!resp) return;
            const data = await resp.json();

            if (data.status === 'ready') {
                clearInterval(analysisPollTimer);
                analysisPollTimer = null;
                updateResumeInList(resumeId, data);
                renderResumeCards(false);
                showToast('Анализ резюме готов!', 3500);
                const updatedCard = document.querySelector(`[data-resume-id="${resumeId}"]`);
                scrollToCard(updatedCard, { scroll: 'if-needed', highlight: true });
            }
        } catch (e) {
            console.error("[Analysis] Poll error:", e);
        }
    }, 5000);
}

function updateResumeInList(resumeId, data) {
    const idx = resumeList.findIndex(r => r.resume_id === resumeId);
    if (idx === -1) return;
    if (data.resume_analysis_report) {
        resumeList[idx].resume_analysis_report = data.resume_analysis_report;
    }
    if (data.last_synced_at) {
        resumeList[idx].last_synced_at = data.last_synced_at;
    }
}

function clearCardNoChangesState(card) {
    if (!card) return;
    const toast = card.querySelector('.card-no-changes-toast');
    if (toast) toast.remove();
}

const NO_CHANGES_TOAST_SHOW_MS = 3600;
const NO_CHANGES_TOAST_FADE_MS = 420;

function showCardNoChangesState(card, message) {
    if (!card) return;
    clearCardNoChangesState(card);

    const toast = document.createElement('div');
    toast.className = 'card-no-changes-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
        <div class="card-no-changes-toast__panel">
            <span class="material-symbols-outlined card-no-changes-toast__icon" aria-hidden="true">info</span>
            <p class="card-no-changes-toast__text">${escapeHtml(message)}</p>
        </div>`;
    card.insertBefore(toast, card.firstChild);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add('card-no-changes-toast--visible'));
    });

    window.setTimeout(() => {
        toast.classList.remove('card-no-changes-toast--visible');
        toast.classList.add('card-no-changes-toast--hiding');
        window.setTimeout(() => toast.remove(), NO_CHANGES_TOAST_FADE_MS + 80);
    }, NO_CHANGES_TOAST_SHOW_MS);
}

function setCardProcessing(card, isProcessing) {
    if (!card) return;
    if (isProcessing) clearCardNoChangesState(card);
    const buttons = card.querySelectorAll('button');
    buttons.forEach(btn => {
        btn.disabled = isProcessing;
        if (isProcessing) {
            btn.style.opacity = '0.5';
            btn.style.pointerEvents = 'none';
        } else {
            btn.style.opacity = '';
            btn.style.pointerEvents = '';
        }
    });

    let overlay = card.querySelector('.card-processing-overlay');
    if (isProcessing) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'card-processing-overlay';
            overlay.innerHTML = `
                <div class="flex flex-col items-center gap-3">
                    <div class="processing-spinner"></div>
                    <span class="text-sm font-bold text-on-surface/80">AI анализирует…</span>
                </div>`;
            card.style.position = 'relative';
            card.appendChild(overlay);
        }
    } else if (overlay) {
        overlay.remove();
    }
}

function scrollToCard(card, opts = {}) {
    const { scroll = 'if-needed', highlight = true } = opts;
    if (!card) return;

    if (scroll !== 'none') {
        const rect = card.getBoundingClientRect();
        const margin = 96;
        const vh = window.innerHeight;
        const needs =
            rect.top < margin ||
            rect.bottom > vh - margin ||
            rect.height > vh - margin * 2;
        if (scroll === 'always' || (scroll === 'if-needed' && needs)) {
            card.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
    }

    if (highlight) {
        card.classList.add('card-highlight');
        window.setTimeout(() => card.classList.remove('card-highlight'), 1800);
    }
}

// ============================================================================
// ANALYSIS MODAL
// ============================================================================

function openAnalysisModal(resumeId) {
    currentResumeId = resumeId;
    const resume = resumeList.find(r => r.resume_id === resumeId);
    if (!resume) return;

    const title = resume.resume_title || 'Резюме';
    const report = resume.resume_analysis_report || '';
    const score = extractScore(report);

    document.getElementById('analysisModalTitle').textContent = title;
    document.getElementById('analysisModalBody').innerHTML = renderMarkdown(report);

    if (score !== null) {
        const circumference = 2 * Math.PI * 28;
        const offset = circumference - (score / 100) * circumference;
        const stroke = getScoreTierStroke(score);
        const ringEl = document.getElementById('analysisModalRing');
        ringEl.setAttribute('stroke', stroke);
        ringEl.setAttribute('stroke-dashoffset', offset.toFixed(1));
        const scoreEl = document.getElementById('analysisModalScore');
        scoreEl.textContent = score + '%';
        scoreEl.style.color = stroke;
        document.getElementById('analysisModalScoreLabel').textContent = getScoreLabel(score);
        document.getElementById('analysisModalScoreDesc').textContent = getScoreDescription(score);
        document.getElementById('analysisScoreSummary').classList.remove('hidden');
    } else {
        document.getElementById('analysisScoreSummary').classList.add('hidden');
        const ringEl = document.getElementById('analysisModalRing');
        ringEl.setAttribute('stroke', '#49454f');
        document.getElementById('analysisModalScore').style.color = '';
    }

    openModal('analysisModal', 'analysisModalCard');
}

function closeAnalysisModal() {
    closeModal('analysisModal', 'analysisModalCard');
}
window.closeAnalysisModal = closeAnalysisModal;
window.openAnalysisModal = openAnalysisModal;
window.requestAnalysis = requestAnalysis;

// ============================================================================
// IMPROVEMENT MODAL
// ============================================================================

let improveSession = null;

function handleImproveClick(resumeId) {
    if (!improvementAvailable) {
        openLimitModal(
            'Улучшение недоступно',
            'Функция AI-улучшения резюме сейчас недоступна. Попробуйте позже или обратитесь в поддержку.'
        );
        return;
    }
    currentResumeId = resumeId;
    startImproveFlow(resumeId);
}

async function startImproveFlow(resumeId) {
    document.getElementById('improveStepInterview').classList.remove('hidden');
    document.getElementById('improveStepProcessing').classList.add('hidden');
    document.getElementById('improveStepSuccess').classList.add('hidden');
    document.getElementById('improveAnswerInput').value = '';

    openModal('improveModal', 'improveModalCard');

    try {
        const resp = await authFetch(
            `${API_BASE_URL}/api/resumes/improve/start`,
            getFetchOpts('POST', { resume_id: resumeId })
        );
        if (!resp) return;
        const data = await resp.json();

        if (!resp.ok) {
            closeImproveModal();
            showToast(data.message || 'Не удалось начать улучшение', 4000);
            return;
        }

        improveSession = {
            sessionId: data.session_id,
            resumeId: resumeId,
            questionIndex: 0,
            totalQuestions: data.total_questions || 5,
            currentQuestion: data.question
        };

        renderImproveQuestion();

    } catch (e) {
        console.error("[Improve] Start failed:", e);
        closeImproveModal();
        showToast('Ошибка сети при запуске улучшения.', 4000);
    }
}

function renderImproveQuestion() {
    if (!improveSession) return;
    const q = improveSession;
    document.getElementById('improveQuestionNum').textContent = q.questionIndex + 1;
    document.getElementById('improveQuestionTotal').textContent = q.totalQuestions;
    document.getElementById('improveQuestionText').textContent = q.currentQuestion || 'Загрузка...';
    document.getElementById('improveAnswerInput').value = '';
    document.getElementById('improveAnswerInput').focus();

    const dots = document.getElementById('improveProgressDots');
    dots.innerHTML = '';
    for (let i = 0; i < q.totalQuestions; i++) {
        const dot = document.createElement('div');
        dot.className = 'w-2 h-2 rounded-full ' + (i <= q.questionIndex ? 'bg-primary' : 'bg-surface-container-highest');
        dots.appendChild(dot);
    }
}

async function submitImproveAnswer() {
    if (!improveSession) return;
    const answer = document.getElementById('improveAnswerInput').value.trim();
    if (!answer) {
        document.getElementById('improveAnswerInput').classList.add('ring-2', 'ring-error/50');
        setTimeout(() => document.getElementById('improveAnswerInput').classList.remove('ring-2', 'ring-error/50'), 1500);
        return;
    }
    await sendImproveAnswer(answer);
}
window.submitImproveAnswer = submitImproveAnswer;

async function skipImproveQuestion() {
    await sendImproveAnswer('');
}
window.skipImproveQuestion = skipImproveQuestion;

async function sendImproveAnswer(answer) {
    if (!improveSession) return;

    const nextBtn = document.getElementById('improveNextBtn');
    const skipBtn = document.getElementById('improveSkipBtn');
    nextBtn.disabled = true;
    skipBtn.disabled = true;

    try {
        const resp = await authFetch(
            `${API_BASE_URL}/api/resumes/improve/answer`,
            getFetchOpts('POST', {
                session_id: improveSession.sessionId,
                answer: answer,
                question_index: improveSession.questionIndex
            })
        );
        if (!resp) return;
        const data = await resp.json();

        if (data.status === 'next_question') {
            improveSession.questionIndex++;
            improveSession.currentQuestion = data.question;
            renderImproveQuestion();
        } else if (data.status === 'processing') {
            showImproveProcessing();
            startImprovePoll();
        } else if (data.status === 'complete') {
            showImproveSuccess(data.pdf_url);
        }

    } catch (e) {
        console.error("[Improve] Answer failed:", e);
        showToast('Ошибка при отправке ответа', 3000);
    } finally {
        nextBtn.disabled = false;
        skipBtn.disabled = false;
    }
}

function showImproveProcessing() {
    document.getElementById('improveStepInterview').classList.add('hidden');
    document.getElementById('improveStepProcessing').classList.remove('hidden');
    document.getElementById('improveStepSuccess').classList.add('hidden');

    let progress = 10;
    const bar = document.getElementById('improveProgressBar');
    const interval = setInterval(() => {
        progress = Math.min(progress + Math.random() * 8, 92);
        bar.style.width = progress + '%';
    }, 2000);
    bar._interval = interval;
}

function startImprovePoll() {
    if (!improveSession) return;
    let attempts = 0;

    const poll = setInterval(async () => {
        attempts++;
        if (attempts > 40) {
            clearInterval(poll);
            showToast('Генерация занимает больше времени. Проверьте позже.', 5000);
            return;
        }
        try {
            const resp = await authFetch(
                `${API_BASE_URL}/api/resumes/improve/status?session_id=${encodeURIComponent(improveSession.sessionId)}`,
                getFetchOpts('GET')
            );
            if (!resp) return;
            const data = await resp.json();

            if (data.status === 'complete') {
                clearInterval(poll);
                const bar = document.getElementById('improveProgressBar');
                if (bar._interval) clearInterval(bar._interval);
                bar.style.width = '100%';
                setTimeout(() => showImproveSuccess(data.pdf_url), 600);
            }
        } catch (e) {
            console.error("[Improve] Poll error:", e);
        }
    }, 5000);
}

function showImproveSuccess(pdfUrl) {
    document.getElementById('improveStepInterview').classList.add('hidden');
    document.getElementById('improveStepProcessing').classList.add('hidden');
    document.getElementById('improveStepSuccess').classList.remove('hidden');
    if (pdfUrl) {
        document.getElementById('improvePdfLink').href = pdfUrl;
        document.getElementById('improvePdfLink').classList.remove('hidden');
    } else {
        document.getElementById('improvePdfLink').classList.add('hidden');
    }
}

function closeImproveModal() {
    improveSession = null;
    closeModal('improveModal', 'improveModalCard');
}
window.closeImproveModal = closeImproveModal;
window.handleImproveClick = handleImproveClick;
window.handleAnalyzeClick = handleAnalyzeClick;

// ============================================================================
// LIMIT MODAL
// ============================================================================

function openLimitModal(title, desc) {
    document.getElementById('limitModalTitle').textContent = title;
    document.getElementById('limitModalDesc').textContent = desc;
    openModal('limitModal', 'limitModalCard');
}

function closeLimitModal() {
    closeModal('limitModal', 'limitModalCard');
}
window.closeLimitModal = closeLimitModal;

// ============================================================================
// ANALYSIS INFO MODAL
// ============================================================================

function openAnalysisInfoModal() {
    openInfoModal('analysisInfoModal', 'analysisInfoCard');
}

function closeAnalysisInfoModal() {
    closeInfoModal('analysisInfoModal', 'analysisInfoCard');
}

window.openAnalysisInfoModal = openAnalysisInfoModal;
window.closeAnalysisInfoModal = closeAnalysisInfoModal;

// ============================================================================
// IMPROVEMENT INFO MODAL
// ============================================================================

function openImprovementInfoModal() {
    // Populate cooldown block if needed
    const cooldownBlock = document.getElementById('improvementInfoCooldown');
    const cooldownText = document.getElementById('improvementInfoCooldownText');
    if (cooldownBlock && cooldownText) {
        if (!improvementAvailable && improvementReason && improvementReason !== 'PAYWALL') {
            const match = improvementReason.match(/Ждать осталось:\s*(.+)/);
            if (match) {
                cooldownText.textContent = match[1].trim();
                cooldownBlock.classList.remove('hidden');
            } else {
                cooldownBlock.classList.add('hidden');
            }
        } else {
            cooldownBlock.classList.add('hidden');
        }
    }
    openInfoModal('improvementInfoModal', 'improvementInfoCard');
}

function closeImprovementInfoModal() {
    closeInfoModal('improvementInfoModal', 'improvementInfoCard');
}

window.openImprovementInfoModal = openImprovementInfoModal;
window.closeImprovementInfoModal = closeImprovementInfoModal;

// ============================================================================
// INFO MODAL HELPERS (compact modals without backdrop element ID)
// ============================================================================

function openInfoModal(modalId, cardId) {
    const modal = document.getElementById(modalId);
    const card = document.getElementById(cardId);
    if (!modal || !card) return;

    modal.classList.remove('pointer-events-none');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('overflow-hidden');

    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modal.classList.add('opacity-100');
        card.classList.remove('scale-95', 'opacity-0');
        card.classList.add('scale-100', 'opacity-100');
    });
}

function closeInfoModal(modalId, cardId) {
    const modal = document.getElementById(modalId);
    const card = document.getElementById(cardId);
    if (!modal || !card) return;

    card.classList.remove('scale-100', 'opacity-100');
    card.classList.add('scale-95', 'opacity-0');
    modal.classList.remove('opacity-100');
    modal.classList.add('opacity-0');

    setTimeout(() => {
        modal.classList.add('pointer-events-none');
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('overflow-hidden');
    }, 250);
}

// ============================================================================
// SYNC RESUMES
// ============================================================================

async function syncResumes() {
    const btn = document.getElementById('syncBtn');
    const statusText = document.getElementById('syncStatusText');
    if (!btn) return;

    // Guard: already syncing
    if (btn.classList.contains('syncing')) return;

    btn.classList.add('syncing');
    btn.disabled = true;
    const label = btn.querySelector('.sync-btn-label');
    if (label) label.textContent = 'Синхронизация...';
    if (statusText) statusText.textContent = 'Обновление...';

    // Hide cards with subtle overlay while syncing
    const grid = document.getElementById('resumeGrid');
    if (grid) grid.classList.add('sync-grid-overlay');

    try {
        const resp = await authFetch(
            `${API_BASE_URL}/api/resumes/sync`,
            getFetchOpts('POST', {})
        );
        if (!resp) {
            _syncDone(false, 'Нет соединения');
            return;
        }
        if (resp.status === 403) {
            _syncDone(false, 'Нет доступа');
            showToast('Для синхронизации требуется авторизация через hh.ru.', 4000);
            return;
        }
        if (!resp.ok) {
            _syncDone(false, 'Ошибка');
            showToast('Не удалось запустить синхронизацию.', 4000);
            return;
        }

        const data = await resp.json();

        if (data.status === 'cooldown') {
            _syncDone(false, 'Обновить с hh.ru');
            const left = data.seconds_left || 0;
            const h = Math.floor(left / 3600);
            const m = Math.floor((left % 3600) / 60);
            const timeStr = h > 0 ? `${h} ч. ${m} мин.` : `${m} мин.`;
            showToast(`Синхронизация доступна раз в 2 часа. Следующая через: ${timeStr}`, 5000);
            if (statusText) {
                statusText.textContent = `Доступно через ${timeStr}`;
                setTimeout(() => { if (statusText) statusText.textContent = 'Обновить с hh.ru'; }, 10000);
            }
            return;
        }

        if (data.status === 'already_running') {
            if (statusText) statusText.textContent = 'Уже выполняется...';
        }
        // Start polling
        _pollSyncStatus();

    } catch (e) {
        console.error('[Sync] Error:', e);
        _syncDone(false, 'Ошибка');
    }
}
window.syncResumes = syncResumes;

function _pollSyncStatus(attempts = 0) {
    if (syncPollTimer) clearTimeout(syncPollTimer);
    const maxAttempts = 45; // 45 * 2s = 90s timeout

    syncPollTimer = setTimeout(async () => {
        try {
            const resp = await authFetch(
                `${API_BASE_URL}/api/resumes/sync/status`,
                getFetchOpts('GET')
            );
            if (!resp) {
                _syncDone(false, 'Нет соединения');
                return;
            }
            const data = await resp.json();
            const status = data.status || 'idle';

            if (status === 'complete') {
                _syncDone(true, 'Обновлено');
                showToast('Список резюме обновлён с hh.ru', 3000);
                // Reload resume list without animation entrance
                await loadResumes();
                return;
            }

            if (status === 'error_login') {
                _syncDone(false, 'Ошибка входа');
                showToast('Сессия hh.ru истекла. Выполните повторную авторизацию.', 5000);
                return;
            }

            if (status === 'error_generic') {
                _syncDone(false, 'Ошибка');
                showToast('Синхронизация не удалась. Попробуйте позже.', 4000);
                return;
            }

            // Still processing
            if (attempts >= maxAttempts) {
                _syncDone(false, 'Таймаут');
                showToast('Синхронизация заняла слишком много времени. Попробуйте позже.', 4000);
                return;
            }

            _pollSyncStatus(attempts + 1);
        } catch (e) {
            console.error('[Sync] Poll error:', e);
            _syncDone(false, 'Ошибка');
        }
    }, 2000);
}

function _syncDone(success, label) {
    if (syncPollTimer) {
        clearTimeout(syncPollTimer);
        syncPollTimer = null;
    }

    const btn = document.getElementById('syncBtn');
    const statusText = document.getElementById('syncStatusText');
    const grid = document.getElementById('resumeGrid');

    if (grid) grid.classList.remove('sync-grid-overlay');

    if (btn) {
        btn.classList.remove('syncing');
        btn.disabled = false;
        const btnLabel = btn.querySelector('.sync-btn-label');
        if (btnLabel) btnLabel.textContent = 'Обновить';
    }

    if (statusText) {
        statusText.textContent = label || 'Обновить с hh.ru';
        setTimeout(() => {
            if (statusText) statusText.textContent = 'Обновить с hh.ru';
        }, 4000);
    }
}

// ============================================================================
// GENERIC MODAL HELPERS
// ============================================================================

function openModal(modalId, cardId) {
    const modal = document.getElementById(modalId);
    const card = document.getElementById(cardId);
    if (!modal || !card) return;

    modal.classList.remove('pointer-events-none');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('overflow-hidden');

    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modal.classList.add('opacity-100');
        card.classList.remove('scale-95', 'opacity-0');
        card.classList.add('scale-100', 'opacity-100');
    });

    const backdrop = modal.querySelector('[id$="Backdrop"]');
    if (backdrop) {
        backdrop.addEventListener('click', () => {
            if (modalId === 'analysisModal') closeAnalysisModal();
            else if (modalId === 'improveModal') closeImproveModal();
            else if (modalId === 'limitModal') closeLimitModal();
        }, { once: true });
    }
}

function closeModal(modalId, cardId) {
    const modal = document.getElementById(modalId);
    const card = document.getElementById(cardId);
    if (!modal || !card) return;

    card.classList.remove('scale-100', 'opacity-100');
    card.classList.add('scale-95', 'opacity-0');
    modal.classList.remove('opacity-100');
    modal.classList.add('opacity-0');

    setTimeout(() => {
        modal.classList.add('pointer-events-none');
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('overflow-hidden');
    }, 300);
}

// ============================================================================
// UTILITIES
// ============================================================================

function extractScore(reportText) {
    if (!reportText) return null;
    const patterns = [
        /(\d{1,3})\s*(?:из\s*100|\/\s*100|%)/i,
        /(?:оценка|score|балл|рейтинг)[:\s]*(\d{1,3})/i,
        /(\d{1,3})\s*(?:баллов|points)/i
    ];
    for (const p of patterns) {
        const m = reportText.match(p);
        if (m) {
            const val = parseInt(m[1], 10);
            if (val >= 0 && val <= 100) return val;
        }
    }
    return null;
}

function getScoreLabel(score) {
    if (score >= 90) return 'Отличное резюме';
    if (score >= 75) return 'Хорошее резюме';
    if (score >= 50) return 'Есть потенциал';
    return 'Требует доработки';
}

function getScoreDescription(score) {
    if (score >= 90) return 'Минимальные правки — и вы на вершине';
    if (score >= 75) return 'Несколько улучшений выделят вас среди конкурентов';
    if (score >= 50) return 'Рекомендуем воспользоваться AI-улучшением';
    return 'Используйте AI-улучшение для значительного роста качества';
}

function renderMarkdown(text) {
    if (!text) return '<p class="text-on-surface-variant/50">Отчет пуст.</p>';

    let html = escapeHtml(text);

    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/<\/blockquote>\s*<blockquote>/g, '<br>');

    const lines = html.split('\n');
    let result = '';
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<blockquote') || trimmed.startsWith('<li')) {
            result += trimmed;
        } else {
            result += '<p>' + trimmed + '</p>';
        }
    }

    return result;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDate(isoStr) {
    try {
        const d = new Date(isoStr);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        return `${day}.${month} ${hours}:${mins}`;
    } catch {
        return '—';
    }
}
