/**
 * onboarding.js — Первая настройка Aurora Career.
 * Шаг 1: Привязка HH.ru аккаунта (табы Телефон/Почта, OTP после NEED_CODE)
 * Шаг 2: Выбор резюме (полное название, без truncate)
 * Шаг 3: AI-анализ резюме (gauge + отчёт)
 * Шаг 4: Настройка поискового профиля (роли → Pro-запрос)
 */

const API_BASE_URL = window.AuroraSession
    ? window.AuroraSession.getApiBase()
    : ((window.location.hostname.includes('twc1.net') || window.location.hostname.includes('aurora-develop'))
        ? 'https://api.aurora-develop.ru'
        : 'https://api.aurora-career.ru');

let currentUser = null;
let selectedResumeId = null;
let isAuditUser = false;
let pollInterval = null;
let analysisInterval = null;
let textRotateInterval = null;
let rolesInterval = null;
let profileInterval = null;
let rolesTextInterval = null;
let rolesPollingStartedAt = null;
let rolesRetryCount = 0;
const ROLES_MAX_RETRIES = 3;
const ROLES_STALE_TIMEOUT_MS = 5 * 60 * 1000;
let activeTab = 'phone';
let currentRoles = [];

const ROLES_PHRASES = [
    'Ищу подходящие вакансии...',
    'Анализирую заголовки...',
    'Группирую по категориям...',
    'Формирую роли...',
];

const ANALYSIS_PHRASES = [
    'Анализирую опыт работы...',
    'Оцениваю ключевые навыки...',
    'Изучаю структуру резюме...',
    'Проверяю релевантность...',
    'Сравниваю с лучшими практиками...',
    'Формирую рекомендации...',
];

// ============================================================================
// API HELPER
// ============================================================================

async function apiFetch(url, options = {}) {
    options.credentials = 'include';
    let resp = await fetch(url, options);

    if (resp.status === 403) {
        var subStatus = resp.headers.get('X-Sub-Status');
        if (subStatus) {
            window.location.href = '/cabinet/';
            return null;
        }
    }

    if (resp.status === 401 && window.AuroraSession) {
        const ok = await AuroraSession.refreshNow();
        if (ok) {
            resp = await fetch(url, options);
        } else {
            window.location.href = '/auth/';
            return null;
        }
    }
    return resp;
}

// ============================================================================
// INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        let meResp = await fetch(`${API_BASE_URL}/api/auth/me`, {
            method: 'GET', credentials: 'include',
        });

        if (meResp.status === 401 && window.AuroraSession) {
            const ok = await AuroraSession.refreshNow();
            if (ok) {
                meResp = await fetch(`${API_BASE_URL}/api/auth/me`, {
                    method: 'GET', credentials: 'include',
                });
            }
        }

        if (!meResp.ok) {
            window.location.href = '/auth/';
            return;
        }

        const data = await meResp.json();
        if (data.status !== 'ok') {
            window.location.href = '/auth/';
            return;
        }

        currentUser = data;
        isAuditUser = data.registration_source === 'audit';

        if (isAuditUser) {
            const dot5 = document.getElementById('stepDot5');
            const line4 = document.getElementById('stepLine4');
            if (dot5) dot5.style.display = 'none';
            if (line4) line4.style.display = 'none';
        }

        if (typeof checkRegModal === 'function') {
            checkRegModal(data);
        }

        if (data.need_reauth) {
            window.location.href = '/reauth/';
            return;
        }

        if (!data.current_step || !data.current_step.startsWith('onboarding_')) {
            if (!data.has_access) {
                window.location.href = '/cabinet/';
            } else {
                window.location.href = '/settings/';
            }
            return;
        }

        if (window.AuroraSession) {
            window.AuroraSession.startPing();
        }

        initOnboarding(data.current_step);
        loadHhConnectedCount();

    } catch (e) {
        console.error('[Onboarding] Init error:', e);
        window.location.href = '/auth/';
    }
});

function loadHhConnectedCount() {
    fetch(`${API_BASE_URL}/api/hh/connected-count`, { method: 'GET', credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            if (!data || !data.count) return;
            const numEl = document.getElementById('hhConnectedNum');
            const wrapEl = document.getElementById('hhConnectedCount');
            if (numEl) numEl.textContent = data.count.toLocaleString('ru-RU');
            if (wrapEl) wrapEl.classList.remove('hidden');
        })
        .catch(() => {});
}

