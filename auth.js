/**
 * auth.js — Логика страницы аутентификации Aurora Career.
 * Вход, регистрация, OTP-подтверждение, сброс пароля.
 */

const API_BASE_URL = (window.location.hostname.includes('twc1.net') || window.location.hostname.includes('aurora-develop'))
    ? 'https://api.aurora-develop.ru'
    : 'https://api.aurora-career.ru';

let currentOtpEmail = '';
let auditSource = null;
let pendingRefCode = null;

function _getUrlParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

async function redirectBySubscription() {
    try {
        const resp = await fetch(`${API_BASE_URL}/api/auth/me`, {
            method: 'GET', credentials: 'include',
        });
        if (resp.ok) {
            const data = await resp.json();
            if (data.status === 'ok') {
                if (data.need_reauth) {
                    window.location.href = '/reauth/';
                } else if (data.current_step && data.current_step.startsWith('onboarding_')) {
                    window.location.href = '/onboarding/';
                } else if (!data.has_access) {
                    window.location.href = '/cabinet/';
                } else {
                    window.location.href = '/settings/';
                }
                return;
            }
        }
    } catch (_) {}
    window.location.href = '/cabinet/';
}

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
    const forms = ['loginForm', 'registerForm', 'otpForm', 'forgotForm', 'resetForm', 'tgSuccessSection', 'tgLoginPending', 'tgLoginError'];
    forms.forEach(f => {
        const el = document.getElementById(f);
        if (el) el.classList.add('hidden');
    });
    hideMessage();

    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const tabsContainer = document.getElementById('authTabs');
    const tgLoginBlock = document.getElementById('tgLoginBlock');

    tabLogin.className = 'flex-1 pb-3 text-sm font-medium border-b-2 transition-colors tab-inactive';
    tabRegister.className = 'flex-1 pb-3 text-sm font-medium border-b-2 transition-colors tab-inactive';

    switch (tab) {
        case 'login':
            document.getElementById('loginForm').classList.remove('hidden');
            tabLogin.className = tabLogin.className.replace('tab-inactive', 'tab-active');
            tabsContainer.classList.remove('hidden');
            if (tgLoginBlock) tgLoginBlock.classList.remove('hidden');
            break;
        case 'register':
            document.getElementById('registerForm').classList.remove('hidden');
            tabRegister.className = tabRegister.className.replace('tab-inactive', 'tab-active');
            tabsContainer.classList.remove('hidden');
            if (tgLoginBlock) tgLoginBlock.classList.remove('hidden');
            break;
        case 'otp':
            document.getElementById('otpForm').classList.remove('hidden');
            tabsContainer.classList.add('hidden');
            if (tgLoginBlock) tgLoginBlock.classList.add('hidden');
            break;
        case 'forgot':
            document.getElementById('forgotForm').classList.remove('hidden');
            tabsContainer.classList.add('hidden');
            if (tgLoginBlock) tgLoginBlock.classList.add('hidden');
            break;
        case 'reset':
            document.getElementById('resetForm').classList.remove('hidden');
            tabsContainer.classList.add('hidden');
            if (tgLoginBlock) tgLoginBlock.classList.add('hidden');
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
            await redirectBySubscription();
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
    const consentPrivacy = document.getElementById('regConsentPrivacy')?.checked;
    const consentOffer = document.getElementById('regConsentOffer')?.checked;
    const btn = document.getElementById('regBtn');
    if (btn) btn.disabled = !(allPassed && email && pwd === confirm && consentPrivacy && consentOffer);
}

