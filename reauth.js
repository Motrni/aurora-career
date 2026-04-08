/**
 * reauth.js — Повторная привязка HH.ru (куки умерли).
 * Шаг 1: Привязка HH.ru аккаунта (табы Телефон/Почта, OTP)
 * Шаг 2: Выбор резюме
 */

const API_BASE_URL = window.AuroraSession
    ? window.AuroraSession.getApiBase()
    : ((window.location.hostname.includes('twc1.net') || window.location.hostname.includes('aurora-develop'))
        ? 'https://api.aurora-develop.ru'
        : 'https://api.aurora-career.ru');

let selectedResumeId = null;
let pollInterval = null;
let activeTab = 'phone';

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

        if (!data.need_reauth) {
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

        document.getElementById('loadingSkeleton').classList.add('hidden');
        document.getElementById('mainContent').classList.remove('hidden');
        showStep(1);
        loadHhConnectedCount();

    } catch (e) {
        console.error('[Reauth] Init error:', e);
        window.location.href = '/auth/';
    }
});

// ============================================================================
// STEPPER (2 steps)
// ============================================================================

function showStep(stepNum) {
    const dot1 = document.getElementById('stepDot1');
    const dot2 = document.getElementById('stepDot2');
    const line1 = document.getElementById('stepLine1');
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');
    const stepSuccess = document.getElementById('stepSuccess');
    const banner = document.getElementById('reauthBanner');
    const checkIcon = '<span class="material-symbols-outlined text-sm">check</span>';

    step1.classList.add('hidden');
    step2.classList.add('hidden');
    stepSuccess.classList.add('hidden');

    if (stepNum === 1) {
        dot1.className = 'stepper-dot active';
        dot1.textContent = '1';
        dot2.className = 'stepper-dot pending';
        dot2.textContent = '2';
        line1.className = 'stepper-line pending';
        step1.classList.remove('hidden');
        banner.classList.remove('hidden');
    } else if (stepNum === 2) {
        dot1.className = 'stepper-dot completed';
        dot1.innerHTML = checkIcon;
        dot2.className = 'stepper-dot active';
        dot2.textContent = '2';
        line1.className = 'stepper-line active';
        step2.classList.remove('hidden');
        banner.classList.add('hidden');
        loadResumes();
    }
}

function showSuccess() {
    document.getElementById('step1').classList.add('hidden');
    document.getElementById('step2').classList.add('hidden');
    document.getElementById('stepperBar').classList.add('hidden');
    document.getElementById('reauthBanner').classList.add('hidden');
    document.getElementById('stepSuccess').classList.remove('hidden');
}

// ============================================================================
// TAB SWITCHING
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

function showError(el, msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
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
        const resp = await apiFetch(`${API_BASE_URL}/api/reauth/hh-login`, {
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
        console.error('[Reauth HH Login] Error:', e);
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

function initCodeInput() {
    const old = document.getElementById('otpCodeInput');
    const input = old.cloneNode(true);
    old.parentNode.replaceChild(input, old);
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

async function handleHhCode() {
    const code = getOtpValue();
    if (code.length < 4) return;

    const btn = document.getElementById('otpSubmitBtn');
    const errorEl = document.getElementById('otpError');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:20px;height:20px;display:inline-block;vertical-align:middle"></span>';
    errorEl.classList.add('hidden');

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/reauth/hh-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });

        if (!resp || !resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Ошибка');
        }

        document.getElementById('hhOtpForm').classList.add('hidden');
        document.getElementById('hhProcessing').classList.remove('hidden');
        document.getElementById('processingText').textContent = 'Привязываем аккаунт...';
        document.getElementById('processingSubtext').textContent = 'Собираем данные с hh.ru, подождите...';

    } catch (e) {
        showError(errorEl, e.message || 'Ошибка при отправке кода');
        clearOtp();
        btn.disabled = false;
        btn.textContent = 'Подтвердить';
    }
}

function resetHhLogin() {
    stopPolling();
    document.getElementById('hhOtpForm').classList.add('hidden');
    document.getElementById('hhWaitingCode').classList.add('hidden');
    document.getElementById('hhProcessing').classList.add('hidden');
    document.getElementById('hhLoginForm').classList.remove('hidden');
    const btn = document.getElementById('hhLoginBtn');
    btn.disabled = false;
    btn.textContent = 'Далее';
    document.getElementById('hhPhoneInput').value = '';
    document.getElementById('hhEmailInput').value = '';
    clearOtp();
}

// ============================================================================
// POLLING HH AUTH STATUS
// ============================================================================

function startPolling() {
    stopPolling();
    void pollReauthHhStatus();
    pollInterval = setInterval(pollReauthHhStatus, 2000);
}

/** Статусы совпадают с auth_service.py / Redis (как onboarding.js, не lower-case). */
async function pollReauthHhStatus() {
    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/reauth/hh-status`);
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
            showError(document.getElementById('hhLoginError'), data.message || 'Ошибка авторизации. Попробуйте ещё раз.');
        }
    } catch (e) {
        console.error('[Reauth Polling] Error:', e);
    }
}

function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

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

// ============================================================================
// STEP 2: RESUME SELECT
// ============================================================================

async function loadResumes() {
    const list = document.getElementById('resumesList');
    const empty = document.getElementById('resumeEmpty');
    const btn = document.getElementById('resumeSelectBtn');
    selectedResumeId = null;
    btn.classList.add('hidden');
    btn.disabled = true;

    list.innerHTML = '<div class="skeleton h-16 w-full rounded-xl"></div><div class="skeleton h-16 w-full rounded-xl"></div>';
    empty.classList.add('hidden');

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/reauth/resumes`);
        if (!resp) return;
        const data = await resp.json();

        if (!data.resumes || data.resumes.length === 0) {
            list.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }

        list.innerHTML = '';
        data.resumes.forEach(r => {
            const card = document.createElement('div');
            card.className = 'resume-card bg-surface-container-high/60 border border-outline-variant/10 rounded-xl p-4 flex items-center gap-3';
            card.dataset.resumeId = r.resume_id;

            card.innerHTML = `
                <span class="material-symbols-outlined text-on-surface-variant text-2xl">description</span>
                <span class="text-on-surface text-sm font-medium flex-1 text-left">${escapeHtml(r.title)}</span>
                <span class="material-symbols-outlined text-primary text-xl opacity-0 transition-opacity check-icon" style="font-variation-settings: 'FILL' 1;">check_circle</span>
            `;

            card.addEventListener('click', () => {
                document.querySelectorAll('.resume-card').forEach(c => {
                    c.classList.remove('selected');
                    c.querySelector('.check-icon').style.opacity = '0';
                });
                card.classList.add('selected');
                card.querySelector('.check-icon').style.opacity = '1';
                selectedResumeId = r.resume_id;
                btn.disabled = false;
                btn.classList.remove('hidden');
            });

            list.appendChild(card);
        });

    } catch (e) {
        console.error('[Reauth] Failed to load resumes:', e);
        list.innerHTML = '<p class="text-error text-sm text-center py-4">Ошибка загрузки резюме</p>';
    }
}

async function handleResumeSelect() {
    if (!selectedResumeId) return;

    const btn = document.getElementById('resumeSelectBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:20px;height:20px;display:inline-block;vertical-align:middle"></span>';

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/reauth/select-resume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resume_id: selectedResumeId }),
        });

        if (!resp || !resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Ошибка');
        }

        showSuccess();

    } catch (e) {
        console.error('[Reauth] Select resume error:', e);
        btn.disabled = false;
        btn.textContent = 'Готово';
    }
}

// ============================================================================
// UTILS
// ============================================================================

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