function initOnboarding(step) {
    document.getElementById('loadingSkeleton').classList.add('hidden');
    document.getElementById('mainContent').classList.remove('hidden');

    // Audit users: profile steps are step 3 (not 4), no analysis step
    const profileStepNum = isAuditUser ? 3 : 4;

    if (step === 'onboarding_settings') {
        window.location.href = '/settings/';
        return;
    } else if (step === 'onboarding_profile_complete') {
        showStep(profileStepNum);
        showProfileComplete();
    } else if (step === 'onboarding_query_generating') {
        showStep(profileStepNum);
        showQueryGenerating();
        startProfilePolling();
    } else if (step === 'onboarding_roles_ready') {
        showStep(profileStepNum);
        loadRolesFromServer();
    } else if (step === 'onboarding_search_profile') {
        showStep(profileStepNum);
        startRolesPolling();
        startRolesTextRotation();
    } else if (step === 'onboarding_cluster_error') {
        showStep(profileStepNum);
        loadRolesFromServer();
    } else if (step === 'onboarding_analysis_complete') {
        showStep(3);
        loadAnalysisResult();
    } else if (step === 'onboarding_analysis') {
        showStep(3);
        startAnalysisPolling();
        startTextRotation();
    } else if (step === 'onboarding_resume_select') {
        showStep(2);
    } else {
        showStep(1);
    }
}

// ============================================================================
// STEPPER (5 steps)
// ============================================================================

function showStep(stepNum) {
    const visibleDotCount = isAuditUser ? 4 : 5;
    const visibleLineCount = isAuditUser ? 3 : 4;
    const dots = [1, 2, 3, 4, 5].map(i => document.getElementById(`stepDot${i}`));
    const lines = [1, 2, 3, 4].map(i => document.getElementById(`stepLine${i}`));
    const steps = [1, 2, 3, 4].map(i => document.getElementById(`step${i}`));
    const checkIcon = '<span class="material-symbols-outlined text-sm">check</span>';
    const wrapper = document.getElementById('contentWrapper');

    steps.forEach(el => { if (el) el.classList.add('hidden'); });

    // For audit users visual step 3 → content div step4 (skip analysis)
    let contentIdx = stepNum - 1;
    if (isAuditUser && stepNum >= 3) contentIdx = 3; // step4 div = search profile

    if (wrapper) {
        if (stepNum <= 2) wrapper.style.maxWidth = '480px';
        else if (!isAuditUser && stepNum === 3) wrapper.style.maxWidth = '640px';
        else wrapper.style.maxWidth = '960px';
    }

    dots.forEach((dot, i) => {
        if (!dot) return;
        const num = i + 1;
        if (num > visibleDotCount) return;
        if (num < stepNum) {
            dot.className = 'stepper-dot completed';
            dot.innerHTML = checkIcon;
        } else if (num === stepNum) {
            dot.className = 'stepper-dot active';
            dot.textContent = String(num);
        } else {
            dot.className = 'stepper-dot pending';
            dot.textContent = String(num);
        }
    });

    lines.forEach((line, i) => {
        if (!line) return;
        if (i + 1 > visibleLineCount) return;
        line.className = (i + 1) < stepNum ? 'stepper-line active' : 'stepper-line pending';
    });

    if (steps[contentIdx]) steps[contentIdx].classList.remove('hidden');

    if (stepNum === 2) loadResumes();
}

// ============================================================================
// TAB SWITCHING: phone / email
// ============================================================================

function switchTab(tab) {
    activeTab = tab;
    const phoneTab = document.getElementById('tabPhone');
    const emailTab = document.getElementById('tabEmail');
    const phoneInput = document.getElementById('inputPhone');
    const emailInput = document.getElementById('inputEmail');
    const errorEl = document.getElementById('hhLoginError');

    errorEl.classList.add('hidden');
    document.getElementById('hhPhoneInput').blur();
    document.getElementById('hhEmailInput').blur();

    if (tab === 'phone') {
        phoneTab.classList.add('active');
        emailTab.classList.remove('active');
        phoneInput.classList.remove('hidden');
        emailInput.classList.add('hidden');
    } else {
        emailTab.classList.add('active');
        phoneTab.classList.remove('active');
        emailInput.classList.remove('hidden');
        phoneInput.classList.add('hidden');
    }
}

// ============================================================================
// VALIDATION
// ============================================================================

function validatePhone(raw) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) return null;
    if (digits.length === 10) return '+7' + digits;
    if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) return '+7' + digits.slice(1);
    return null;
}

function validateEmail(raw) {
    const trimmed = raw.trim();
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    return re.test(trimmed) ? trimmed : null;
}

function getLoginValue() {
    if (activeTab === 'phone') {
        const raw = document.getElementById('hhPhoneInput').value.trim();
        const phone = validatePhone(raw);
        if (!phone) return { error: 'Введите корректный номер телефона (например +79131234567)' };
        return { value: phone, display: phone };
    } else {
        const raw = document.getElementById('hhEmailInput').value.trim();
        const email = validateEmail(raw);
        if (!email) return { error: 'Введите корректный email (например mail@yandex.ru)' };
        return { value: email, display: email };
    }
}

