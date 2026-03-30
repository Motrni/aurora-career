/**
 * onboarding.js — Первая настройка Aurora Career.
 * Шаг 1: Привязка HH.ru аккаунта (табы Телефон/Почта, OTP после NEED_CODE)
 * Шаг 2: Выбор резюме (полное название, без truncate)
 * Шаг 3: AI-анализ резюме (gauge + отчёт)
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
let activeTab = 'phone';

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

    if (step === 'onboarding_analysis_complete') {
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
// STEPPER (3 steps)
// ============================================================================

function showStep(stepNum) {
    const dot1 = document.getElementById('stepDot1');
    const dot2 = document.getElementById('stepDot2');
    const dot3 = document.getElementById('stepDot3');
    const line1 = document.getElementById('stepLine1');
    const line2 = document.getElementById('stepLine2');
    const step1El = document.getElementById('step1');
    const step2El = document.getElementById('step2');
    const step3El = document.getElementById('step3');

    const checkIcon = '<span class="material-symbols-outlined text-sm">check</span>';

    [step1El, step2El, step3El].forEach(el => el.classList.add('hidden'));

    const wrapper = document.getElementById('contentWrapper');
    if (wrapper && stepNum < 3) wrapper.style.maxWidth = '480px';

    if (stepNum === 1) {
        dot1.className = 'stepper-dot active'; dot1.textContent = '1';
        dot2.className = 'stepper-dot pending'; dot2.textContent = '2';
        dot3.className = 'stepper-dot pending'; dot3.textContent = '3';
        line1.className = 'stepper-line pending';
        line2.className = 'stepper-line pending';
        step1El.classList.remove('hidden');
    } else if (stepNum === 2) {
        dot1.className = 'stepper-dot completed'; dot1.innerHTML = checkIcon;
        dot2.className = 'stepper-dot active'; dot2.textContent = '2';
        dot3.className = 'stepper-dot pending'; dot3.textContent = '3';
        line1.className = 'stepper-line active';
        line2.className = 'stepper-line pending';
        step2El.classList.remove('hidden');
        loadResumes();
    } else {
        dot1.className = 'stepper-dot completed'; dot1.innerHTML = checkIcon;
        dot2.className = 'stepper-dot completed'; dot2.innerHTML = checkIcon;
        dot3.className = 'stepper-dot active'; dot3.textContent = '3';
        line1.className = 'stepper-line active';
        line2.className = 'stepper-line active';
        step3El.classList.remove('hidden');
    }
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
    profileBtn.onclick = () => {
        // TODO: переход к настройке поискового профиля
    };
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
