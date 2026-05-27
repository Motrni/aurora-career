/**
 * aurora-bootstrap.js — мгновенный редирект по sessionStorage до отрисовки страницы.
 * Подключать синхронно в <head> первым скриптом на защищённых страницах.
 */
(function (global) {
    'use strict';

    var SNAPSHOT_KEY = 'aurora_session_snapshot';
    var SNAPSHOT_TTL_MS = 60000;
    var REDIRECT_LOG_KEY = 'aurora_redirect_log';
    var REDIRECT_LOOP_WINDOW_MS = 3000;
    var REDIRECT_LOOP_MAX = 2;

    function injectHideStyle() {
        if (document.getElementById('auroraBootstrapHide')) return;
        var style = document.createElement('style');
        style.id = 'auroraBootstrapHide';
        style.textContent = 'html.aurora-boot-pending{visibility:hidden}';
        (document.head || document.documentElement).appendChild(style);
        document.documentElement.classList.add('aurora-boot-pending');
    }

    function revealPage() {
        document.documentElement.classList.remove('aurora-boot-pending');
        document.documentElement.classList.add('aurora-ready');
    }

    function readSnapshot() {
        try {
            var raw = sessionStorage.getItem(SNAPSHOT_KEY);
            if (!raw) return null;
            var d = JSON.parse(raw);
            if (!d || !d.ts || Date.now() - d.ts > SNAPSHOT_TTL_MS) return null;
            return d;
        } catch (e) {
            return null;
        }
    }

    function pushRedirectLog(target) {
        try {
            var raw = sessionStorage.getItem(REDIRECT_LOG_KEY);
            var arr = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(arr)) arr = [];
            var now = Date.now();
            arr = arr.filter(function (e) { return e && (now - e.ts) < REDIRECT_LOOP_WINDOW_MS; });
            arr.push({ target: target, ts: now });
            sessionStorage.setItem(REDIRECT_LOG_KEY, JSON.stringify(arr));
        } catch (e) { /* ignore */ }
    }

    function wouldLoop(target) {
        try {
            var raw = sessionStorage.getItem(REDIRECT_LOG_KEY);
            if (!raw) return false;
            var arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return false;
            var now = Date.now();
            var sameTarget = arr.filter(function (e) {
                return e && e.target === target && (now - e.ts) < REDIRECT_LOOP_WINDOW_MS;
            });
            return sameTarget.length >= REDIRECT_LOOP_MAX;
        } catch (e) {
            return false;
        }
    }

    function redirectForSnapshot(d) {
        if (!d) return false;
        var cur = window.location.pathname;
        var go = null;

        if (d.need_reauth && cur.indexOf('/reauth') !== 0) {
            go = '/reauth/';
        } else if (d.current_step === 'onboarding_settings' || d.current_step === 'onboarding_save_pending') {
            if (cur.indexOf('/settings') !== 0) go = '/settings/';
        } else if (d.current_step === 'onboarding_responses_tour') {
            if (cur.indexOf('/responses') !== 0) go = '/responses/';
        } else if (d.current_step && d.current_step.indexOf('onboarding_') === 0) {
            if (cur.indexOf('/onboarding') !== 0) go = '/onboarding/';
        } else if (cur.indexOf('/resume') === 0 && !d.has_access) {
            go = '/cabinet/';
        }

        if (!go) return false;

        if (wouldLoop(go)) {
            // Подозрение на цикл — выбрасываем устаревший snapshot и показываем
            // страницу как есть; финальный auth-flow развернёт пользователя сам.
            try { sessionStorage.removeItem(SNAPSHOT_KEY); } catch (e) {}
            try { console.warn('[AuroraBootstrap] redirect loop suppressed → ' + go); } catch (e) {}
            return false;
        }

        pushRedirectLog(go);
        window.location.replace(go);
        return true;
    }

    function saveSnapshot(data) {
        try {
            var prev = readSnapshot() || {};
            var payload = {
                current_step: data.current_step !== undefined ? data.current_step : prev.current_step || null,
                has_access: data.has_access !== undefined ? !!data.has_access : !!prev.has_access,
                subscription_status: data.subscription_status !== undefined ? data.subscription_status : prev.subscription_status || null,
                need_reauth: data.need_reauth !== undefined ? !!data.need_reauth : !!prev.need_reauth,
                discount_expires_at: data.discount_expires_at !== undefined ? data.discount_expires_at : prev.discount_expires_at || null,
                ts: Date.now(),
            };
            sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(payload));
        } catch (e) { /* ignore */ }
    }

    function clearSnapshot() {
        try {
            sessionStorage.removeItem(SNAPSHOT_KEY);
            sessionStorage.removeItem(REDIRECT_LOG_KEY);
        } catch (e) { /* ignore */ }
    }

    injectHideStyle();
    var snap = readSnapshot();
    if (!redirectForSnapshot(snap)) {
        revealPage();
    }

    global.AuroraBootstrap = {
        SNAPSHOT_KEY: SNAPSHOT_KEY,
        revealPage: revealPage,
        saveSnapshot: saveSnapshot,
        readSnapshot: readSnapshot,
        clearSnapshot: clearSnapshot,
    };
}(typeof window !== 'undefined' ? window : this));