// ============================================================================
// STEP 1: HH LOGIN
// ============================================================================

let loginDisplayValue = '';

async function handleHhLogin() {
    const btn = document.getElementById('hhLoginBtn');
    const errorEl = document.getElementById('hhLoginError');

    const result = getLoginValue();
    if (result.error) {
        showError(errorEl, result.error);
        return;
    }

    loginDisplayValue = result.display;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:20px;height:20px;display:inline-block;vertical-align:middle"></span>';
    errorEl.classList.add('hidden');

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/hh-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: result.value }),
        });

        if (!resp || !resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Ошибка при входе');
        }

        document.getElementById('hhLoginForm').classList.add('hidden');
        document.getElementById('hhWaitingCode').classList.remove('hidden');
        startPolling();

    } catch (e) {
        console.error('[HH Login] Error:', e);
        showError(errorEl, e.message || 'Ошибка при входе');
        btn.disabled = false;
        btn.textContent = 'Далее';
    }
}

function showOtpForm() {
    document.getElementById('hhWaitingCode').classList.add('hidden');
    document.getElementById('hhOtpForm').classList.remove('hidden');

    const isEmail = loginDisplayValue.includes('@');
    document.getElementById('otpMessage').textContent = isEmail
        ? `Код отправлен на ${loginDisplayValue}`
        : `Код отправлен в СМС на ${loginDisplayValue}`;

    initCodeInput();
}

function resetHhLogin() {
    stopPolling();
    document.getElementById('hhOtpForm').classList.add('hidden');
    document.getElementById('hhWaitingCode').classList.add('hidden');
    document.getElementById('hhProcessing').classList.add('hidden');
    document.getElementById('hhLoginForm').classList.remove('hidden');
    document.getElementById('hhLoginBtn').disabled = false;
    document.getElementById('hhLoginBtn').textContent = 'Далее';
    document.getElementById('hhPhoneInput').value = '';
    document.getElementById('hhEmailInput').value = '';
    clearOtp();
}

// ============================================================================
// CODE INPUT
// ============================================================================

function initCodeInput() {
    const input = document.getElementById('otpCodeInput');
    input.value = '';
    input.focus();

    input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '').slice(0, 6);
        document.getElementById('otpSubmitBtn').disabled = input.value.length < 4;
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.length >= 4) {
            handleHhCode();
        }
    });
}

function getOtpValue() {
    return (document.getElementById('otpCodeInput').value || '').replace(/\D/g, '');
}

function clearOtp() {
    const input = document.getElementById('otpCodeInput');
    if (input) input.value = '';
    const btn = document.getElementById('otpSubmitBtn');
    if (btn) btn.disabled = true;
}

// ============================================================================
// STEP 1: SUBMIT CODE
// ============================================================================

async function handleHhCode() {
    const code = getOtpValue();
    if (code.length < 4) return;

    const btn = document.getElementById('otpSubmitBtn');
    const errorEl = document.getElementById('otpError');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:20px;height:20px;display:inline-block;vertical-align:middle"></span>';
    errorEl.classList.add('hidden');

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/hh-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });

        if (!resp || !resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Ошибка подтверждения кода');
        }

        document.getElementById('hhOtpForm').classList.add('hidden');
        document.getElementById('hhProcessing').classList.remove('hidden');
        document.getElementById('processingText').textContent = 'Привязываем аккаунт...';
        document.getElementById('processingSubtext').textContent = 'Загружаем ваши резюме';

    } catch (e) {
        console.error('[HH Code] Error:', e);
        showError(errorEl, e.message || 'Неверный код');
        clearOtp();
        btn.disabled = false;
        btn.textContent = 'Подтвердить';
    }
}

// ============================================================================
// POLLING HH STATUS
// ============================================================================

function startPolling() {
    stopPolling();
    pollInterval = setInterval(pollHhStatus, 2000);
}

function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

