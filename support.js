/**
 * support.js — Чат поддержки Aurora.
 * Загружает историю, отправляет сообщения, слушает SSE для real-time обновлений.
 */
(function () {
    'use strict';

    var API_BASE = window.AuroraSession
        ? window.AuroraSession.getApiBase()
        : ((window.location.hostname.indexOf('twc1.net') !== -1 || window.location.hostname.indexOf('aurora-develop') !== -1)
            ? 'https://api.aurora-develop.ru'
            : 'https://api.aurora-career.ru');

    var chatMessages = document.getElementById('chatMessages');
    var chatInput = document.getElementById('chatInput');
    var sendBtn = document.getElementById('sendBtn');
    var eventSource = null;
    var knownMessageIds = new Set();
    var chatId = null;

    var WELCOME_MESSAGE = 'Привет! Опишите, что у вас случилось — мы обязательно ответим.';

    // --- Auth fetch with JWT refresh ---

    async function authFetch(url, options) {
        options = options || {};
        options.credentials = 'include';
        var resp = await fetch(url, options);

        if (resp.status === 401 && window.AuroraSession) {
            var ok = await AuroraSession.refreshNow();
            if (ok) {
                resp = await fetch(url, options);
            } else {
                window.location.href = '/auth/';
                return resp;
            }
        }
        return resp;
    }

    // --- Rendering ---

    function formatTime(isoStr) {
        var d = new Date(isoStr);
        return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }

    function formatDate(isoStr) {
        var d = new Date(isoStr);
        var today = new Date();
        if (d.toDateString() === today.toDateString()) return 'Сегодня';
        var yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function renderWelcome() {
        var div = document.createElement('div');
        div.className = 'flex justify-start';
        div.innerHTML =
            '<div class="chat-bubble bg-surface-container-high rounded-2xl rounded-tl-md px-4 py-3 text-sm text-on-surface">' +
                '<div class="flex items-center gap-2 mb-1.5">' +
                    '<span class="material-symbols-outlined text-base text-[#ccbeff]" style="font-variation-settings:\'FILL\' 1">support_agent</span>' +
                    '<span class="text-xs font-semibold text-[#ccbeff]">Поддержка</span>' +
                '</div>' +
                '<div>' + escapeHtml(WELCOME_MESSAGE) + '</div>' +
            '</div>';
        chatMessages.appendChild(div);
    }

    var lastRenderedDate = null;

    function maybeRenderDateSeparator(isoStr) {
        var dateLabel = formatDate(isoStr);
        if (dateLabel !== lastRenderedDate) {
            lastRenderedDate = dateLabel;
            var sep = document.createElement('div');
            sep.className = 'flex justify-center my-2';
            sep.innerHTML = '<span class="text-xs text-on-surface-variant/50 bg-surface-container px-3 py-1 rounded-full">' + escapeHtml(dateLabel) + '</span>';
            chatMessages.appendChild(sep);
        }
    }

    function renderMessage(msg) {
        if (knownMessageIds.has(msg.id)) return;
        knownMessageIds.add(msg.id);

        maybeRenderDateSeparator(msg.created_at);

        var isUser = msg.sender_type === 'user';
        var wrapper = document.createElement('div');
        wrapper.className = 'flex ' + (isUser ? 'justify-end' : 'justify-start');

        var bubbleClass = isUser
            ? 'bg-primary-container/80 rounded-2xl rounded-tr-md text-white'
            : 'bg-surface-container-high rounded-2xl rounded-tl-md text-on-surface';

        var labelHtml = isUser ? '' :
            '<div class="flex items-center gap-2 mb-1.5">' +
                '<span class="material-symbols-outlined text-base text-[#ccbeff]" style="font-variation-settings:\'FILL\' 1">support_agent</span>' +
                '<span class="text-xs font-semibold text-[#ccbeff]">Поддержка</span>' +
            '</div>';

        wrapper.innerHTML =
            '<div class="chat-bubble ' + bubbleClass + ' px-4 py-3 text-sm">' +
                labelHtml +
                '<div>' + escapeHtml(msg.message) + '</div>' +
                '<div class="text-[10px] mt-1 ' + (isUser ? 'text-white/50' : 'text-on-surface-variant/40') + ' text-right">' + formatTime(msg.created_at) + '</div>' +
            '</div>';

        chatMessages.appendChild(wrapper);
    }

    function scrollToBottom(smooth) {
        chatMessages.scrollTo({
            top: chatMessages.scrollHeight,
            behavior: smooth ? 'smooth' : 'instant'
        });
    }

    // --- Data loading ---

    async function loadHistory() {
        try {
            var resp = await authFetch(API_BASE + '/api/support/history');
            if (!resp.ok) {
                if (resp.status === 401) return;
                throw new Error('HTTP ' + resp.status);
            }
            var data = await resp.json();
            chatId = data.chat_id || null;
            var messages = data.messages || [];

            chatMessages.innerHTML = '';
            lastRenderedDate = null;
            knownMessageIds.clear();

            renderWelcome();

            for (var i = 0; i < messages.length; i++) {
                renderMessage(messages[i]);
            }
            scrollToBottom(false);

            markRead();
            startSSE();
        } catch (err) {
            console.error('[Support] loadHistory error:', err);
            chatMessages.innerHTML = '';
            renderWelcome();
        }
    }

    async function markRead() {
        try {
            await authFetch(API_BASE + '/api/support/read', { method: 'POST' });
        } catch (_) { /* ignore */ }
    }

    // --- Sending ---

    async function sendMessage() {
        var text = chatInput.value.trim();
        if (!text) return;

        sendBtn.disabled = true;
        chatInput.disabled = true;

        try {
            var resp = await authFetch(API_BASE + '/api/support/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text }),
            });

            if (!resp.ok) throw new Error('HTTP ' + resp.status);

            var data = await resp.json();
            if (data.message) {
                renderMessage(data.message);
                scrollToBottom(true);
            }
            chatInput.value = '';
            updateInputHeight();
        } catch (err) {
            console.error('[Support] send error:', err);
        } finally {
            chatInput.disabled = false;
            chatInput.focus();
            updateSendBtn();
        }
    }

    // --- SSE ---

    function startSSE() {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }

        eventSource = new EventSource(API_BASE + '/api/support/stream', { withCredentials: true });

        eventSource.onmessage = function (e) {
            try {
                var payload = JSON.parse(e.data);
                if (payload.type === 'message' && payload.sender_type === 'admin') {
                    renderMessage(payload);
                    scrollToBottom(true);
                    markRead();
                }
            } catch (_) { /* ignore pings */ }
        };

        eventSource.onerror = function () {
            if (eventSource) eventSource.close();
            eventSource = null;
            setTimeout(startSSE, 5000);
        };
    }

    // --- Input handling ---

    function updateSendBtn() {
        sendBtn.disabled = !chatInput.value.trim();
    }

    function updateInputHeight() {
        chatInput.style.height = 'auto';
        var maxH = 120;
        chatInput.style.height = Math.min(chatInput.scrollHeight, maxH) + 'px';
    }

    chatInput.addEventListener('input', function () {
        updateSendBtn();
        updateInputHeight();
    });

    chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (chatInput.value.trim()) sendMessage();
        }
    });

    sendBtn.addEventListener('click', sendMessage);

    // --- Logout ---

    window.handleNavLogout = async function () {
        try {
            await fetch(API_BASE + '/api/auth/logout', { method: 'POST', credentials: 'include' });
        } catch (_) {}
        window.location.href = '/auth/';
    };

    // --- Init ---

    async function init() {
        try {
            var meResp = await fetch(API_BASE + '/api/auth/me', { credentials: 'include' });
            if (!meResp.ok) {
                if (window.AuroraSession) {
                    var ok = await AuroraSession.refreshNow();
                    if (!ok) { window.location.href = '/auth/'; return; }
                } else {
                    window.location.href = '/auth/'; return;
                }
            }
            if (window.AuroraSession) AuroraSession.startPing();
        } catch (_) {
            window.location.href = '/auth/';
            return;
        }

        await loadHistory();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
