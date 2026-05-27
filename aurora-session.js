/**
 * aurora-session.js — общий слой сессии для всех внутренних страниц Aurora.
 *
 * Обязанности:
 *  1. Проактивный refresh JWT пока вкладка открыта (ping каждые 2.5 мин).
 *  2. При возврате на вкладку после >14 мин — немедленный refresh
 *     без предварительного /api/auth/me (access TTL = 15 мин).
 *  3. Экспорт refreshNow() — deduplicated Promise<boolean> для
 *     использования в page-скриптах при 401.
 *
 * Подключать ПЕРЕД page-скриптом:
 *   <script src="aurora-session.js?v=2"></script>
 * После успешной проверки JWT вызвать: AuroraSession.startPing();
 */
(function (global) {
    'use strict';

    var SESSION_PING_MS = 2.5 * 60 * 1000;
    var ACCESS_TTL_MS   = 14 * 60 * 1000;
    var _interval = null;
    var _visibilityBound = false;
    var _beforeUnloadBound = false;
    var _lastSuccessfulPing = Date.now();
    var _sessionDead = false;
    var _consecutiveRefreshFails = 0;
    var MAX_REFRESH_FAILS = 2;

    function getApiBase() {
        var h = window.location.hostname;
        if (h.indexOf('twc1.net') !== -1 || h.indexOf('aurora-develop') !== -1) {
            return 'https://api.aurora-develop.ru';
        }
        return 'https://api.aurora-career.ru';
    }

    function handleSessionDeath() {
        if (_sessionDead) return;
        _sessionDead = true;
        stopPing();
        var p = window.location.pathname;
        if (p !== '/auth/' && p !== '/auth') {
            window.location.href = '/auth/';
        }
    }

    var _refreshPromise = null;

    function refreshNow() {
        if (_sessionDead) return Promise.resolve(false);
        if (_refreshPromise) return _refreshPromise;

        var base = getApiBase();
        _refreshPromise = fetch(base + '/api/auth/refresh', {
            method: 'POST', credentials: 'include',
        })
        .then(function (r) {
            _refreshPromise = null;
            if (r.ok) {
                _lastSuccessfulPing = Date.now();
                _consecutiveRefreshFails = 0;
                return true;
            }
            _consecutiveRefreshFails++;
            if (_consecutiveRefreshFails >= MAX_REFRESH_FAILS) {
                handleSessionDeath();
            }
            return false;
        })
        .catch(function () {
            _refreshPromise = null;
            return false;
        });

        return _refreshPromise;
    }

    function runPing() {
        if (document.hidden || _sessionDead) return;
        if (_refreshPromise) return;
        var base = getApiBase();

        fetch(base + '/api/auth/me', { method: 'GET', credentials: 'include' })
            .then(function (r) {
                if (r.ok) {
                    _lastSuccessfulPing = Date.now();
                    _consecutiveRefreshFails = 0;
                    return r.json();
                } else if (r.status === 401) {
                    return refreshNow().then(function () { return null; });
                }
                return null;
            })
            .then(function (data) {
                if (!data || data.status !== 'ok') return;
                if (global.AuroraBootstrap && global.AuroraBootstrap.saveSnapshot) {
                    global.AuroraBootstrap.saveSnapshot({
                        current_step: data.current_step,
                        has_access: data.has_access,
                        subscription_status: data.subscription_status,
                        need_reauth: data.need_reauth,
                        discount_expires_at: data.discount && data.discount.expires_at,
                    });
                }
                if (global.AuroraSession.applyResumeNavLock) {
                    global.AuroraSession.applyResumeNavLock(data.subscription_status);
                }
                var p = window.location.pathname;
                if (data.has_access === false && (p.indexOf('/resume') === 0)) {
                    window.location.href = '/cabinet/';
                }
            })
            .catch(function () {});
    }

    function onVisibility() {
        if (document.hidden || _sessionDead) return;
        var gap = Date.now() - _lastSuccessfulPing;
        if (gap > ACCESS_TTL_MS) {
            refreshNow();
        } else {
            runPing();
        }
    }

    function onBeforeUnload() {
        stopPing();
    }

    function stopPing() {
        if (_interval) {
            clearInterval(_interval);
            _interval = null;
        }
        if (_visibilityBound) {
            document.removeEventListener('visibilitychange', onVisibility);
            _visibilityBound = false;
        }
        if (_beforeUnloadBound) {
            window.removeEventListener('beforeunload', onBeforeUnload);
            _beforeUnloadBound = false;
        }
    }

    function startPing() {
        _sessionDead = false;
        _consecutiveRefreshFails = 0;
        stopPing();
        _lastSuccessfulPing = Date.now();
        _interval = setInterval(runPing, SESSION_PING_MS);
        document.addEventListener('visibilitychange', onVisibility);
        _visibilityBound = true;
        window.addEventListener('beforeunload', onBeforeUnload);
        _beforeUnloadBound = true;
    }

    function applyResumeNavLock(subscriptionStatus) {
        var locked = subscriptionStatus === 'ended_trial' || subscriptionStatus === 'ended_active';
        var tip = 'Доступно после активации тарифа';
        document.querySelectorAll('a[href="/resume/"], a[href="/resume"]').forEach(function (el) {
            if (locked) {
                el.classList.add('nav-resume-locked');
                el.setAttribute('aria-disabled', 'true');
                el.dataset.resumeLockTip = tip;
                if (!el._resumeLockBound) {
                    el._resumeLockBound = true;
                    el.addEventListener('click', function (e) {
                        if (!el.classList.contains('nav-resume-locked')) return;
                        e.preventDefault();
                        if (global.AuroraSession.showResumeLockToast) {
                            global.AuroraSession.showResumeLockToast(tip);
                        }
                    });
                }
            } else {
                el.classList.remove('nav-resume-locked');
                el.removeAttribute('aria-disabled');
            }
        });
        if (!document.getElementById('auroraResumeLockCss')) {
            var st = document.createElement('style');
            st.id = 'auroraResumeLockCss';
            st.textContent = 'a.nav-resume-locked{opacity:0.4!important;cursor:not-allowed!important;pointer-events:auto}';
            document.head.appendChild(st);
        }
    }

    function showResumeLockToast(message) {
        var id = 'auroraResumeLockToast';
        var existing = document.getElementById(id);
        if (existing) existing.remove();
        var t = document.createElement('div');
        t.id = id;
        t.textContent = message;
        t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:10001;padding:12px 20px;border-radius:12px;background:rgba(33,30,41,0.95);border:1px solid rgba(147,142,160,0.2);color:#cac3d7;font-size:13px;font-family:Inter,system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,0.45)';
        document.body.appendChild(t);
        setTimeout(function () { t.remove(); }, 3200);
    }

    global.AuroraSession = {
        getApiBase: getApiBase,
        startPing: startPing,
        stopPing: stopPing,
        refreshNow: refreshNow,
        refreshOnce: refreshNow,
        isSessionDead: function () { return _sessionDead; },
        applyResumeNavLock: applyResumeNavLock,
        showResumeLockToast: showResumeLockToast,
    };

    // Устраняет FOUT для Material Symbols.
    // Инжектим <style> с visibility:hidden для иконок, пока шрифт не загружен.
    // После fonts.ready — удаляем стиль, иконки появляются без мигания букв.
    if (typeof document !== 'undefined' && document.fonts) {
        var _foutStyle = document.createElement('style');
        _foutStyle.textContent = '.material-symbols-outlined,.material-symbols-rounded,.material-symbols-sharp{visibility:hidden}';
        (document.head || document.documentElement).appendChild(_foutStyle);
        document.fonts.ready.then(function () {
            if (_foutStyle && _foutStyle.parentNode) {
                _foutStyle.parentNode.removeChild(_foutStyle);
            }
        });
    }
}(typeof window !== 'undefined' ? window : this));
