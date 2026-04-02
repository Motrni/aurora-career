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

    function getApiBase() {
        var h = window.location.hostname;
        if (h.indexOf('twc1.net') !== -1 || h.indexOf('aurora-develop') !== -1) {
            return 'https://api.aurora-develop.ru';
        }
        return 'https://api.aurora-career.ru';
    }

    var _refreshPromise = null;

    /**
     * Deduplicated refresh. Если refresh уже в полёте — возвращает тот же Promise.
     * @returns {Promise<boolean>} true если новые cookies установлены.
     */
    function refreshNow() {
        if (_refreshPromise) return _refreshPromise;

        var base = getApiBase();
        _refreshPromise = fetch(base + '/api/auth/refresh', {
            method: 'POST', credentials: 'include',
        })
        .then(function (r) {
            _refreshPromise = null;
            if (r.ok) _lastSuccessfulPing = Date.now();
            return r.ok;
        })
        .catch(function () {
            _refreshPromise = null;
            return false;
        });

        return _refreshPromise;
    }

    function runPing() {
        if (document.hidden) return;
        if (_refreshPromise) return;
        var base = getApiBase();

        fetch(base + '/api/auth/me', { method: 'GET', credentials: 'include' })
            .then(function (r) {
                if (r.ok) {
                    _lastSuccessfulPing = Date.now();
                    return r.json();
                } else if (r.status === 401) {
                    refreshNow();
                }
                return null;
            })
            .then(function (data) {
                if (data && data.status === 'ok' && data.has_access === false) {
                    var p = window.location.pathname;
                    if (p !== '/cabinet/' && p !== '/cabinet') {
                        window.location.href = '/cabinet/';
                    }
                }
            })
            .catch(function () {});
    }

    function onVisibility() {
        if (document.hidden) return;
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

    /**
     * Запускает интервал ping + proactive refresh при возврате на вкладку.
     * Вызывать только если у пользователя активна JWT-сессия (не legacy HMAC).
     */
    function startPing() {
        stopPing();
        _lastSuccessfulPing = Date.now();
        _interval = setInterval(runPing, SESSION_PING_MS);
        document.addEventListener('visibilitychange', onVisibility);
        _visibilityBound = true;
        window.addEventListener('beforeunload', onBeforeUnload);
        _beforeUnloadBound = true;
    }

    global.AuroraSession = {
        getApiBase: getApiBase,
        startPing: startPing,
        stopPing: stopPing,
        refreshNow: refreshNow,
        refreshOnce: refreshNow,
    };
}(typeof window !== 'undefined' ? window : this));
