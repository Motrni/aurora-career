/**
 * auth.js — Логика страницы аутентификации Aurora Career.
 * Вход, регистрация, OTP-подтверждение, сброс пароля.
 */

const API_BASE_URL = (window.location.hostname.includes('twc1.net') || window.location.hostname.includes('aurora-develop'))
    ? 'https://api.aurora-develop.ru'
    : 'https://api.aurora-career.ru';

let currentOtpEmail = '';

function togglePwdVis(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const icon = btn.querySelector('.material-symbols-outlined');
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) icon.textContent = 'visibility';
    } else {
        input.type = 'password';
        if (icon) icon.textContent = 'visibility_off';
    }
}
let currentOtpPurpose = 'email_verify';
let resendTimerInterval = null;

// ============================================================================
// TAB SWITCHING
// ============================================================================

function switchTab(tab) {
    const forms = ['loginForm', 'registerForm', 'otpForm', 'forgotForm', 'resetForm'];
    forms.forEach(f => document.getElementById(f).classList.add('hidden'));
    hideMessage();

    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const tabsContainer = document.getElementById('authTabs');

    tabLogin.className = 'flex-1 pb-3 text-sm font-medium border-b-2 transition-colors tab-inactive';
    tabRegister.className = 'flex-1 pb-3 text-sm font-medium border-b-2 transition-colors tab-inactive';

    switch (tab) {
        case 'login':
            document.getElementById('loginForm').classList.remove('hidden');
            tabLogin.className = tabLogin.className.replace('tab-inactive', 'tab-active');
            tabsContainer.classList.remove('hidden');
            break;
        case 'register':
            document.getElementById('registerForm').classList.remove('hidden');
            tabRegister.className = tabRegister.className.replace('tab-inactive', 'tab-active');
            tabsContainer.classList.remove('hidden');
            break;
        case 'otp':
            document.getElementById('otpForm').classList.remove('hidden');
            tabsContainer.classList.add('hidden');
            break;
        case 'forgot':
            document.getElementById('forgotForm').classList.remove('hidden');
            tabsContainer.classList.add('hidden');
            break;
        case 'reset':
            document.getElementById('resetForm').classList.remove('hidden');
            tabsContainer.classList.add('hidden');
            break;
    }
}

// ============================================================================
// MESSAGES
// ============================================================================

function showMessage(text, type = 'error') {
    const box = document.getElementById('messageBox');
    box.textContent = text;
    box.classList.remove('hidden');
    box.className = `mx-8 mt-4 rounded-lg px-4 py-3 text-sm fade-in ${
        type === 'error'
            ? 'bg-error-container/30 text-error border border-error/20'
            : 'bg-primary-container/20 text-primary border border-primary/20'
    }`;

    if (type === 'error') {
        box.classList.add('shake');
        setTimeout(() => box.classList.remove('shake'), 500);
    }
}

function hideMessage() {
    document.getElementById('messageBox').classList.add('hidden');
}

// ============================================================================
// BUTTON LOADING STATE
// ============================================================================

function setLoading(btnId, textId, loading) {
    const btn = document.getElementById(btnId);
    const txt = document.getElementById(textId);
    if (loading) {
        btn.disabled = true;
        txt.innerHTML = '<span class="spinner"></span>';
    } else {
        btn.disabled = false;
    }
}

// ============================================================================
// API CALLS
// ============================================================================

async function apiCall(endpoint, body) {
    const resp = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
    });

    const data = await resp.json();
    return { ok: resp.ok, status: resp.status, data };
}

// ============================================================================
// HANDLERS
// ============================================================================

