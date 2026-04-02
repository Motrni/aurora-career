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

let analysisPollTimer = null;
let toastHideTimer = null;

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

        updateLimitsBar();
        renderResumeCards();
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
        elImprovement.textContent = improvementAvailable ? 'Доступно' : 'Лимит исчерпан';
        elImprovement.style.color = improvementAvailable ? '' : '#ffb4ab';
    }
}

// ============================================================================
// RENDER CARDS
// ============================================================================

function renderResumeCards() {
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
        const card = createResumeCard(r, idx);
        grid.appendChild(card);
    });
}

function createResumeCard(resume, index) {
    const hasReport = !!resume.resume_analysis_report;
    const score = hasReport ? extractScore(resume.resume_analysis_report) : null;
    const title = resume.resume_title || 'Резюме без названия';
    const updated = resume.last_synced_at
        ? formatDate(resume.last_synced_at)
        : '—';

    const scorePercent = score !== null ? score : 0;
    const circumference = 2 * Math.PI * 28; // r=28
    const offset = circumference - (scorePercent / 100) * circumference;

    const statusIcon = hasReport ? 'sync' : 'schedule';
    const statusText = hasReport ? 'Анализ готов' : 'Анализ не проведен';
    const statusColor = hasReport ? 'text-primary' : 'text-on-surface-variant';

    const card = document.createElement('div');
    card.className = 'glass-panel rounded-xl p-6 md:p-8 flex flex-col h-full resume-card resume-card-animate cursor-default border border-outline-variant/10';
    card.style.animationDelay = (index * 0.08) + 's';
    card.dataset.resumeId = resume.resume_id;

    card.innerHTML = `
        <div class="flex justify-between items-start mb-6">
            <div class="min-w-0 flex-1 pr-3">
                <h3 class="text-lg md:text-xl font-bold text-on-surface mb-1 leading-snug truncate">${escapeHtml(title)}</h3>
                <p class="text-xs text-on-surface-variant">Обновлено: ${updated}</p>
            </div>
            <div class="relative w-14 h-14 flex items-center justify-center shrink-0">
                <svg class="w-full h-full -rotate-90 block" viewBox="0 0 64 64">
                    <circle class="score-ring-track" cx="32" cy="32" fill="transparent" r="28" stroke="currentColor" stroke-width="4"></circle>
                    <circle class="score-ring-value ${hasReport ? 'text-primary' : 'text-surface-container-highest'}" cx="32" cy="32" fill="transparent" r="28" stroke="currentColor" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${hasReport ? offset.toFixed(1) : circumference.toFixed(1)}" stroke-width="4"></circle>
                </svg>
                <span class="absolute text-xs font-black">${score !== null ? score + '%' : '—'}</span>
            </div>
        </div>

        <div class="mb-6 flex-grow">
            <div class="flex items-center gap-2 mb-4">
                <span class="material-symbols-outlined ${statusColor} text-sm">${statusIcon}</span>
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

        <div class="flex flex-col gap-2.5">
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
    const card = document.querySelector(`[data-resume-id="${resumeId}"]`);

    setCardProcessing(card, true);

    try {
        const resp = await authFetch(
            `${API_BASE_URL}/api/resumes/analyze`,
            getFetchOpts('POST', { resume_id: resumeId })
        );
        if (!resp) return;

        const data = await resp.json();

        if (!resp.ok) {
            setCardProcessing(card, false);
            if (data.error === 'limit_reached') {
                openLimitModal('Лимит анализов исчерпан', data.message || 'Попробуйте завтра.');
            } else if (data.error === 'cooldown') {
                showToast(data.message || 'Подождите перед повторным запросом', 4000);
            } else if (data.error === 'no_changes') {
                showToast('Изменений на hh.ru не обнаружено. Новый анализ не требуется.', 5000);
            } else {
                showToast(data.message || 'Ошибка при запуске анализа', 4000);
            }
            return;
        }

        if (data.status === 'queued') {
            showToast(`Анализ поставлен в очередь. Ожидание: ~${data.wait_minutes || 1} мин.`, 5000);
            startAnalysisPoll(resumeId);
        } else if (data.status === 'ready') {
            updateResumeInList(resumeId, data);
            renderResumeCards();
            analysisLimits.used++;
            updateLimitsBar();
            showToast('Анализ завершен!', 3000);
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
                analysisLimits.used++;
                updateLimitsBar();
                renderResumeCards();
                showToast('Анализ резюме готов!', 3500);
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

function setCardProcessing(card, isProcessing) {
    if (!card) return;
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

    const statusEl = card.querySelector('.tracking-widest');
    if (statusEl && isProcessing) {
        statusEl.textContent = 'AI обрабатывает...';
        statusEl.className = statusEl.className.replace('text-primary', 'text-secondary').replace('text-on-surface-variant', 'text-secondary');
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
        document.getElementById('analysisModalScore').textContent = score + '%';
        document.getElementById('analysisModalRing').setAttribute('stroke-dashoffset', offset.toFixed(1));
        document.getElementById('analysisModalScoreLabel').textContent = getScoreLabel(score);
        document.getElementById('analysisModalScoreDesc').textContent = getScoreDescription(score);
        document.getElementById('analysisScoreSummary').classList.remove('hidden');
    } else {
        document.getElementById('analysisScoreSummary').classList.add('hidden');
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