async function pollHhStatus() {
    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/hh-status`);
        if (!resp || !resp.ok) return;

        const data = await resp.json();
        const status = data.status;

        if (status === 'NEED_CODE') {
            if (document.getElementById('hhOtpForm').classList.contains('hidden')
                && document.getElementById('hhProcessing').classList.contains('hidden')) {
                showOtpForm();
            }
            return;
        }

        if (status === 'wrong_code') {
            const errorEl = document.getElementById('otpError');
            showError(errorEl, 'Неверный код. Попробуйте ещё раз.');
            clearOtp();
            const btn = document.getElementById('otpSubmitBtn');
            btn.disabled = false;
            btn.textContent = 'Подтвердить';
            return;
        }

        if (status === 'success') {
            document.getElementById('hhOtpForm').classList.add('hidden');
            document.getElementById('hhWaitingCode').classList.add('hidden');
            document.getElementById('hhProcessing').classList.remove('hidden');
            document.getElementById('processingText').textContent = 'Аккаунт привязан!';
            document.getElementById('processingSubtext').textContent = 'Собираем данные с hh.ru, подождите...';
            return;
        }

        if (status === 'sync_complete') {
            stopPolling();
            document.getElementById('hhProcessing').classList.remove('hidden');
            document.getElementById('processingText').textContent = 'Готово!';
            document.getElementById('processingSubtext').textContent = 'Загружаем ваши резюме...';

            setTimeout(() => { showStep(2); }, 1000);
            return;
        }

        if (status === 'error_fatal' || status === 'blocked' || status === 'limit_exceeded') {
            stopPolling();
            document.getElementById('hhProcessing').classList.add('hidden');
            document.getElementById('hhWaitingCode').classList.add('hidden');
            document.getElementById('hhOtpForm').classList.add('hidden');
            document.getElementById('hhLoginForm').classList.remove('hidden');
            document.getElementById('hhLoginBtn').disabled = false;

            const isProxyErr = data.error_code === 'proxy_unavailable';
            document.getElementById('hhLoginBtn').innerHTML = isProxyErr
                ? '<span class="material-symbols-outlined align-middle text-base mr-1">refresh</span>Попробовать ещё раз'
                : 'Далее';

            const errorEl = document.getElementById('hhLoginError');
            showError(errorEl, data.message || 'Ошибка входа. Попробуйте позже.');
            return;
        }

    } catch (e) {
        console.error('[Poll] Error:', e);
    }
}

// ============================================================================
// STEP 2: RESUMES
// ============================================================================

async function loadResumes() {
    const container = document.getElementById('resumesList');
    const emptyEl = document.getElementById('resumeEmpty');
    const selectBtn = document.getElementById('resumeSelectBtn');

    emptyEl.classList.add('hidden');
    selectBtn.classList.add('hidden');
    container.innerHTML = '<div class="skeleton h-16 w-full rounded-xl"></div><div class="skeleton h-16 w-full rounded-xl"></div>';

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/resumes`);
        if (!resp || !resp.ok) {
            container.innerHTML = '';
            emptyEl.classList.remove('hidden');
            return;
        }

        const data = await resp.json();
        const resumes = data.resumes || [];

        if (resumes.length === 0) {
            container.innerHTML = '';
            emptyEl.classList.remove('hidden');
            return;
        }

        container.innerHTML = resumes.map(r => `
            <div class="resume-card rounded-xl p-5 flex items-center gap-4 bg-surface-container-high/60 border border-outline-variant/10 hover:border-primary/30 transition-all text-left"
                 onclick="selectResume('${escapeAttr(r.resume_id)}', this)" data-resume-id="${escapeAttr(r.resume_id)}">
                <div class="w-10 h-10 rounded-xl bg-surface-container-lowest flex items-center justify-center flex-shrink-0">
                    <span class="material-symbols-outlined text-on-surface-variant">description</span>
                </div>
                <div class="flex-1 min-w-0">
                    <span class="text-sm font-medium text-on-surface leading-snug">${escapeHtml(r.title || 'Без названия')}</span>
                </div>
                <div class="w-6 h-6 rounded-full border-2 border-outline-variant flex items-center justify-center flex-shrink-0 resume-check transition-colors"></div>
            </div>
        `).join('');

        selectBtn.classList.remove('hidden');

    } catch (e) {
        console.error('[Resumes] Error:', e);
        container.innerHTML = '';
        emptyEl.classList.remove('hidden');
    }
}

function selectResume(resumeId, el) {
    selectedResumeId = resumeId;

    document.querySelectorAll('.resume-card').forEach(card => {
        card.classList.remove('selected');
        card.querySelector('.resume-check').innerHTML = '';
    });

    el.classList.add('selected');
    el.querySelector('.resume-check').innerHTML = '<span class="material-symbols-outlined text-primary text-base">check</span>';

    document.getElementById('resumeSelectBtn').disabled = false;
}

let _syncResumesPolling = false;

