/**
 * onboarding.js — Онбординг Aurora Career.
 * Шаг 1: Привязка HH.ru аккаунта
 * Шаг 2: Выбор резюме
 */

const API_BASE_URL = window.AuroraSession
    ? window.AuroraSession.getApiBase()
    : ((window.location.hostname.includes('twc1.net') || window.location.hostname.includes('aurora-develop'))
        ? 'https://api.aurora-develop.ru'
        : 'https://api.aurora-career.ru');

let currentUser = null;
let selectedResumeId = null;
let pollInterval = null;

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

    if (step === 'onboarding_resume_select') {
        showStep(2);
    } else {
        showStep(1);
    }
}

// ============================================================================
// STEPPER
// ============================================================================

function showStep(stepNum) {
    const dot1 = document.getElementById('stepDot1');
    const dot2 = document.getElementById('stepDot2');
    const line1 = document.getElementById('stepLine1');
    const step1El = document.getElementById('step1');
    const step2El = document.getElementById('step2');

    if (stepNum === 1) {
        dot1.className = 'stepper-dot active';
        dot2.className = 'stepper-dot pending';
        line1.className = 'stepper-line pending';
        step1El.classList.remove('hidden');
        step2El.classList.add('hidden');
    } else {
        dot1.className = 'stepper-dot completed';
        dot1.innerHTML = '<span class="material-symbols-outlined text-sm">check</span>';
        dot2.className = 'stepper-dot active';
        line1.className = 'stepper-line active';
        step1El.classList.add('hidden');
        step2El.classList.remove('hidden');
        loadResumes();
    }
}

// ============================================================================
// STEP 1: HH LOGIN
// ============================================================================

async function handleHhLogin() {
    const input = document.getElementById('hhLoginInput');
    const btn = document.getElementById('hhLoginBtn');
    const errorEl = document.getElementById('hhLoginError');
    const loginValue = input.value.trim();

    if (!loginValue) {
        showError(errorEl, 'Введите телефон или email');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    errorEl.classList.add('hidden');

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/hh-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: loginValue }),
        });

        if (!resp || !resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Login failed');
        }

        document.getElementById('hhLoginForm').classList.add('hidden');
        document.getElementById('hhOtpForm').classList.remove('hidden');

        const isEmail = loginValue.includes('@');
        document.getElementById('otpMessage').textContent = isEmail
            ? `Код отправлен на ${loginValue}`
            : `Код отправлен в СМС на ${loginValue}`;

        initCodeInput();
        startPolling();

    } catch (e) {
        console.error('[HH Login] Error:', e);
        showError(errorEl, e.message || 'Ошибка при входе');
        btn.disabled = false;
        btn.textContent = 'Далее';
    }
}

function resetHhLogin() {
    stopPolling();
    document.getElementById('hhOtpForm').classList.add('hidden');
    document.getElementById('hhLoginForm').classList.remove('hidden');
    document.getElementById('hhLoginBtn').disabled = false;
    document.getElementById('hhLoginBtn').textContent = 'Далее';
    document.getElementById('hhLoginInput').value = '';
    clearOtp();
}

// ============================================================================
// CODE INPUT (4-6 digits, single field)
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
    document.getElementById('otpSubmitBtn').disabled = true;
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
    btn.innerHTML = '<span class="spinner"></span>';
    errorEl.classList.add('hidden');

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/hh-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });

        if (!resp || !resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Code verification failed');
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

            setTimeout(() => {
                showStep(2);
            }, 1000);
            return;
        }

        if (status === 'error_fatal' || status === 'blocked' || status === 'limit_exceeded') {
            stopPolling();
            const errorEl = document.getElementById('otpError');
            if (document.getElementById('hhOtpForm').classList.contains('hidden')) {
                document.getElementById('hhProcessing').classList.add('hidden');
                document.getElementById('hhOtpForm').classList.remove('hidden');
            }
            showError(errorEl, data.message || 'Ошибка входа. Попробуйте позже.');
            const btn = document.getElementById('otpSubmitBtn');
            btn.disabled = false;
            btn.textContent = 'Подтвердить';
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
    container.innerHTML = '<div class="skeleton h-20 w-full rounded-xl"></div>';

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/resumes`);
        console.log('[Resumes] Response status:', resp?.status);

        if (!resp || !resp.ok) {
            console.error('[Resumes] Bad response:', resp?.status);
            container.innerHTML = '';
            emptyEl.classList.remove('hidden');
            return;
        }

        const data = await resp.json();
        console.log('[Resumes] Data:', JSON.stringify(data));
        const resumes = data.resumes || [];

        if (resumes.length === 0) {
            container.innerHTML = '';
            emptyEl.classList.remove('hidden');
            return;
        }

        container.innerHTML = resumes.map(r => `
            <div class="resume-card rounded-xl p-5 flex items-center gap-4 bg-surface-container-high/60 border border-outline-variant/10 hover:border-primary/30 transition-all" onclick="selectResume('${escapeAttr(r.resume_id)}', this)" data-resume-id="${escapeAttr(r.resume_id)}">
                <div class="w-10 h-10 rounded-xl bg-surface-container-lowest flex items-center justify-center flex-shrink-0">
                    <span class="material-symbols-outlined text-on-surface-variant">description</span>
                </div>
                <div class="flex-1 min-w-0">
                    <span class="text-sm font-medium text-on-surface block truncate">${escapeHtml(r.title || 'Без названия')}</span>
                </div>
                <div class="w-5 h-5 rounded-full border-2 border-outline-variant flex items-center justify-center flex-shrink-0 resume-check">
                </div>
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
    el.querySelector('.resume-check').innerHTML = '<span class="material-symbols-outlined text-primary text-sm">check</span>';

    document.getElementById('resumeSelectBtn').disabled = false;
}

async function handleResumeSelect() {
    if (!selectedResumeId) return;

    const btn = document.getElementById('resumeSelectBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    // TODO: будущий эндпоинт для сохранения выбранного резюме + current_step = NULL
    btn.textContent = 'Готово!';
    setTimeout(() => {
        window.location.href = 'settings.html';
    }, 800);
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
