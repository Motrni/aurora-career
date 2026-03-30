/**
 * cabinet.js — Логика личного кабинета Aurora Career.
 * Доступен всем авторизованным пользователям, включая subscription_status='none'.
 */

const API_BASE_URL = window.AuroraSession
    ? window.AuroraSession.getApiBase()
    : ((window.location.hostname.includes('twc1.net') || window.location.hostname.includes('aurora-develop'))
        ? 'https://api.aurora-develop.ru'
        : 'https://api.aurora-career.ru');

let currentUser = null;

// ============================================================================
// API HELPER
// ============================================================================

async function apiFetch(url, options = {}) {
    options.credentials = 'include';
    let resp = await fetch(url, options);

    if (resp.status === 401) {
        const refreshResp = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
            method: 'POST', credentials: 'include',
        });
        if (refreshResp.ok) {
            resp = await fetch(url, options);
        } else {
            window.location.href = 'auth.html';
            return null;
        }
    }
    return resp;
}

// ============================================================================
// INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        let meResp = await fetch(`${API_BASE_URL}/api/auth/me`, {
            method: 'GET', credentials: 'include',
        });

        if (meResp.status === 401) {
            const refreshResp = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
                method: 'POST', credentials: 'include',
            });
            if (refreshResp.ok) {
                meResp = await fetch(`${API_BASE_URL}/api/auth/me`, {
                    method: 'GET', credentials: 'include',
                });
            }
        }

        if (!meResp.ok) {
            window.location.href = 'auth.html';
            return;
        }

        const data = await meResp.json();
        if (data.status !== 'ok') {
            window.location.href = 'auth.html';
            return;
        }

        currentUser = data;

        if (data.subscription_status && data.subscription_status !== 'none') {
            window.location.href = 'settings.html';
            return;
        }

        if (window.AuroraSession) {
            window.AuroraSession.startPing();
        }

        renderCabinet(data);
        loadSessions();

    } catch (e) {
        console.error('[Cabinet] Init error:', e);
        window.location.href = 'auth.html';
    }
});

// ============================================================================
// RENDER
// ============================================================================

function renderCabinet(user) {
    document.getElementById('userEmail').textContent = user.email || 'Без email';

    updateSubscriptionCard(user.subscription_status);
    updateNavAccess(user.subscription_status);
    updateTelegramCard(user.has_telegram);

    document.getElementById('loadingSkeleton').classList.add('hidden');
    document.getElementById('mainContent').classList.remove('hidden');
}

function updateSubscriptionCard(status) {
    const icon = document.getElementById('subIcon');
    const title = document.getElementById('subTitle');
    const desc = document.getElementById('subDescription');
    const actions = document.getElementById('subActions');

    switch (status) {
        case 'trial':
            icon.textContent = 'hourglass_top';
            title.textContent = 'Пробный период';
            desc.textContent = 'У вас активен пробный период. Настройки поиска и автопилот откликов доступны.';
            actions.innerHTML = '<a href="settings.html" class="btn-primary text-white font-medium py-2.5 px-6 rounded-xl text-sm inline-block cursor-pointer">Перейти к настройкам</a>';
            break;
        case 'active':
            icon.textContent = 'verified';
            title.textContent = 'Подписка активна';
            desc.textContent = 'Все функции доступны. Настраивайте поиск и запускайте автопилот.';
            actions.innerHTML = '<a href="settings.html" class="btn-primary text-white font-medium py-2.5 px-6 rounded-xl text-sm inline-block cursor-pointer">Перейти к настройкам</a>';
            break;
        case 'expired':
            icon.textContent = 'event_busy';
            title.textContent = 'Подписка истекла';
            desc.textContent = 'Продлите подписку, чтобы вернуть доступ к настройкам поиска и автопилоту.';
            actions.innerHTML = '<button class="btn-primary text-white font-medium py-2.5 px-6 rounded-xl text-sm cursor-pointer" id="subscribeBtn">Продлить подписку</button>';
            break;
        default:
            break;
    }
}