async function syncResumesFromHH() {
    if (_syncResumesPolling) return;
    const btn = document.getElementById('resumeRefreshBtn');
    const icon = document.getElementById('resumeRefreshIcon');
    const text = document.getElementById('resumeRefreshText');
    if (!btn) return;

    btn.disabled = true;
    if (icon) icon.style.animation = 'spin 1s linear infinite';
    if (text) text.textContent = 'Обновляем с hh.ru...';

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/resumes/sync`, { method: 'POST' });
        if (!resp || !resp.ok) {
            if (text) text.textContent = 'Ошибка. Попробуйте позже';
            setTimeout(() => _resetSyncBtn(), 3000);
            return;
        }
        const data = await resp.json();

        if (data.status === 'cooldown') {
            const min = Math.ceil((data.seconds_left || 0) / 60);
            if (text) text.textContent = `Подождите ${min} мин`;
            setTimeout(() => _resetSyncBtn(), 4000);
            return;
        }

        // started / already_running — поллим статус
        _syncResumesPolling = true;
        const startedAt = Date.now();
        const TIMEOUT_MS = 90 * 1000;

        while (Date.now() - startedAt < TIMEOUT_MS) {
            await new Promise(r => setTimeout(r, 2000));
            const sresp = await apiFetch(`${API_BASE_URL}/api/resumes/sync/status`);
            if (!sresp || !sresp.ok) continue;
            const sdata = await sresp.json();
            const status = sdata.status || 'idle';

            if (status === 'complete' || status === 'idle') {
                await loadResumes();
                if (text) text.textContent = 'Список обновлён';
                setTimeout(() => _resetSyncBtn(), 2000);
                return;
            }
            if (status === 'error_login' || status.startsWith('error')) {
                if (text) text.textContent = 'Ошибка синхронизации';
                setTimeout(() => _resetSyncBtn(), 3000);
                return;
            }
        }
        if (text) text.textContent = 'Слишком долго. Обновите вручную';
        setTimeout(() => _resetSyncBtn(), 3000);
    } catch (e) {
        console.error('[SyncResumes] Error:', e);
        if (text) text.textContent = 'Ошибка соединения';
        setTimeout(() => _resetSyncBtn(), 3000);
    } finally {
        _syncResumesPolling = false;
    }
}

function _resetSyncBtn() {
    const btn = document.getElementById('resumeRefreshBtn');
    const icon = document.getElementById('resumeRefreshIcon');
    const text = document.getElementById('resumeRefreshText');
    if (btn) btn.disabled = false;
    if (icon) icon.style.animation = '';
    if (text) text.textContent = 'Обновить список резюме';
}

async function handleResumeSelect() {
    if (!selectedResumeId) return;

    const btn = document.getElementById('resumeSelectBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:20px;height:20px;display:inline-block;vertical-align:middle"></span>';

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/select-resume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resume_id: selectedResumeId }),
        });

        if (!resp || !resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Ошибка сохранения');
        }

        showStep(3);
        startAnalysisPolling();
        startTextRotation();

    } catch (e) {
        console.error('[Select Resume] Error:', e);
        btn.disabled = false;
        btn.textContent = 'Продолжить';
    }
}

// ============================================================================
// STEP 3: ANALYSIS POLLING + DISPLAY
// ============================================================================

function startTextRotation() {
    let idx = 0;
    const el = document.getElementById('analysisRotatingText');
    if (!el) return;

    textRotateInterval = setInterval(() => {
        idx = (idx + 1) % ANALYSIS_PHRASES.length;
        el.textContent = ANALYSIS_PHRASES[idx];
        el.classList.remove('analysis-text-rotate');
        void el.offsetWidth;
        el.classList.add('analysis-text-rotate');
    }, 2500);
}

function stopTextRotation() {
    if (textRotateInterval) {
        clearInterval(textRotateInterval);
        textRotateInterval = null;
    }
}

function startAnalysisPolling() {
    stopAnalysisPolling();
    analysisInterval = setInterval(pollAnalysisStatus, 3000);
}

function stopAnalysisPolling() {
    if (analysisInterval) {
        clearInterval(analysisInterval);
        analysisInterval = null;
    }
}

async function pollAnalysisStatus() {
    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/analysis-status`);
        if (!resp || !resp.ok) return;

        const data = await resp.json();

        if (data.status === 'complete') {
            stopAnalysisPolling();
            stopTextRotation();
            displayAnalysisResult(data.score, data.report);
        }
    } catch (e) {
        console.error('[Analysis Poll] Error:', e);
    }
}