async function handleLogin(e) {
    e.preventDefault();
    hideMessage();

    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) return;

    setLoading('loginBtn', 'loginBtnText', true);

    try {
        const { ok, status, data } = await apiCall('/api/auth/login', { email, password });

        if (ok) {
            window.location.href = 'settings.html';
            return;
        }

        if (status === 403 && data.detail && data.detail.includes('Подтвердите')) {
            currentOtpEmail = email;
            currentOtpPurpose = 'email_verify';
            document.getElementById('otpEmailDisplay').textContent = email;
            switchTab('otp');
            startResendTimer();
            showMessage('Email не подтверждён. Введите код из письма.', 'info');
            return;
        }

        showMessage(data.detail || 'Ошибка входа');
    } catch (err) {
        showMessage('Ошибка сети. Проверьте подключение.');
    } finally {
        setLoading('loginBtn', 'loginBtnText', false);
        document.getElementById('loginBtnText').textContent = 'Войти';
    }
}

function updateRegPasswordChecks() {
    const pwd = (document.getElementById('regPassword')?.value) || '';
    const checks = [
        { id: 'regChkLength', icon: 'regChkLengthIcon', pass: pwd.length >= 8 },
        { id: 'regChkUpper',  icon: 'regChkUpperIcon',  pass: /[A-ZА-ЯЁ]/.test(pwd) },
        { id: 'regChkDigit',  icon: 'regChkDigitIcon',  pass: /[0-9]/.test(pwd) },
        { id: 'regChkLower',  icon: 'regChkLowerIcon',  pass: /[a-zа-яё!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd) },
    ];
    let allPassed = true;
    checks.forEach(c => {
        const icon = document.getElementById(c.icon);
        const row = document.getElementById(c.id);
        if (!icon || !row) return;
        const textSpan = row.querySelector('span:last-child');
        if (c.pass) {
            icon.textContent = 'check_circle'; icon.style.color = '#4ade80';
            if (textSpan) textSpan.style.color = '#4ade80';
        } else {
            icon.textContent = 'radio_button_unchecked'; icon.style.color = '#938ea0';
            if (textSpan) textSpan.style.color = '#938ea0';
            allPassed = false;
        }
    });
    const confirm = document.getElementById('regPasswordConfirm')?.value;
    const email = document.getElementById('regEmail')?.value?.trim();
    const btn = document.getElementById('regBtn');
    if (btn) btn.disabled = !(allPassed && email && pwd === confirm);
}

async function handleRegister(e) {
    e.preventDefault();
    hideMessage();

    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regPasswordConfirm').value;

    if (!email || !password || !confirm) return;

    if (password !== confirm) {
        showMessage('Пароли не совпадают');
        return;
    }

    if (password.length < 8 || !/[A-ZА-ЯЁ]/.test(password) || !/[0-9]/.test(password)) {
        showMessage('Пароль не соответствует требованиям');
        return;
    }

    setLoading('regBtn', 'regBtnText', true);

    try {
        const { ok, status, data } = await apiCall('/api/auth/register', { email, password });

        if (ok || status === 201) {
            currentOtpEmail = email;
            currentOtpPurpose = 'email_verify';
            document.getElementById('otpEmailDisplay').textContent = email;
            switchTab('otp');
            startResendTimer();
            return;
        }

        showMessage(data.detail || 'Ошибка регистрации');
    } catch (err) {
        showMessage('Ошибка сети. Проверьте подключение.');
    } finally {
        setLoading('regBtn', 'regBtnText', false);
        document.getElementById('regBtnText').textContent = 'Зарегистрироваться';
    }
}

async function handleVerifyOtp(e) {
    e.preventDefault();
    hideMessage();

    const code = document.getElementById('otpCode').value.trim();
    if (!code || code.length !== 6) {
        showMessage('Введите 6-значный код');
        return;
    }

    setLoading('otpBtn', 'otpBtnText', true);

    try {
        const endpoint = currentOtpPurpose === 'email_verify'
            ? '/api/auth/verify-email'
            : '/api/auth/reset-password';

        const body = { email: currentOtpEmail, code };

        const { ok, data } = await apiCall(endpoint, body);

        if (ok) {
            window.location.href = 'settings.html';
            return;
        }

        showMessage(data.detail || 'Неверный код');
    } catch (err) {
        showMessage('Ошибка сети. Проверьте подключение.');
    } finally {
        setLoading('otpBtn', 'otpBtnText', false);
        document.getElementById('otpBtnText').textContent = 'Подтвердить';
    }
}