function updateNavAccess(status) {
    const hasAccess = status === 'trial' || status === 'active';
    const navSettings = document.getElementById('navSettings');
    const navResponses = document.getElementById('navResponses');
    const settingsLock = document.getElementById('settingsLock');
    const responsesLock = document.getElementById('responsesLock');

    if (hasAccess) {
        navSettings.classList.remove('nav-locked');
        navResponses.classList.remove('nav-locked');
        settingsLock.classList.add('hidden');
        responsesLock.classList.add('hidden');
    }
}

function updateTelegramCard(hasTelegram) {
    if (hasTelegram) {
        document.getElementById('telegramLinkedCard').classList.remove('hidden');
    } else {
        document.getElementById('telegramCard').classList.remove('hidden');
    }
}

// ============================================================================
// SESSIONS
// ============================================================================

async function loadSessions() {
    const container = document.getElementById('sessionsList');

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/auth/sessions`);
        if (!resp || !resp.ok) {
            container.innerHTML = '<p class="text-outline text-xs">Не удалось загрузить сессии</p>';
            return;
        }

        const data = await resp.json();
        const sessions = data.sessions || [];

        if (sessions.length === 0) {
            container.innerHTML = '<p class="text-outline text-xs">Нет активных сессий</p>';
            return;
        }

        container.innerHTML = sessions.map(s => {
            const deviceIcon = getDeviceIcon(s.device_name);
            const lastUsed = s.last_used_at ? formatRelativeTime(s.last_used_at) : '';
            const currentBadge = s.is_current
                ? '<span class="text-primary text-xs font-medium ml-2">текущая</span>'
                : '';
            const revokeBtn = s.is_current
                ? ''
                : `<button onclick="revokeSession(${s.id})" class="text-error text-xs hover:underline cursor-pointer flex-shrink-0">Завершить</button>`;

            return `<div class="session-item flex items-center gap-3 rounded-lg px-3 py-2.5" data-session-id="${s.id}">
                <span class="material-symbols-outlined text-on-surface-variant text-lg flex-shrink-0">${deviceIcon}</span>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center">
                        <span class="text-on-surface text-xs font-medium truncate">${escapeHtml(s.device_name)}</span>
                        ${currentBadge}
                    </div>
                    <span class="text-outline text-xs">${lastUsed}</span>
                </div>
                ${revokeBtn}
            </div>`;
        }).join('');

    } catch (e) {
        container.innerHTML = '<p class="text-outline text-xs">Ошибка загрузки сессий</p>';
    }
}

function getDeviceIcon(name) {
    if (!name) return 'devices';
    const n = name.toLowerCase();
    if (n.includes('iphone') || n.includes('android') || n.includes('mobile')) return 'smartphone';
    if (n.includes('ipad') || n.includes('tablet')) return 'tablet';
    return 'computer';
}

function formatRelativeTime(isoStr) {
    try {
        const d = new Date(isoStr);
        const now = new Date();
        const diffMs = now - d;
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return 'только что';
        if (diffMin < 60) return `${diffMin} мин. назад`;
        const diffH = Math.floor(diffMin / 60);
        if (diffH < 24) return `${diffH} ч. назад`;
        const diffD = Math.floor(diffH / 24);
        return `${diffD} дн. назад`;
    } catch (_) {
        return '';
    }
}

async function revokeSession(sessionId) {
    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/auth/sessions/${sessionId}`, {
            method: 'DELETE',
        });
        if (resp && resp.ok) {
            const el = document.querySelector(`[data-session-id="${sessionId}"]`);
            if (el) {
                el.style.transition = 'opacity 0.3s, transform 0.3s';
                el.style.opacity = '0';
                el.style.transform = 'translateX(20px)';
                setTimeout(() => el.remove(), 300);
            }
        }
    } catch (_) {}
}

async function handleRevokeAll() {
    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/auth/sessions`, {
            method: 'DELETE',
        });
        if (resp && resp.ok) {
            await loadSessions();
        }
    } catch (_) {}
}

// ============================================================================
// ACTIONS
// ============================================================================

async function handleLogout() {
    try {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
            method: 'POST', credentials: 'include',
        });
    } catch (_) {}
    window.location.href = 'auth.html';
}

async function handleLinkTelegram() {
    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/auth/link-telegram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!resp || !resp.ok) return;

        const data = await resp.json();
        if (data.deep_link) {
            window.open(data.deep_link, '_blank');
        }
    } catch (_) {}
}

// ============================================================================
// UTILS
// ============================================================================

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
