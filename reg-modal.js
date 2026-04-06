/**
 * reg-modal.js v1.0 — Универсальная модалка обязательной регистрации (email + пароль + OTP).
 *
 * Подключается на ВСЕХ страницах Aurora Career ПОСЛЕ aurora-session.js.
 * Экспортирует единственную функцию: window.checkRegModal(meData)
 *   — если !has_password || !email_verified, показывает модалку.
 *
 * API_BASE_URL берётся из AuroraSession.getApiBase() или глобальной переменной.
 */

(function () {
    'use strict';

    function _getApiBase() {
        if (typeof API_BASE_URL !== 'undefined' && API_BASE_URL) return API_BASE_URL;
        if (window.AuroraSession) return window.AuroraSession.getApiBase();
        var h = window.location.hostname;
        if (h.indexOf('twc1.net') !== -1 || h.indexOf('aurora-develop') !== -1)
            return 'https://api.aurora-develop.ru';
        return 'https://api.aurora-career.ru';
    }

    var _email = '';
    var _resendInterval = null;
    var _injected = false;

    var MODAL_HTML =
        '<div id="regModal" class="fixed inset-0 z-[200] hidden" style="background:rgba(16,13,23,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);">' +
        '<div class="flex items-center justify-center min-h-screen p-4">' +
        '<div class="w-full max-w-md rounded-2xl border border-white/10 shadow-2xl relative" style="background:rgba(55,51,62,0.6);backdrop-filter:blur(40px);">' +
        '<div id="regStep1" class="p-6 md:p-8 space-y-5">' +
            '<div class="text-center space-y-2">' +
                '<div class="w-14 h-14 bg-[#5a30d0]/20 rounded-2xl flex items-center justify-center mx-auto"><span class="material-symbols-outlined text-[#ccbeff] text-2xl">shield_person</span></div>' +
                '<h3 class="text-xl font-bold text-white">Защитите свой аккаунт</h3>' +
                '<p class="text-[#cac3d7] text-sm leading-relaxed">Добавьте email и пароль для безопасного входа на сайт</p>' +
            '</div>' +
            '<div><label class="block text-[#cac3d7] text-xs font-medium mb-1.5">Email</label>' +
                '<input type="email" id="regModalEmail" required autocomplete="email" class="w-full bg-[#211e29] border border-[#484455] rounded-xl px-4 py-3 text-[#e7e0ef] text-sm placeholder:text-[#938ea0] focus:border-[#ccbeff] focus:ring-1 focus:ring-[#ccbeff]/20 outline-none transition-colors" placeholder="user@example.com"></div>' +
            '<div><label class="block text-[#cac3d7] text-xs font-medium mb-1.5">Пароль</label>' +
                '<div class="relative">' +
                    '<input type="password" id="regModalPassword" required autocomplete="new-password" class="w-full bg-[#211e29] border border-[#484455] rounded-xl px-4 py-3 pr-11 text-[#e7e0ef] text-sm placeholder:text-[#938ea0] focus:border-[#ccbeff] focus:ring-1 focus:ring-[#ccbeff]/20 outline-none transition-colors" placeholder="Введите пароль">' +
                    '<button type="button" class="regModalTogglePwd absolute right-3 top-1/2 -translate-y-1/2 text-[#938ea0] hover:text-[#ccbeff] transition-colors" data-target="regModalPassword"><span class="material-symbols-outlined text-xl">visibility_off</span></button>' +
                '</div>' +
                '<div class="mt-3 space-y-1.5" id="pwdChecks">' +
                    '<div class="flex items-center gap-2 text-xs" id="chkLength"><span class="material-symbols-outlined text-sm text-[#938ea0]" id="chkLengthIcon">radio_button_unchecked</span><span class="text-[#938ea0]">Минимум 8 символов</span></div>' +
                    '<div class="flex items-center gap-2 text-xs" id="chkUpper"><span class="material-symbols-outlined text-sm text-[#938ea0]" id="chkUpperIcon">radio_button_unchecked</span><span class="text-[#938ea0]">Одна заглавная буква</span></div>' +
                    '<div class="flex items-center gap-2 text-xs" id="chkDigit"><span class="material-symbols-outlined text-sm text-[#938ea0]" id="chkDigitIcon">radio_button_unchecked</span><span class="text-[#938ea0]">Одна цифра</span></div>' +
                    '<div class="flex items-center gap-2 text-xs" id="chkLower"><span class="material-symbols-outlined text-sm text-[#938ea0]" id="chkLowerIcon">radio_button_unchecked</span><span class="text-[#938ea0]">Одна строчная буква или символ</span></div>' +
                '</div>' +
            '</div>' +
            '<div><label class="block text-[#cac3d7] text-xs font-medium mb-1.5">Подтвердите пароль</label>' +
                '<div class="relative">' +
                    '<input type="password" id="regModalPasswordConfirm" required autocomplete="new-password" class="w-full bg-[#211e29] border border-[#484455] rounded-xl px-4 py-3 pr-11 text-[#e7e0ef] text-sm placeholder:text-[#938ea0] focus:border-[#ccbeff] focus:ring-1 focus:ring-[#ccbeff]/20 outline-none transition-colors" placeholder="Повторите пароль">' +
                    '<button type="button" class="regModalTogglePwd absolute right-3 top-1/2 -translate-y-1/2 text-[#938ea0] hover:text-[#ccbeff] transition-colors" data-target="regModalPasswordConfirm"><span class="material-symbols-outlined text-xl">visibility_off</span></button>' +
                '</div>' +
            '</div>' +
            '<div id="regModalError" class="hidden rounded-lg px-4 py-2.5 text-sm bg-[#93000a]/30 text-[#ffb4ab] border border-[#ffb4ab]/20"></div>' +
            '<button id="regModalBtn" disabled class="w-full text-white font-medium py-3 rounded-xl text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed" style="background:linear-gradient(135deg,#653edb,#5a30d0);"><span id="regModalBtnText">Продолжить</span></button>' +
        '</div>' +
        '<div id="regStep2" class="p-6 md:p-8 space-y-5 hidden">' +
            '<div class="text-center space-y-2">' +
                '<span class="material-symbols-outlined text-[#ccbeff] text-4xl">mail</span>' +
                '<h3 class="text-xl font-bold text-white">Подтвердите email</h3>' +
                '<p class="text-[#cac3d7] text-sm">Код отправлен на <span id="regModalOtpEmail" class="text-[#ccbeff] font-medium"></span></p>' +
            '</div>' +
            '<input type="text" id="regModalOtpCode" required maxlength="6" pattern="[0-9]{6}" inputmode="numeric" autocomplete="one-time-code" class="w-full bg-[#211e29] border border-[#484455] rounded-xl px-4 py-4 text-[#ccbeff] text-center text-2xl font-semibold tracking-[0.5em] placeholder:text-[#938ea0] focus:border-[#ccbeff] focus:ring-1 focus:ring-[#ccbeff]/20 outline-none transition-colors" placeholder="000000">' +
            '<div id="regModalOtpStatus" class="text-center text-xs mt-1"></div>' +
            '<div id="regModalOtpError" class="hidden rounded-lg px-4 py-2.5 text-sm bg-[#93000a]/30 text-[#ffb4ab] border border-[#ffb4ab]/20"></div>' +
            '<button id="regModalOtpBtn" class="w-full text-white font-medium py-3 rounded-xl text-sm transition-all" style="background:linear-gradient(135deg,#653edb,#5a30d0);"><span id="regModalOtpBtnText">Подтвердить</span></button>' +
            '<div class="text-center"><button id="regModalResendBtn" disabled class="text-[#ccbeff] text-xs hover:underline disabled:opacity-40 disabled:cursor-not-allowed">Отправить повторно (<span id="regModalResendTimer">60</span>с)</button></div>' +
        '</div>' +
        '</div></div></div>';

    function _inject() {
        if (_injected) return;
        _injected = true;
        var wrapper = document.createElement('div');
        wrapper.innerHTML = MODAL_HTML;
        document.body.appendChild(wrapper.firstElementChild);
        _bind();
    }

    function _bind() {
        document.querySelectorAll('.regModalTogglePwd').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var input = document.getElementById(btn.dataset.target);
                if (!input) return;
                var icon = btn.querySelector('.material-symbols-outlined');
                if (input.type === 'password') {
                    input.type = 'text';
                    if (icon) icon.textContent = 'visibility';
                } else {
                    input.type = 'password';
                    if (icon) icon.textContent = 'visibility_off';
                }
            });
        });

        var pwdInput = document.getElementById('regModalPassword');
        var confirmInput = document.getElementById('regModalPasswordConfirm');
        var emailInput = document.getElementById('regModalEmail');
        if (pwdInput) pwdInput.addEventListener('input', _updateChecks);
        if (confirmInput) confirmInput.addEventListener('input', _updateChecks);
        if (emailInput) emailInput.addEventListener('input', _updateChecks);

        document.getElementById('regModalBtn')?.addEventListener('click', _handleSubmit);
        document.getElementById('regModalOtpBtn')?.addEventListener('click', _handleVerify);
        document.getElementById('regModalResendBtn')?.addEventListener('click', _handleResend);
    }

    function _updateChecks() {
        var pwd = (document.getElementById('regModalPassword')?.value) || '';
        var checks = [
            { id: 'chkLength', icon: 'chkLengthIcon', pass: pwd.length >= 8 },
            { id: 'chkUpper',  icon: 'chkUpperIcon',  pass: /[A-ZА-ЯЁ]/.test(pwd) },
            { id: 'chkDigit',  icon: 'chkDigitIcon',  pass: /[0-9]/.test(pwd) },
            { id: 'chkLower',  icon: 'chkLowerIcon',  pass: /[a-zа-яё!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd) },
        ];

        var allPassed = true;
        checks.forEach(function (c) {
            var icon = document.getElementById(c.icon);
            var row = document.getElementById(c.id);
            if (!icon || !row) return;
            var label = row.querySelector('span:last-child');
            if (c.pass) {
                icon.textContent = 'check_circle'; icon.style.color = '#4ade80';
                if (label) label.style.color = '#4ade80';
            } else {
                icon.textContent = 'radio_button_unchecked'; icon.style.color = '#938ea0';
                if (label) label.style.color = '#938ea0';
                allPassed = false;
            }
        });

        var btn = document.getElementById('regModalBtn');
        var emailVal = document.getElementById('regModalEmail')?.value?.trim();
        var confirmVal = document.getElementById('regModalPasswordConfirm')?.value;
        var match = pwd && confirmVal && pwd === confirmVal;
        if (btn) btn.disabled = !(allPassed && emailVal && match);
    }

    async function _handleSubmit() {
        var base = _getApiBase();
        var emailEl = document.getElementById('regModalEmail');
        var pwdEl = document.getElementById('regModalPassword');
        var confirmEl = document.getElementById('regModalPasswordConfirm');
        var errEl = document.getElementById('regModalError');
        var btn = document.getElementById('regModalBtn');
        var btnText = document.getElementById('regModalBtnText');

        var emailVal = emailEl.value.trim();
        var pwd = pwdEl.value;

        errEl.classList.add('hidden');

        if (pwd !== confirmEl.value) {
            errEl.textContent = 'Пароли не совпадают'; errEl.classList.remove('hidden'); return;
        }

        btn.disabled = true;
        btnText.innerHTML = '<span style="border:2px solid rgba(204,190,255,0.2);border-top-color:#ccbeff;border-radius:50%;width:18px;height:18px;animation:spin 0.6s linear infinite;display:inline-block;"></span>';

        try {
            var resp = await fetch(base + '/api/auth/set-credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email: emailVal, password: pwd }),
            });
            var data = await resp.json();
            if (resp.ok) {
                _email = emailVal;
                document.getElementById('regStep1').classList.add('hidden');
                document.getElementById('regStep2').classList.remove('hidden');
                document.getElementById('regModalOtpEmail').textContent = emailVal;
                _startResendTimer();
            } else {
                errEl.textContent = data.detail || 'Ошибка'; errEl.classList.remove('hidden');
            }
        } catch (_) {
            errEl.textContent = 'Ошибка сети'; errEl.classList.remove('hidden');
        } finally {
            btn.disabled = false; btnText.textContent = 'Продолжить';
        }
    }

    async function _handleVerify() {
        var base = _getApiBase();
        var code = document.getElementById('regModalOtpCode').value.trim();
        var errEl = document.getElementById('regModalOtpError');
        var btn = document.getElementById('regModalOtpBtn');
        var btnText = document.getElementById('regModalOtpBtnText');

        errEl.classList.add('hidden');
        if (!code || code.length !== 6) {
            errEl.textContent = 'Введите 6-значный код'; errEl.classList.remove('hidden'); return;
        }

        btn.disabled = true;
        btnText.innerHTML = '<span style="border:2px solid rgba(204,190,255,0.2);border-top-color:#ccbeff;border-radius:50%;width:18px;height:18px;animation:spin 0.6s linear infinite;display:inline-block;"></span>';

        try {
            var resp = await fetch(base + '/api/auth/verify-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email: _email, code: code }),
            });
            var data = await resp.json();
            if (resp.ok) {
                document.getElementById('regModal').classList.add('hidden');
                document.body.style.overflow = '';
            } else {
                errEl.textContent = data.detail || 'Неверный код'; errEl.classList.remove('hidden');
            }
        } catch (_) {
            errEl.textContent = 'Ошибка сети'; errEl.classList.remove('hidden');
        } finally {
            btn.disabled = false; btnText.textContent = 'Подтвердить';
        }
    }

    async function _sendOtpSilent(emailVal) {
        var base = _getApiBase();
        var statusEl = document.getElementById('regModalOtpStatus');
        try {
            var resp = await fetch(base + '/api/auth/resend-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email: emailVal, purpose: 'email_verify' }),
            });
            if (resp.ok) {
                if (statusEl) { statusEl.textContent = 'Код отправлен на почту'; statusEl.className = 'text-center text-xs text-green-400 mt-1'; }
                _startResendTimer();
            } else if (resp.status === 429) {
                var d = await resp.json();
                var m = d.detail?.match(/(\d+)/);
                _startResendTimer(m ? parseInt(m[1]) : 60);
            } else {
                if (statusEl) { statusEl.textContent = 'Ошибка отправки'; statusEl.className = 'text-center text-xs text-[#ffb4ab] mt-1'; }
                var rb = document.getElementById('regModalResendBtn');
                if (rb) { rb.disabled = false; rb.innerHTML = 'Отправить повторно'; }
            }
        } catch (_) {
            if (statusEl) { statusEl.textContent = 'Ошибка сети'; statusEl.className = 'text-center text-xs text-[#ffb4ab] mt-1'; }
        }
    }

    async function _handleResend() {
        var base = _getApiBase();
        var btn = document.getElementById('regModalResendBtn');
        var statusEl = document.getElementById('regModalOtpStatus');
        btn.disabled = true; btn.innerHTML = 'Отправка...';
        if (statusEl) { statusEl.textContent = ''; statusEl.className = ''; }
        try {
            var resp = await fetch(base + '/api/auth/resend-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email: _email, purpose: 'email_verify' }),
            });
            if (resp.ok) {
                if (statusEl) { statusEl.textContent = 'Код отправлен'; statusEl.className = 'text-center text-xs text-green-400 mt-1'; }
                _startResendTimer();
            } else {
                var data = await resp.json().catch(function () { return {}; });
                if (resp.status === 429) {
                    var m = data.detail?.match(/(\d+)/);
                    _startResendTimer(m ? parseInt(m[1]) : 60);
                } else {
                    if (statusEl) { statusEl.textContent = data.detail || 'Ошибка отправки'; statusEl.className = 'text-center text-xs text-[#ffb4ab] mt-1'; }
                    btn.disabled = false; btn.innerHTML = 'Отправить повторно';
                }
            }
        } catch (_) {
            if (statusEl) { statusEl.textContent = 'Ошибка сети'; statusEl.className = 'text-center text-xs text-[#ffb4ab] mt-1'; }
            btn.disabled = false; btn.innerHTML = 'Отправить повторно';
        }
    }

    function _startResendTimer(startSec) {
        var btn = document.getElementById('regModalResendBtn');
        var sec = startSec || 60;
        btn.disabled = true;
        btn.innerHTML = 'Отправить повторно (<span id="regModalResendTimer">' + sec + '</span>с)';
        if (_resendInterval) clearInterval(_resendInterval);
        _resendInterval = setInterval(function () {
            sec--;
            var t = document.getElementById('regModalResendTimer');
            if (t) t.textContent = sec;
            if (sec <= 0) {
                clearInterval(_resendInterval);
                btn.disabled = false;
                btn.innerHTML = 'Отправить повторно';
            }
        }, 1000);
    }

    function _showModal(hasPassword, emailVerified, emailVal) {
        _inject();
        var modal = document.getElementById('regModal');
        if (!modal) return;
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        if (hasPassword && !emailVerified && emailVal) {
            _email = emailVal;
            document.getElementById('regStep1').classList.add('hidden');
            document.getElementById('regStep2').classList.remove('hidden');
            document.getElementById('regModalOtpEmail').textContent = emailVal;
            _sendOtpSilent(emailVal);
            return;
        }

        document.getElementById('regStep1').classList.remove('hidden');
        document.getElementById('regStep2').classList.add('hidden');
    }

    /**
     * Вызвать после получения данных /api/auth/me.
     * @param {Object} meData — объект с полями has_password, email_verified, email.
     */
    window.checkRegModal = function (meData) {
        if (!meData) return;
        if (!meData.has_password || !meData.email_verified) {
            _showModal(meData.has_password, meData.email_verified, meData.email);
        }
    };
})();