async function handleResendOtp() {
    hideMessage();
    const btn = document.getElementById('resendBtn');
    btn.disabled = true;

    try {
        const { ok, data } = await apiCall('/api/auth/resend-otp', {
            email: currentOtpEmail,
            purpose: currentOtpPurpose,
        });

        if (ok) {
            showMessage('Код отправлен повторно', 'info');
            startResendTimer();
        } else {
            showMessage(data.detail || 'Не удалось отправить код');
        }
    } catch (err) {
        showMessage('Ошибка сети');
    }
}

async function handleForgotPassword(e) {
    e.preventDefault();
    hideMessage();

    const email = document.getElementById('forgotEmail').value.trim();
    if (!email) return;

    setLoading('forgotBtn', 'forgotBtnText', true);

    try {
        const { ok, data } = await apiCall('/api/auth/forgot-password', { email });

        if (ok) {
            currentOtpEmail = email;
            currentOtpPurpose = 'password_reset';
            document.getElementById('resetEmailDisplay').textContent = email;
            switchTab('reset');
            startResendTimer();
            return;
        }

        showMessage(data.detail || 'Ошибка');
    } catch (err) {
        showMessage('Ошибка сети');
    } finally {
        setLoading('forgotBtn', 'forgotBtnText', false);
        document.getElementById('forgotBtnText').textContent = 'Отправить код';
    }
}

async function handleResetPassword(e) {
    e.preventDefault();
    hideMessage();

    const code = document.getElementById('resetCode').value.trim();
    const newPassword = document.getElementById('resetNewPassword').value;

    if (!code || code.length !== 6) {
        showMessage('Введите 6-значный код');
        return;
    }

    if (newPassword.length < 8) {
        showMessage('Пароль должен быть не менее 8 символов');
        return;
    }

    setLoading('resetBtn', 'resetBtnText', true);

    try {
        const { ok, data } = await apiCall('/api/auth/reset-password', {
            email: currentOtpEmail,
            code,
            new_password: newPassword,
        });

        if (ok) {
            window.location.href = 'settings.html';
            return;
        }

        showMessage(data.detail || 'Ошибка сброса пароля');
    } catch (err) {
        showMessage('Ошибка сети');
    } finally {
        setLoading('resetBtn', 'resetBtnText', false);
        document.getElementById('resetBtnText').textContent = 'Сбросить пароль';
    }
}

// ============================================================================
// RESEND TIMER
// ============================================================================

function startResendTimer() {
    const btn = document.getElementById('resendBtn');
    const timerEl = document.getElementById('resendTimer');
    let seconds = 60;

    btn.disabled = true;
    timerEl.textContent = seconds;

    if (resendTimerInterval) clearInterval(resendTimerInterval);

    resendTimerInterval = setInterval(() => {
        seconds--;
        timerEl.textContent = seconds;

        if (seconds <= 0) {
            clearInterval(resendTimerInterval);
            btn.disabled = false;
            btn.innerHTML = 'Отправить код повторно';
        }
    }, 1000);
}

// ============================================================================
// INIT: CHECK IF ALREADY AUTHENTICATED
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    const regEmail = document.getElementById('regEmail');
    if (regEmail) regEmail.addEventListener('input', updateRegPasswordChecks);

    try {
        let resp = await fetch(`${API_BASE_URL}/api/auth/me`, {
            method: 'GET', credentials: 'include',
        });
        if (resp.status === 401) {
            const refreshResp = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
                method: 'POST', credentials: 'include',
            });
            if (refreshResp.ok) {
                resp = await fetch(`${API_BASE_URL}/api/auth/me`, {
                    method: 'GET', credentials: 'include',
                });
            }
        }
        if (resp.ok) {
            const data = await resp.json();
            if (data.status === 'ok') {
                window.location.href = 'settings.html';
                return;
            }
        }
    } catch (_) {}
});
