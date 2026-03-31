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
let pollInterval = null;
let analysisInterval = null;
let textRotateInterval = null;
let rolesInterval = null;
let profileInterval = null;
let rolesTextInterval = null;
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

    if (resp.status === 401) {
        const refreshResp = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
            method: 'POST', credentials: 'include',
        });
        if (refreshResp.ok) {
            resp = await fetch(url, options);
        } else {
            window.location.href = 'auth.html';
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

        if (meResp.status === 401) {
            const refreshResp = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
                method: 'POST', credentials: 'include',
            });
            if (refreshResp.ok) {
                meResp = await fetch(`${API_BASE_URL}/api/auth/me`, {
                    method: 'GET', credentials: 'include',
                });
            }
        }

        if (!meResp.ok) {
            window.location.href = 'auth.html';
            return;
        }

        const data = await meResp.json();
        if (data.status !== 'ok') {
            window.location.href = 'auth.html';
            return;
        }

        currentUser = data;

        if (!data.current_step || !data.current_step.startsWith('onboarding_')) {
            if (data.subscription_status === 'none') {
                window.location.href = 'cabinet.html';
            } else {
                window.location.href = 'settings.html';
            }
            return;
        }

        if (window.AuroraSession) {
            window.AuroraSession.startPing();
        }

        initOnboarding(data.current_step);

    } catch (e) {
        console.error('[Onboarding] Init error:', e);
        window.location.href = 'auth.html';
    }
});

function initOnboarding(step) {
    document.getElementById('loadingSkeleton').classList.add('hidden');
    document.getElementById('mainContent').classList.remove('hidden');

    if (step === 'onboarding_profile_complete') {
        showStep(4);
        showProfileComplete();
    } else if (step === 'onboarding_query_generating') {
        showStep(4);
        showQueryGenerating();
        startProfilePolling();
    } else if (step === 'onboarding_roles_ready') {
        showStep(4);
        loadRolesFromServer();
    } else if (step === 'onboarding_search_profile') {
        showStep(4);
        startRolesPolling();
        startRolesTextRotation();
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
// STEPPER (4 steps)
// ============================================================================

function showStep(stepNum) {
    const dots = [1, 2, 3, 4].map(i => document.getElementById(`stepDot${i}`));
    const lines = [1, 2, 3].map(i => document.getElementById(`stepLine${i}`));
    const steps = [1, 2, 3, 4].map(i => document.getElementById(`step${i}`));
    const checkIcon = '<span class="material-symbols-outlined text-sm">check</span>';
    const wrapper = document.getElementById('contentWrapper');

    steps.forEach(el => { if (el) el.classList.add('hidden'); });

    if (wrapper) {
        if (stepNum <= 2) wrapper.style.maxWidth = '480px';
        else if (stepNum === 3) wrapper.style.maxWidth = '640px';
        else wrapper.style.maxWidth = '960px';
    }

    dots.forEach((dot, i) => {
        const num = i + 1;
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
        line.className = (i + 1) < stepNum ? 'stepper-line active' : 'stepper-line pending';
    });

    if (steps[stepNum - 1]) steps[stepNum - 1].classList.remove('hidden');

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
            document.getElementById('hhLoginBtn').textContent = 'Далее';

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
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/roles-status`);
        if (!resp || !resp.ok) return;
        const data = await resp.json();

        if (data.status === 'ready') {
            stopRolesPolling();
            stopRolesTextRotation();
            renderRoles(data.roles);
        }
    } catch (e) {
        console.error('[Roles Poll] Error:', e);
    }
}

async function loadRolesFromServer() {
    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/roles-status`);
        if (!resp || !resp.ok) return;
        const data = await resp.json();
        if (data.status === 'ready') {
            renderRoles(data.roles);
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