async function loadAnalysisResult() {
    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/analysis-status`);
        if (!resp || !resp.ok) return;
        const data = await resp.json();
        if (data.status === 'complete') {
            displayAnalysisResult(data.score, data.report);
        }
    } catch (e) {
        console.error('[Load Analysis] Error:', e);
    }
}

function displayAnalysisResult(score, report) {
    const wrapper = document.getElementById('contentWrapper');
    if (wrapper) wrapper.style.maxWidth = '640px';

    document.getElementById('analysisLoading').classList.add('hidden');
    document.getElementById('analysisResult').classList.remove('hidden');

    const circumference = 364.4;
    const clampedScore = Math.max(0, Math.min(score, 100));
    const offset = circumference * (1 - clampedScore / 100);

    const circle = document.getElementById('scoreCircle');
    const scoreEl = document.getElementById('scoreValue');
    const verdictEl = document.getElementById('scoreVerdict');

    let colorHex, verdictText, verdictBg;
    if (clampedScore >= 80) {
        colorHex = '#4ade80';
        verdictText = 'Отличное резюме';
        verdictBg = 'bg-green-500/15 text-green-400';
    } else if (clampedScore >= 60) {
        colorHex = '#facc15';
        verdictText = 'Хорошее резюме, есть что улучшить';
        verdictBg = 'bg-yellow-500/15 text-yellow-400';
    } else {
        colorHex = '#fb923c';
        verdictText = 'Резюме нуждается в доработке';
        verdictBg = 'bg-orange-500/15 text-orange-400';
    }

    circle.style.stroke = colorHex;

    requestAnimationFrame(() => {
        circle.style.strokeDashoffset = offset;
    });

    animateCounter(scoreEl, 0, clampedScore, 1500);

    verdictEl.className = `inline-block text-sm font-semibold px-4 py-1.5 rounded-full ${verdictBg}`;
    verdictEl.textContent = verdictText;

    const reportClean = (report || '').replace(/\*\*/g, '').replace(/#{1,3}\s*/g, '');
    document.getElementById('reportText').textContent = reportClean;

    const profileBtn = document.getElementById('searchProfileBtn');
    profileBtn.onclick = () => handleStartProfile();
}

function animateCounter(el, from, to, duration) {
    const start = performance.now();
    const diff = to - from;

    function tick(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(from + diff * eased);
        if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}

// ============================================================================
// STEP 4: SEARCH PROFILE
// ============================================================================

async function handleStartProfile() {
    const btn = document.getElementById('searchProfileBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:20px;height:20px;display:inline-block;vertical-align:middle"></span>';

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/start-profile`, {
            method: 'POST',
        });

        if (!resp || !resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Ошибка запуска');
        }

        showStep(4);
        startRolesPolling();
        startRolesTextRotation();

    } catch (e) {
        console.error('[Start Profile] Error:', e);
        btn.disabled = false;
        btn.textContent = 'Настроить поисковый профиль';
    }
}

function startRolesTextRotation() {
    let idx = 0;
    const el = document.getElementById('rolesRotatingText');
    if (!el) return;
    rolesTextInterval = setInterval(() => {
        idx = (idx + 1) % ROLES_PHRASES.length;
        el.textContent = ROLES_PHRASES[idx];
        el.classList.remove('analysis-text-rotate');
        void el.offsetWidth;
        el.classList.add('analysis-text-rotate');
    }, 2500);
}

function stopRolesTextRotation() {
    if (rolesTextInterval) {
        clearInterval(rolesTextInterval);
        rolesTextInterval = null;
    }
}

function startRolesPolling() {
    stopRolesPolling();
    if (!rolesPollingStartedAt) rolesPollingStartedAt = Date.now();
    rolesInterval = setInterval(pollRolesStatus, 3000);
}

function stopRolesPolling() {
    if (rolesInterval) {
        clearInterval(rolesInterval);
        rolesInterval = null;
    }
}

async function pollRolesStatus() {
    try {
        if (rolesPollingStartedAt && Date.now() - rolesPollingStartedAt > ROLES_STALE_TIMEOUT_MS) {
            console.warn('[Roles Poll] Timeout reached, attempting auto-retry');
            await attemptRolesRetry();
            return;
        }

        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/roles-status`);
        if (!resp || !resp.ok) return;
        const data = await resp.json();

        if (data.status === 'ready') {
            stopRolesPolling();
            stopRolesTextRotation();
            rolesRetryCount = 0;
            renderRoles(data.roles);
        } else if (data.status === 'error') {
            console.warn('[Roles Poll] Error status:', data.detail);
            await attemptRolesRetry();
        }
    } catch (e) {
        console.error('[Roles Poll] Error:', e);
    }
}

async function attemptRolesRetry() {
    if (rolesRetryCount >= ROLES_MAX_RETRIES) {
        stopRolesPolling();
        stopRolesTextRotation();
        showRolesError();
        return;
    }
    rolesRetryCount++;
    console.log(`[Roles Retry] Attempt ${rolesRetryCount}/${ROLES_MAX_RETRIES}`);

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/retry-profile`, { method: 'POST' });
        if (resp && resp.ok) {
            rolesPollingStartedAt = Date.now();
            const el = document.getElementById('rolesRotatingText');
            if (el) el.textContent = `Повторная попытка (${rolesRetryCount}/${ROLES_MAX_RETRIES})...`;
        } else {
            stopRolesPolling();
            stopRolesTextRotation();
            showRolesError();
        }
    } catch (e) {
        console.error('[Roles Retry] Error:', e);
        stopRolesPolling();
        stopRolesTextRotation();
        showRolesError();
    }
}

