/**
 * support-widget.js — Floating Support Chat Widget для Aurora.
 * Версия: 2.0
 *
 * - Кнопка справа внизу (как у Timeweb)
 * - Desktop: popup 380×520px над кнопкой
 * - Mobile: bottom-sheet на почти весь экран снизу
 * - Бейдж с количеством непрочитанных
 * - SSE для real-time ответов
 * - Не требует отдельной страницы
 */
(function () {
    'use strict';

    /* ---- Конфиг ---- */
    var API_BASE = (function () {
        var h = window.location.hostname;
        if (h.indexOf('twc1.net') !== -1 || h.indexOf('aurora-develop') !== -1) {
            return 'https://api.aurora-develop.ru';
        }
        return 'https://api.aurora-career.ru';
    })();

    var WELCOME = 'Привет! Опишите, что у вас случилось — мы обязательно ответим.';
    var Z_INDEX = 9999;

    /* ---- State ---- */
    var isOpen = false;
    var knownIds = new Set();
    var lastDateLabel = null;
    var sse = null;
    var unreadCount = 0;
    var initialized = false;
    var isAuthenticated = false;

    /* ---- Auth check (silent) ---- */
    async function checkAuth() {
        try {
            var r = await fetch(API_BASE + '/api/auth/me', { credentials: 'include' });
            if (r.ok) { isAuthenticated = true; return true; }
            if (window.AuroraSession) {
                var ok = await AuroraSession.refreshNow();
                if (ok) { isAuthenticated = true; return true; }
            }
        } catch (_) {}
        return false;
    }

    async function authFetch(url, opts) {
        opts = opts || {};
        opts.credentials = 'include';
        var r = await fetch(url, opts);
        if (r.status === 401 && window.AuroraSession) {
            var ok = await AuroraSession.refreshNow();
            if (ok) r = await fetch(url, opts);
        }
        return r;
    }

    /* ---- Helpers ---- */
    function esc(t) {
        var d = document.createElement('div');
        d.textContent = t;
        return d.innerHTML;
    }

    function fmtTime(iso) {
        return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }

    function fmtDate(iso) {
        var d = new Date(iso);
        var today = new Date();
        if (d.toDateString() === today.toDateString()) return 'Сегодня';
        var yest = new Date(today);
        yest.setDate(yest.getDate() - 1);
        if (d.toDateString() === yest.toDateString()) return 'Вчера';
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    }

    /* ---- DOM Building ---- */
    function injectStyles() {
        if (document.getElementById('aurora-support-styles')) return;
        var style = document.createElement('style');
        style.id = 'aurora-support-styles';
        style.textContent = [
            /* Кнопка */
            '.asc-btn{position:fixed;bottom:24px;right:24px;z-index:' + Z_INDEX + ';',
            'width:56px;height:56px;border-radius:50%;border:none;',
            'background:linear-gradient(135deg,#5a30d0,#7c4dda);',
            'color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;',
            'box-shadow:0 4px 20px rgba(90,48,208,0.5),0 2px 8px rgba(0,0,0,0.3);',
            'transition:transform 0.2s ease,box-shadow 0.2s ease;',
            'outline:none;}',
            '.asc-btn:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(90,48,208,0.65),0 3px 12px rgba(0,0,0,0.3);}',
            '.asc-btn:active{transform:scale(0.95);}',
            /* Бейдж */
            '.asc-badge{position:absolute;top:-4px;right:-4px;',
            'min-width:20px;height:20px;border-radius:10px;',
            'background:#ef4444;color:#fff;font-size:11px;font-weight:700;',
            'display:flex;align-items:center;justify-content:center;padding:0 5px;',
            'border:2px solid #15121c;',
            'transition:transform 0.2s cubic-bezier(0.34,1.56,0.64,1);}',
            '.asc-badge.hidden{transform:scale(0);}',
            /* Popup Desktop */
            '.asc-popup{position:fixed;bottom:92px;right:24px;z-index:' + (Z_INDEX + 1) + ';',
            'width:380px;height:520px;border-radius:20px;',
            'background:#1a1624;border:1px solid rgba(90,48,208,0.3);',
            'box-shadow:0 20px 60px rgba(0,0,0,0.6),0 4px 20px rgba(90,48,208,0.2);',
            'display:flex;flex-direction:column;overflow:hidden;',
            'transform-origin:bottom right;',
            'transition:opacity 0.25s ease,transform 0.25s cubic-bezier(0.34,1.2,0.64,1);}',
            '.asc-popup.asc-hidden{opacity:0;transform:scale(0.85) translateY(16px);pointer-events:none;}',
            /* Bottom Sheet Mobile */
            '@media(max-width:640px){',
            '.asc-btn{bottom:20px;right:16px;width:52px;height:52px;}',
            '.asc-popup{width:100%;height:88dvh;bottom:0;right:0;border-radius:20px 20px 0 0;',
            'transform-origin:bottom center;transition:opacity 0.3s ease,transform 0.3s cubic-bezier(0.34,1.1,0.64,1);}',
            '.asc-popup.asc-hidden{opacity:0;transform:translateY(100%);}',
            '}',
            /* Popup Header */
            '.asc-header{display:flex;align-items:center;gap:10px;',
            'padding:16px 20px;border-bottom:1px solid rgba(90,48,208,0.2);',
            'background:linear-gradient(135deg,rgba(90,48,208,0.15),rgba(124,77,218,0.08));',
            'flex-shrink:0;}',
            '.asc-header-avatar{width:36px;height:36px;border-radius:50%;',
            'background:linear-gradient(135deg,#5a30d0,#7c4dda);',
            'display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
            '.asc-header-info{flex:1;min-width:0;}',
            '.asc-header-title{font-size:14px;font-weight:700;color:#e7e0ef;line-height:1.2;}',
            '.asc-header-sub{font-size:11px;color:#cac3d7;opacity:0.6;margin-top:1px;}',
            '.asc-close-btn{width:32px;height:32px;border-radius:50%;border:none;',
            'background:rgba(255,255,255,0.06);color:#cac3d7;cursor:pointer;',
            'display:flex;align-items:center;justify-content:center;',
            'transition:background 0.15s,color 0.15s;}',
            '.asc-close-btn:hover{background:rgba(255,255,255,0.12);color:#e7e0ef;}',
            /* Messages area */
            '.asc-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;',
            'scrollbar-width:thin;scrollbar-color:rgba(90,48,208,0.4) transparent;}',
            '.asc-messages::-webkit-scrollbar{width:4px;}',
            '.asc-messages::-webkit-scrollbar-thumb{background:rgba(90,48,208,0.4);border-radius:4px;}',
            /* Bubbles */
            '.asc-bubble{max-width:82%;word-break:break-word;white-space:pre-wrap;',
            'font-size:13px;line-height:1.5;padding:10px 14px;border-radius:16px;',
            'animation:ascBubbleIn 0.2s ease-out;}',
            '@keyframes ascBubbleIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
            '@media(prefers-reduced-motion:reduce){.asc-bubble{animation:none}}',
            '.asc-bubble.user{background:linear-gradient(135deg,#5a30d0,#6d3ad8);color:#fff;',
            'border-bottom-right-radius:4px;align-self:flex-end;}',
            '.asc-bubble.admin{background:#2c2436;color:#e7e0ef;',
            'border-bottom-left-radius:4px;align-self:flex-start;}',
            '.asc-bubble-time{font-size:10px;margin-top:3px;opacity:0.45;text-align:right;}',
            '.asc-bubble.admin .asc-bubble-time{text-align:left;}',
            '.asc-bubble-row{display:flex;flex-direction:column;}',
            '.asc-bubble-row.user{align-items:flex-end;}',
            '.asc-bubble-row.admin{align-items:flex-start;}',
            '.asc-agent-name{font-size:11px;font-weight:600;color:#a78bfa;margin-bottom:4px;',
            'display:flex;align-items:center;gap:4px;}',
            /* Date sep */
            '.asc-date-sep{text-align:center;font-size:11px;color:rgba(202,195,215,0.4);',
            'margin:4px 0;display:flex;align-items:center;gap:8px;}',
            '.asc-date-sep::before,.asc-date-sep::after{content:"";flex:1;',
            'height:1px;background:rgba(255,255,255,0.06);}',
            /* Welcome */
            '.asc-welcome{background:rgba(90,48,208,0.1);border:1px solid rgba(90,48,208,0.2);',
            'border-radius:12px;padding:12px 14px;font-size:13px;color:#cac3d7;line-height:1.5;}',
            /* Input area */
            '.asc-input-area{display:flex;gap:8px;padding:12px 16px;',
            'border-top:1px solid rgba(255,255,255,0.06);align-items:flex-end;flex-shrink:0;',
            'background:rgba(15,10,24,0.5);}',
            '.asc-textarea{flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(90,48,208,0.25);',
            'color:#e7e0ef;padding:9px 13px;border-radius:12px;font-size:13px;',
            'font-family:inherit;resize:none;min-height:38px;max-height:100px;',
            'outline:none;transition:border-color 0.15s;line-height:1.5;}',
            '.asc-textarea:focus{border-color:rgba(90,48,208,0.6);}',
            '.asc-textarea::placeholder{color:rgba(202,195,215,0.35);}',
            '.asc-send-btn{width:38px;height:38px;border-radius:10px;border:none;flex-shrink:0;',
            'background:linear-gradient(135deg,#5a30d0,#7c4dda);color:#fff;cursor:pointer;',
            'display:flex;align-items:center;justify-content:center;',
            'transition:opacity 0.15s,transform 0.1s;}',
            '.asc-send-btn:hover:not(:disabled){opacity:0.85;}',
            '.asc-send-btn:active:not(:disabled){transform:scale(0.92);}',
            '.asc-send-btn:disabled{opacity:0.3;cursor:not-allowed;}',
            /* Auth prompt */
            '.asc-auth-prompt{flex:1;display:flex;flex-direction:column;align-items:center;',
            'justify-content:center;padding:24px;gap:12px;text-align:center;}',
            '.asc-auth-prompt p{font-size:14px;color:#cac3d7;line-height:1.5;}',
            '.asc-auth-link{display:inline-flex;align-items:center;gap:6px;',
            'padding:10px 20px;border-radius:12px;',
            'background:linear-gradient(135deg,#5a30d0,#7c4dda);',
            'color:#fff;font-size:13px;font-weight:600;text-decoration:none;',
            'transition:opacity 0.15s;}',
            '.asc-auth-link:hover{opacity:0.85;}',
            /* Overlay mobile */
            '.asc-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.5);',
            'z-index:' + Z_INDEX + ';display:none;}',
            '.asc-overlay.visible{display:block;}',
            '@media(min-width:641px){.asc-overlay{display:none!important;}}',
        ].join('');
        document.head.appendChild(style);
    }

    function buildWidget() {
        /* Overlay (mobile) */
        var overlay = document.createElement('div');
        overlay.className = 'asc-overlay';
        overlay.id = 'asc-overlay';
        overlay.addEventListener('click', closeWidget);

        /* FAB Button */
        var btn = document.createElement('button');
        btn.className = 'asc-btn';
        btn.id = 'asc-fab';
        btn.setAttribute('aria-label', 'Открыть поддержку');
        btn.setAttribute('title', 'Поддержка');
        btn.innerHTML =
            /* Chat icon SVG */
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z" fill="currentColor" opacity="0.9"/>' +
            '<circle cx="8" cy="10" r="1.5" fill="white"/>' +
            '<circle cx="12" cy="10" r="1.5" fill="white"/>' +
            '<circle cx="16" cy="10" r="1.5" fill="white"/>' +
            '</svg>' +
            /* Badge */
            '<span class="asc-badge hidden" id="asc-badge">0</span>';

        btn.addEventListener('click', toggleWidget);

        /* Popup */
        var popup = document.createElement('div');
        popup.className = 'asc-popup asc-hidden';
        popup.id = 'asc-popup';
        popup.setAttribute('role', 'dialog');
        popup.setAttribute('aria-label', 'Чат поддержки');
        popup.innerHTML =
            /* Header */
            '<div class="asc-header">' +
                '<div class="asc-header-avatar">' +
                    '<svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">' +
                    '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="asc-header-info">' +
                    '<div class="asc-header-title">Поддержка Авроры</div>' +
                    '<div class="asc-header-sub">Обычно отвечаем в течение дня</div>' +
                '</div>' +
                '<button class="asc-close-btn" onclick="window.__ascClose()" aria-label="Закрыть">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
                    '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>' +
                    '</svg>' +
                '</button>' +
            '</div>' +
            /* Messages */
            '<div class="asc-messages" id="asc-messages"></div>' +
            /* Input */
            '<div class="asc-input-area">' +
                '<textarea class="asc-textarea" id="asc-input" placeholder="Напишите сообщение..." rows="1" maxlength="4000" inputmode="text"></textarea>' +
                '<button class="asc-send-btn" id="asc-send" disabled aria-label="Отправить">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
                    '<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>' +
                    '</svg>' +
                '</button>' +
            '</div>';

        document.body.appendChild(overlay);
        document.body.appendChild(btn);
        document.body.appendChild(popup);

        /* Global close handler */
        window.__ascClose = closeWidget;

        /* Input events */
        var ta = document.getElementById('asc-input');
        var sb = document.getElementById('asc-send');
        ta.addEventListener('input', function () {
            sb.disabled = !ta.value.trim();
            ta.style.height = 'auto';
            ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
        });
        ta.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (ta.value.trim()) sendMessage();
            }
        });
        sb.addEventListener('click', sendMessage);
    }

    /* ---- Open / Close ---- */
    function openWidget() {
        isOpen = true;
        document.getElementById('asc-popup').classList.remove('asc-hidden');
        document.getElementById('asc-fab').setAttribute('aria-expanded', 'true');
        var overlay = document.getElementById('asc-overlay');
        if (overlay) overlay.classList.add('visible');

        if (!initialized) {
            initialized = true;
            loadContent();
        } else {
            markRead();
        }

        setTimeout(function () {
            var ta = document.getElementById('asc-input');
            if (ta) ta.focus();
        }, 300);
    }

    function closeWidget() {
        isOpen = false;
        document.getElementById('asc-popup').classList.add('asc-hidden');
        document.getElementById('asc-fab').setAttribute('aria-expanded', 'false');
        var overlay = document.getElementById('asc-overlay');
        if (overlay) overlay.classList.remove('visible');
    }

    function toggleWidget() {
        if (isOpen) closeWidget(); else openWidget();
    }

    /* ---- Badge ---- */
    function updateBadge() {
        var badge = document.getElementById('asc-badge');
        if (!badge) return;
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    function addUnread(n) {
        unreadCount += n || 1;
        updateBadge();
        pulseFab();
    }

    function clearUnread() {
        unreadCount = 0;
        updateBadge();
    }

    function pulseFab() {
        var fab = document.getElementById('asc-fab');
        if (!fab) return;
        fab.style.transform = 'scale(1.15)';
        setTimeout(function () { fab.style.transform = ''; }, 300);
    }

    /* ---- Rendering ---- */
    function renderWelcome(container) {
        var div = document.createElement('div');
        div.className = 'asc-welcome';
        div.innerHTML =
            '<div class="asc-agent-name">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="#a78bfa" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>' +
                'Поддержка' +
            '</div>' +
            esc(WELCOME);
        container.appendChild(div);
    }

    function renderDateSep(label, container) {
        var div = document.createElement('div');
        div.className = 'asc-date-sep';
        div.textContent = label;
        container.appendChild(div);
    }

    function renderMsg(msg, container) {
        if (knownIds.has(msg.id)) return;
        knownIds.add(msg.id);

        var dateLabel = fmtDate(msg.created_at);
        if (dateLabel !== lastDateLabel) {
            lastDateLabel = dateLabel;
            renderDateSep(dateLabel, container);
        }

        var isUser = msg.sender_type === 'user';
        var row = document.createElement('div');
        row.className = 'asc-bubble-row ' + (isUser ? 'user' : 'admin');
        row.setAttribute('data-id', msg.id);

        var labelHtml = isUser ? '' :
            '<div class="asc-agent-name">' +
                '<svg width="11" height="11" viewBox="0 0 24 24" fill="#a78bfa" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>' +
                'Поддержка' +
            '</div>';

        row.innerHTML =
            labelHtml +
            '<div class="asc-bubble ' + (isUser ? 'user' : 'admin') + '">' +
                esc(msg.message) +
                '<div class="asc-bubble-time">' + fmtTime(msg.created_at) + '</div>' +
            '</div>';

        container.appendChild(row);
    }

    function scrollBottom(smooth) {
        var el = document.getElementById('asc-messages');
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
    }

    function showAuthPrompt(container) {
        container.innerHTML = '';
        var div = document.createElement('div');
        div.className = 'asc-auth-prompt';
        div.innerHTML =
            '<svg width="40" height="40" viewBox="0 0 24 24" fill="#5a30d0" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>' +
            '<p>Войдите в аккаунт, чтобы написать в поддержку</p>' +
            '<a href="/auth/" class="asc-auth-link">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11 7L9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z"/></svg>' +
                'Войти' +
            '</a>';
        container.appendChild(div);
        /* Disable input */
        var ta = document.getElementById('asc-input');
        var sb = document.getElementById('asc-send');
        if (ta) { ta.disabled = true; ta.placeholder = 'Войдите, чтобы написать'; }
        if (sb) sb.disabled = true;
    }

    /* ---- Data loading ---- */
    async function loadContent() {
        var container = document.getElementById('asc-messages');
        if (!container) return;

        var authed = await checkAuth();
        if (!authed) {
            showAuthPrompt(container);
            return;
        }

        container.innerHTML = '';
        lastDateLabel = null;
        knownIds.clear();

        renderWelcome(container);

        try {
            var r = await authFetch(API_BASE + '/api/support/history');
            if (!r.ok) throw new Error('HTTP ' + r.status);
            var data = await r.json();
            var msgs = data.messages || [];
            for (var i = 0; i < msgs.length; i++) renderMsg(msgs[i], container);
            scrollBottom(false);
            clearUnread();
            markRead();
            startSSE();
        } catch (err) {
            console.error('[SupportWidget] loadContent:', err);
        }
    }

    async function markRead() {
        if (!isAuthenticated) return;
        try {
            await authFetch(API_BASE + '/api/support/read', { method: 'POST' });
        } catch (_) {}
        clearUnread();
    }

    /* ---- Send ---- */
    async function sendMessage() {
        var ta = document.getElementById('asc-input');
        var sb = document.getElementById('asc-send');
        if (!ta) return;
        var text = ta.value.trim();
        if (!text) return;

        sb.disabled = true;
        ta.disabled = true;

        try {
            var r = await authFetch(API_BASE + '/api/support/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text }),
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            var data = await r.json();
            if (data.message) {
                var container = document.getElementById('asc-messages');
                renderMsg(data.message, container);
                scrollBottom(true);
            }
            ta.value = '';
            ta.style.height = 'auto';
        } catch (err) {
            console.error('[SupportWidget] send:', err);
        } finally {
            ta.disabled = false;
            ta.focus();
            sb.disabled = !ta.value.trim();
        }
    }

    /* ---- SSE ---- */
    function startSSE() {
        if (sse) { sse.close(); sse = null; }
        sse = new EventSource(API_BASE + '/api/support/stream', { withCredentials: true });

        sse.onmessage = function (e) {
            try {
                var p = JSON.parse(e.data);
                if (p.type !== 'message' || p.sender_type !== 'admin') return;

                var container = document.getElementById('asc-messages');
                if (container) renderMsg(p, container);

                if (isOpen) {
                    scrollBottom(true);
                    markRead();
                } else {
                    addUnread(1);
                }
            } catch (_) {}
        };

        sse.onerror = function () {
            if (sse) sse.close();
            sse = null;
            setTimeout(function () { if (isAuthenticated) startSSE(); }, 5000);
        };
    }

    /* ---- Keyboard ESC ---- */
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen) closeWidget();
    });

    /* ---- Init ---- */
    function init() {
        injectStyles();
        buildWidget();

        /* Если уже авторизован — запускаем SSE для подсчёта непрочитанных фоном */
        checkAuth().then(function (ok) {
            if (ok && !sse) startSSE();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
