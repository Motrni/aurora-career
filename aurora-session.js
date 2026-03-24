/**
 * aurora-session.js — общий слой сессии для всех внутренних страниц Aurora.
 * Проактивный refresh JWT (POST /api/auth/refresh), пока вкладка открыта.
 *
 * Подключать ПЕРЕД page-скриптом (settings.js, responses.js):
 *   <script src="aurora-session.js?v=1"></script>
 * После успешной проверки JWT вызвать: AuroraSession.startPing();
 */
(function (global) {
    'use strict';

    var SESSION_PING_MS = 2.5 * 60 * 1000;
    var _interval = null;
    var _visibilityBound = false;
    var _beforeUnloadBound = false;

    function getApiBase() {
        var h = window.location.hostname;
        if (h.indexOf('twc1.net') !== -1 || h.indexOf('aurora-develop') !== -1) {
            return 'https://api.aurora-develop.ru';
        }
        return 'https://api.aurora-career.ru';
    }

    var _refreshLock = false;

    function runPing() {
        if (document.hidden) return;
        if (_refreshLock) return;
        var base = getApiBase();

        fetch(base + '/api/auth/me', { method: 'GET', credentials: 'include' })
            .then(function (r) {
                if (r.status === 401 && !_refreshLock) {
                    _refreshLock = true;
                    return fetch(base + '/api/auth/refresh', { method: 'POST', credentials: 'include' })
                        .then(function () { _refreshLock = false; })
                        .catch(function () { _refreshLock = false; });
                }
            })
            .catch(function () {});
    }

    function onVisibility() {
        if (!document.hidden) {
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
     * Запускает интервал ping + refresh при возврате на вкладку.
     * Вызывать только если у пользователя активна JWT-сессия (не legacy HMAC).
     */
    function startPing() {
        stopPing();
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
        refreshOnce: runPing
    };
}(typeof window !== 'undefined' ? window : this));