function showRolesError() {
    const loading = document.getElementById('rolesLoading');
    if (loading) {
        loading.innerHTML = `
            <div class="glass-panel rounded-xl p-8 md:p-12 shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-outline-variant/10">
                <div class="flex flex-col items-center text-center space-y-6 py-4">
                    <div class="space-y-3">
                        <h1 class="text-3xl font-bold tracking-tight text-on-surface">Не удалось проанализировать рынок</h1>
                        <p class="text-on-surface-variant text-sm leading-relaxed max-w-[320px] mx-auto">
                            Произошла ошибка при анализе вакансий. Попробуйте ещё раз — обычно со второй попытки всё работает.
                        </p>
                    </div>
                    <span class="material-symbols-outlined text-error text-5xl">error_outline</span>
                    <button onclick="handleManualRolesRetry()" class="btn-primary text-white px-8 py-3 rounded-xl font-bold text-base shadow-[0_0_30px_rgba(90,48,208,0.3)] hover:shadow-[0_0_50px_rgba(90,48,208,0.5)] transition-all active:scale-95 cursor-pointer">
                        Попробовать снова
                    </button>
                </div>
            </div>
        `;
    }
}

async function handleManualRolesRetry() {
    rolesRetryCount = 0;
    const loading = document.getElementById('rolesLoading');
    if (loading) {
        loading.innerHTML = `
            <div class="glass-panel rounded-xl p-8 md:p-12 shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-outline-variant/10">
                <div class="flex flex-col items-center text-center space-y-6 py-4">
                    <div class="space-y-3">
                        <h1 class="text-3xl font-bold tracking-tight text-on-surface">Анализируем рынок</h1>
                        <p class="text-on-surface-variant text-sm leading-relaxed max-w-[320px] mx-auto">
                            AI изучает вакансии и формирует категории ролей под ваш профиль
                        </p>
                    </div>
                    <div class="relative w-28 h-28 flex items-center justify-center">
                        <svg class="w-full h-full" viewBox="0 0 128 128" style="transform: rotate(-90deg)">
                            <circle class="gauge-circle-bg" cx="64" cy="64" fill="transparent" r="58" stroke="currentColor" stroke-width="8"></circle>
                            <circle class="analyze-ring" cx="64" cy="64" fill="transparent" r="58" stroke="#5a30d0" stroke-width="8" stroke-linecap="round"></circle>
                        </svg>
                        <div class="absolute inset-0 flex items-center justify-center">
                            <span class="material-symbols-outlined text-primary text-3xl">category</span>
                        </div>
                    </div>
                    <p class="text-on-surface text-sm font-medium h-5" id="rolesRotatingText">Повторный анализ...</p>
                </div>
            </div>
        `;
    }
    await attemptRolesRetry();
    if (rolesRetryCount <= ROLES_MAX_RETRIES) {
        startRolesPolling();
        startRolesTextRotation();
    }
}

