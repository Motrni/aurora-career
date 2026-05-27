/**
 * aurora-bootstrap.js — мгновенный редирект по sessionStorage до отрисовки страницы.
 * Подключать синхронно в <head> первым скриптом на защищённых страницах.
 */
(function (global) {
    'use strict';

    var SNAPSHOT_KEY = 'aurora_session_snapshot';
    var SNAPSHOT_TTL_MS = 60000;

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

        if (go) {
            window.location.replace(go);
            return true;
        }
        return false;
    }

    function saveSnapshot(data) {
        try {
            var payload = {
                current_step: data.current_step || null,
                has_access: !!data.has_access,
                subscription_status: data.subscription_status || null,
                need_reauth: !!data.need_reauth,
                discount_expires_at: data.discount_expires_at || null,
                ts: Date.now(),
            };
            sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(payload));
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
    };
}(typeof window !== 'undefined' ? window : this));