async function handleRegister(e) {
    e.preventDefault();
    hideMessage();

    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regPasswordConfirm').value;
    const consentPrivacy = document.getElementById('regConsentPrivacy')?.checked;
    const consentOffer = document.getElementById('regConsentOffer')?.checked;

    if (!email || !password || !confirm) return;

    if (password !== confirm) {
        showMessage('Пароли не совпадают');
        return;
    }

    if (password.length < 8 || !/[A-ZА-ЯЁ]/.test(password) || !/[0-9]/.test(password)) {
        showMessage('Пароль не соответствует требованиям');
        return;
    }

    if (!consentPrivacy || !consentOffer) {
        showMessage('Необходимо согласие с Политикой конфиденциальности и Офертой');
        return;
    }

    setLoading('regBtn', 'regBtnText', true);

    try {
        const payload = {
            email,
            password,
            consent_privacy: true,
            consent_offer: true,
            consent_privacy_version: (window.AURORA_LEGAL_VERSIONS && window.AURORA_LEGAL_VERSIONS.privacy) || null,
            consent_offer_version: (window.AURORA_LEGAL_VERSIONS && window.AURORA_LEGAL_VERSIONS.offer) || null,
        };
        if (auditSource) payload.source = 'audit';

        const { ok, status, data } = await apiCall('/api/auth/register', payload);

        if (ok || status === 201) {
            currentOtpEmail = email;
            currentOtpPurpose = 'email_verify';
            document.getElementById('otpEmailDisplay').textContent = email;
            switchTab('otp');
            startResendTimer();
            return;
        }

        if (status === 409 && auditSource) {
            switchTab('login');
            const loginEmail = document.getElementById('loginEmail');
            if (loginEmail) loginEmail.value = email;
            showMessage('Вы уже в Авроре — войдите, чтобы продолжить', 'info');
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
            await redirectBySubscription();
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
            await redirectBySubscription();
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

async function _showRefBadge(code) {
    const registerForm = document.getElementById('registerForm');
    if (!registerForm || document.getElementById('refBadge')) return;

    try {
        const resp = await fetch(`${API_BASE_URL}/api/mentor/check-promo?code=${encodeURIComponent(code)}`);
        const data = resp.ok ? await resp.json() : { valid: false };

        const badge = document.createElement('div');
        badge.id = 'refBadge';
        badge.className = 'mx-0 mb-1 rounded-lg px-4 py-2.5 text-sm fade-in';

        if (data.valid) {
            badge.style.cssText = 'background:rgba(101,62,219,0.12);border:1px solid rgba(204,190,255,0.18);color:#ccbeff;display:flex;align-items:center;gap:8px;';
            badge.innerHTML = '<span style="font-size:18px;line-height:1">&#10003;</span> Промокод <strong>' + code + '</strong> будет применён';
        } else {
            badge.style.cssText = 'background:rgba(248,113,113,0.10);border:1px solid rgba(248,113,113,0.20);color:#f87171;display:flex;align-items:center;gap:8px;';
            const reason = data.reason === 'used' ? 'уже использован' : 'не найден или неактивен';
            badge.innerHTML = '<span style="font-size:18px;line-height:1">&#10007;</span> Промокод <strong>' + code + '</strong> ' + reason;
            localStorage.removeItem('aurora_ref_code');
            pendingRefCode = null;
        }
        registerForm.insertBefore(badge, registerForm.firstChild);
    } catch (_) {
        // На случай сетевой ошибки — показываем как раньше (оптимистично)
        const badge = document.createElement('div');
        badge.id = 'refBadge';
        badge.className = 'mx-0 mb-1 rounded-lg px-4 py-2.5 text-sm fade-in';
        badge.style.cssText = 'background:rgba(101,62,219,0.12);border:1px solid rgba(204,190,255,0.18);color:#ccbeff;display:flex;align-items:center;gap:8px;';
        badge.innerHTML = '<span style="font-size:18px;line-height:1">&#10003;</span> Промокод <strong>' + code + '</strong> будет применён';
        registerForm.insertBefore(badge, registerForm.firstChild);
    }
}

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
// TELEGRAM BOT DEEP-LINK AUTH
// ============================================================================

let _tgLoginEventSource = null;
let _tgLoginToken = null;
let _tgSuccessCallback = null;

function updateTgBotLoginButton() {
    const btn = document.getElementById('tgLoginBtn');
    const hint = document.getElementById('tgLoginHint');
    const cp = document.getElementById('tgConsentPrivacy');
    const co = document.getElementById('tgConsentOffer');
    if (!btn || !cp || !co) return;
    const ok = cp.checked && co.checked;
    btn.disabled = !ok;
    btn.classList.toggle('opacity-50', !ok);
    btn.classList.toggle('cursor-not-allowed', !ok);
    btn.classList.toggle('cursor-pointer', ok);
    if (hint) hint.style.display = ok ? 'none' : 'block';
}

window.startTelegramBotLogin = async function() {
    const cp = document.getElementById('tgConsentPrivacy');
    const co = document.getElementById('tgConsentOffer');
    if (!cp?.checked || !co?.checked) {
        showMessage('Отметьте оба пункта согласий');
        return;
    }
    const btn = document.getElementById('tgLoginBtn');
    if (btn) btn.disabled = true;
    try {
        const resp = await fetch(`${API_BASE_URL}/api/auth/tg-bot/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ consent_privacy: true, consent_offer: true }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            showMessage(err.detail || 'Не удалось начать вход');
            if (btn) btn.disabled = false;
            updateTgBotLoginButton();
            return;
        }
        const data = await resp.json();
        _tgLoginToken = data.token;

        window.open(data.deep_link, '_blank');

        document.getElementById('tgLoginBlock')?.classList.add('hidden');
        document.getElementById('loginForm')?.classList.add('hidden');
        document.getElementById('registerForm')?.classList.add('hidden');
        document.getElementById('authTabs')?.classList.add('hidden');

        const pending = document.getElementById('tgLoginPending');
        if (pending) pending.classList.remove('hidden');
        const link = document.getElementById('tgLoginPendingLink');
        if (link) link.href = data.deep_link;

        _openTgLoginSse(data.token);
    } catch (e) {
        console.error('[TgBotLogin] init error', e);
        if (btn) btn.disabled = false;
        updateTgBotLoginButton();
        showMessage('Ошибка сети. Попробуйте ещё раз.');
    }
};

function _openTgLoginSse(token) {
    if (_tgLoginEventSource) {
        _tgLoginEventSource.close();
    }
    const url = `${API_BASE_URL}/api/auth/tg-bot/wait?token=${encodeURIComponent(token)}`;
    _tgLoginEventSource = new EventSource(url, { withCredentials: true });

    _tgLoginEventSource.addEventListener('ready', async () => {
        _tgLoginEventSource.close();
        _tgLoginEventSource = null;
        try {
            const resp = await fetch(`${API_BASE_URL}/api/auth/tg-bot/redeem`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ token }),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                _showTgBotLoginError(err.detail || 'Не удалось завершить вход. Попробуйте снова.');
                return;
            }
            const data = await resp.json();
            showTelegramLoginSuccess(false, () => {
                window.location.href = data.redirect || '/cabinet/';
            });
        } catch (err) {
            console.error('[TgBotLogin] redeem error', err);
            _showTgBotLoginError('Ошибка сети. Попробуйте снова.');
        }
    });

    _tgLoginEventSource.addEventListener('failed', (e) => {
        _tgLoginEventSource.close();
        _tgLoginEventSource = null;
        let reason = 'unknown';
        try { reason = JSON.parse(e.data).reason; } catch (_) {}
        const messages = {
            expired: 'Ссылка истекла. Попробуйте войти снова.',
            rejected: 'Вы отклонили запрос входа.',
            not_found: 'Ссылка не найдена. Попробуйте войти снова.',
            already_consumed: 'Ссылка уже использована.',
            timeout: 'Время ожидания истекло. Попробуйте войти снова.',
        };
        _showTgBotLoginError(messages[reason] || 'Не удалось войти. Попробуйте снова.');
    });
}

window.cancelTelegramBotLogin = function() {
    if (_tgLoginEventSource) {
        _tgLoginEventSource.close();
        _tgLoginEventSource = null;
    }
    _tgLoginToken = null;
    resetTelegramBotLogin();
};

window.resetTelegramBotLogin = function() {
    document.getElementById('tgLoginPending')?.classList.add('hidden');
    document.getElementById('tgLoginError')?.classList.add('hidden');
    document.getElementById('tgLoginBlock')?.classList.remove('hidden');
    document.getElementById('authTabs')?.classList.remove('hidden');
    const isLoginActive = document.getElementById('tabLogin')?.classList.contains('tab-active');
    if (isLoginActive !== false) {
        document.getElementById('loginForm')?.classList.remove('hidden');
    } else {
        document.getElementById('registerForm')?.classList.remove('hidden');
    }
    updateTgBotLoginButton();
};

function _showTgBotLoginError(text) {
    document.getElementById('tgLoginPending')?.classList.add('hidden');
    const errEl = document.getElementById('tgLoginError');
    if (errEl) errEl.classList.remove('hidden');
    const errText = document.getElementById('tgLoginErrorText');
    if (errText) errText.textContent = text;
}

function showTelegramLoginSuccess(isNew, onContinue) {
    const toHide = ['loginForm', 'registerForm', 'otpForm', 'forgotForm', 'resetForm', 'tgLoginBlock', 'tgLoginPending', 'tgLoginError'];
    toHide.forEach(id => document.getElementById(id)?.classList.add('hidden'));
    document.getElementById('authTabs')?.classList.add('hidden');

    const subtext = document.getElementById('tgSuccessSubtext');
    if (subtext) {
        subtext.textContent = isNew
            ? 'Аккаунт создан. Завершите настройку в личном кабинете.'
            : 'Добро пожаловать обратно.';
    }
    document.getElementById('tgSuccessSection')?.classList.remove('hidden');
    _tgSuccessCallback = onContinue;
}

function tgSuccessContinue() {
    if (_tgSuccessCallback) _tgSuccessCallback();
}

// ============================================================================
// INIT: CHECK IF ALREADY AUTHENTICATED
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    const regEmail = document.getElementById('regEmail');
    if (regEmail) regEmail.addEventListener('input', updateRegPasswordChecks);

    // Capture ref code from URL
    const urlRef = _getUrlParam('ref');
    if (urlRef) {
        pendingRefCode = urlRef.trim();
        localStorage.setItem('aurora_ref_code', pendingRefCode);
        await _showRefBadge(pendingRefCode);
        switchTab('register');
    } else {
        const storedRef = localStorage.getItem('aurora_ref_code');
        if (storedRef) {
            pendingRefCode = storedRef;
            await _showRefBadge(pendingRefCode);
        }
    }

    // Pre-fill from audit
    const urlEmail = _getUrlParam('email');
    const urlSource = _getUrlParam('source');
    if (urlSource === 'audit') {
        auditSource = 'audit';
        if (urlEmail && regEmail) {
            regEmail.value = decodeURIComponent(urlEmail);
            switchTab('register');
            const regPwd = document.getElementById('regPassword');
            if (regPwd) regPwd.focus();
            updateRegPasswordChecks();
        }
    }

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
                if (data.need_reauth) {
                    window.location.href = '/reauth/';
                } else if (!data.has_access) {
                    window.location.href = '/cabinet/';
                } else {
                    window.location.href = '/settings/';
                }
                return;
            }
        }
    } catch (_) {}

    document.getElementById('tgConsentPrivacy')?.addEventListener('change', updateTgBotLoginButton);
    document.getElementById('tgConsentOffer')?.addEventListener('change', updateTgBotLoginButton);
    updateTgBotLoginButton();
});