async function loadRolesFromServer() {
    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/roles-status`);
        if (!resp || !resp.ok) return;
        const data = await resp.json();
        if (data.status === 'ready') {
            renderRoles(data.roles);
        } else if (data.status === 'error') {
            await attemptRolesRetry();
            if (rolesRetryCount <= ROLES_MAX_RETRIES) {
                startRolesPolling();
                startRolesTextRotation();
            }
        } else {
            startRolesPolling();
            startRolesTextRotation();
        }
    } catch (e) {
        console.error('[Load Roles] Error:', e);
    }
}

function renderRoles(roles) {
    currentRoles = roles.map(r => ({ name: r, active: true }));

    const wrapper = document.getElementById('contentWrapper');
    if (wrapper) wrapper.style.maxWidth = '960px';

    document.getElementById('rolesLoading').classList.add('hidden');
    document.getElementById('rolesSection').classList.remove('hidden');

    const grid = document.getElementById('rolesGrid');
    grid.innerHTML = currentRoles.map((role, i) => `
        <div class="spotlight-card glass-card rounded-xl p-5 sm:p-6 border border-outline-variant/10 cursor-pointer select-none glow-green role-card-enter transition-all duration-200"
             style="animation-delay: ${i * 60}ms"
             data-role-idx="${i}" onclick="toggleRole(${i}, this)">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-vibrant-green/10 transition-colors duration-200 role-icon-bg">
                    <span class="material-symbols-outlined text-vibrant-green text-lg transition-colors duration-200 role-icon" style="font-variation-settings: 'FILL' 1;">check_circle</span>
                </div>
                <span class="text-on-surface font-medium text-sm sm:text-[15px]">${escapeHtml(role.name)}</span>
            </div>
        </div>
    `).join('');

    grid.addEventListener('mousemove', handleSpotlight);
}

function handleSpotlight(e) {
    const cards = e.currentTarget.querySelectorAll('.spotlight-card');
    cards.forEach(card => {
        const rect = card.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width * 100);
        const y = ((e.clientY - rect.top) / rect.height * 100);
        card.style.setProperty('--mouse-x', x + '%');
        card.style.setProperty('--mouse-y', y + '%');
    });
}

function toggleRole(idx, el) {
    const role = currentRoles[idx];
    role.active = !role.active;

    const iconBg = el.querySelector('.role-icon-bg');
    const icon = el.querySelector('.role-icon');

    if (role.active) {
        el.classList.remove('glow-red');
        el.classList.add('glow-green');
        el.classList.remove('border-error-container/30');
        el.classList.add('border-outline-variant/10');
        iconBg.classList.remove('bg-error/10');
        iconBg.classList.add('bg-vibrant-green/10');
        icon.classList.remove('text-error');
        icon.classList.add('text-vibrant-green');
        icon.textContent = 'check_circle';
    } else {
        el.classList.remove('glow-green');
        el.classList.add('glow-red');
        el.classList.remove('border-outline-variant/10');
        el.classList.add('border-error-container/30');
        iconBg.classList.remove('bg-vibrant-green/10');
        iconBg.classList.add('bg-error/10');
        icon.classList.remove('text-vibrant-green');
        icon.classList.add('text-error');
        icon.textContent = 'cancel';
    }
}

async function handleConfirmRoles() {
    const liked = currentRoles.filter(r => r.active).map(r => r.name);
    const disliked = currentRoles.filter(r => !r.active).map(r => r.name);

    if (liked.length === 0) {
        alert('Выберите хотя бы одну роль');
        return;
    }

    const btn = document.getElementById('confirmRolesBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:20px;height:20px;display:inline-block;vertical-align:middle"></span> Сохраняем...';

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/confirm-roles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ liked, disliked }),
        });

        if (!resp || !resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Ошибка сохранения');
        }

        showQueryGenerating();
        startProfilePolling();

    } catch (e) {
        console.error('[Confirm Roles] Error:', e);
        btn.disabled = false;
        btn.textContent = 'Далее';
    }
}

function showQueryGenerating() {
    document.getElementById('rolesLoading').classList.add('hidden');
    document.getElementById('rolesSection').classList.add('hidden');
    document.getElementById('queryGenerating').classList.remove('hidden');
    document.getElementById('profileComplete').classList.add('hidden');

    const wrapper = document.getElementById('contentWrapper');
    if (wrapper) wrapper.style.maxWidth = '480px';
}

function startProfilePolling() {
    stopProfilePolling();
    profileInterval = setInterval(pollProfileStatus, 3000);
}

function stopProfilePolling() {
    if (profileInterval) {
        clearInterval(profileInterval);
        profileInterval = null;
    }
}

async function pollProfileStatus() {
    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/profile-status`);
        if (!resp || !resp.ok) return;
        const data = await resp.json();

        if (data.status === 'complete') {
            stopProfilePolling();
            showProfileComplete();
        }
    } catch (e) {
        console.error('[Profile Poll] Error:', e);
    }
}

function showProfileComplete() {
    document.getElementById('rolesLoading').classList.add('hidden');
    document.getElementById('rolesSection').classList.add('hidden');
    document.getElementById('queryGenerating').classList.add('hidden');
    document.getElementById('profileComplete').classList.remove('hidden');

    const wrapper = document.getElementById('contentWrapper');
    if (wrapper) wrapper.style.maxWidth = '480px';

    const goBtn = document.getElementById('goToSettingsBtn');
    if (goBtn) {
        goBtn.addEventListener('click', handleGoToSettings);
    }
}

async function handleGoToSettings() {
    const btn = document.getElementById('goToSettingsBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner" style="width:20px;height:20px;display:inline-block;vertical-align:middle"></span>';
    }

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/start-settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });

        if (!resp.ok) throw new Error('Failed to start settings step');

        window.location.href = '/settings/';
    } catch (e) {
        console.error('[Onboarding] start-settings error:', e);
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Настроить поиск';
        }
    }
}

// ============================================================================
// UTILS
// ============================================================================

function showError(el, msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function escapeAttr(str) {
    return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
