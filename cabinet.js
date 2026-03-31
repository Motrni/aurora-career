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
            window.location.href = '/auth/';
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
            window.location.href = '/auth/';
            return;
        }

        const data = await meResp.json();
        if (data.status !== 'ok') {
            window.location.href = '/auth/';
            return;
        }

        currentUser = data;

        if (window.AuroraSession) {
            window.AuroraSession.startPing();
        }

        const urlParams = new URLSearchParams(window.location.search);
        const paymentResult = urlParams.get('payment');
        const hasOnboarding = data.current_step && data.current_step.startsWith('onboarding_');

        if (paymentResult === 'success') {
            window.history.replaceState({}, '', window.location.pathname);

            if (data.subscription_status === 'active' || data.subscription_status === 'trial') {
                showPaymentSuccess(data.subscription_status, hasOnboarding);
                renderCabinet(data);
            } else {
                showPaymentPending(data);
            }
        } else if (paymentResult === 'fail') {
            window.history.replaceState({}, '', window.location.pathname);
            document.getElementById('paymentFailBanner').classList.remove('hidden');
            renderCabinet(data);
        } else if (hasOnboarding) {
            if (data.current_step === 'onboarding_settings' || data.current_step === 'onboarding_save_pending') {
                window.location.href = '/settings/';
            } else {
                window.location.href = '/onboarding/';
            }
            return;
        } else {
            renderCabinet(data);
        }

        loadSessions();

    } catch (e) {
        console.error('[Cabinet] Init error:', e);
        window.location.href = '/auth/';
    }
});

// ============================================================================
// RENDER
// ============================================================================

async function renderCabinet(user) {
    document.getElementById('userEmail').textContent = user.email || 'Без email';

    updateSubscriptionCard(user.subscription_status);
    updateNavAccess(user.subscription_status);
    updateTelegramCard(user.has_telegram);

    if (user.subscription_status === 'none' || user.subscription_status === 'ended_trial' || user.subscription_status === 'ended_active') {
        await loadTariffs();
    }

    document.getElementById('loadingSkeleton').classList.add('hidden');
    document.getElementById('mainContent').classList.remove('hidden');
}

function updateSubscriptionCard(status) {
    const icon = document.getElementById('subIcon');
    const title = document.getElementById('subTitle');
    const desc = document.getElementById('subDescription');
    const actions = document.getElementById('subActions');
    const hasOnboarding = currentUser && currentUser.current_step && currentUser.current_step.startsWith('onboarding_');

    switch (status) {
        case 'trial':
            icon.textContent = 'hourglass_top';
            title.textContent = 'Пробный период';
            if (hasOnboarding) {
                desc.textContent = 'У вас активен пробный период. Завершите первую настройку, чтобы начать поиск.';
                actions.innerHTML = '<a href="/onboarding/" class="btn-primary text-white font-medium py-2.5 px-6 rounded-xl text-sm inline-block cursor-pointer">Начать настройку</a>';
            } else {
                desc.textContent = 'У вас активен пробный период. Настройки поиска и автопилот откликов доступны.';
                actions.innerHTML = '<a href="/settings/" class="btn-primary text-white font-medium py-2.5 px-6 rounded-xl text-sm inline-block cursor-pointer">Перейти к настройкам</a>';
            }
            break;
        case 'active':
            icon.textContent = 'verified';
            title.textContent = 'Подписка активна';
            if (hasOnboarding) {
                desc.textContent = 'Подписка активна. Завершите первую настройку — привяжите hh.ru и выберите резюме.';
                actions.innerHTML = '<a href="/onboarding/" class="btn-primary text-white font-medium py-2.5 px-6 rounded-xl text-sm inline-block cursor-pointer">Начать настройку</a>';
            } else {
                desc.textContent = 'Все функции доступны. Настраивайте поиск и запускайте автопилот.';
                actions.innerHTML = '<a href="/settings/" class="btn-primary text-white font-medium py-2.5 px-6 rounded-xl text-sm inline-block cursor-pointer">Перейти к настройкам</a>';
            }
            break;
        case 'ended_trial':
            icon.textContent = 'timer_off';
            title.textContent = 'Пробный период закончился';
            desc.textContent = 'Выберите тариф ниже, чтобы продолжить пользоваться сервисом.';
            actions.innerHTML = '';
            break;
        case 'ended_active':
            icon.textContent = 'event_busy';
            title.textContent = 'Подписка истекла';
            desc.textContent = 'Продлите подписку, чтобы вернуть доступ к настройкам поиска и автопилоту.';
            actions.innerHTML = '';
            break;
        default:
            desc.textContent = 'Выберите тариф, чтобы получить доступ к автопилоту откликов и настройкам поиска.';
            break;
    }
}

function updateNavAccess(status) {
    const hasAccess = status === 'trial' || status === 'active';
    const navSettings = document.getElementById('navSettings');
    const navResponses = document.getElementById('navResponses');
    const settingsLock = document.getElementById('settingsLock');
    const responsesLock = document.getElementById('responsesLock');
    const hasOnboarding = currentUser && currentUser.current_step && currentUser.current_step.startsWith('onboarding_');

    if (hasOnboarding) {
        const navOb = document.getElementById('nav-onboarding');
        const navObMob = document.getElementById('nav-onboarding-mobile');
        if (navOb) navOb.classList.remove('hidden');
        if (navObMob) navObMob.classList.remove('hidden');
    }

    if (hasAccess && !hasOnboarding) {
        navSettings.classList.remove('nav-locked');
        navResponses.classList.remove('nav-locked');
        settingsLock.classList.add('hidden');
        responsesLock.classList.add('hidden');
        document.querySelectorAll('.nav-link-locked').forEach(el => el.classList.remove('nav-link-locked'));
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
    window.location.href = '/auth/';
}

async function loadTariffs() {
    const grid = document.getElementById('tariffGrid');
    const container = document.getElementById('paidTariffs');

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/tariffs`);
        if (!resp || !resp.ok) return;

        const data = await resp.json();
        const tariffs = data.tariffs || [];

        if (tariffs.length === 0) {
            container.innerHTML = '';
            grid.classList.remove('hidden');
            return;
        }

        const popularIdx = tariffs.length > 1 ? 1 : 0;

        container.innerHTML = tariffs.map((t, i) => {
            const pricePerDay = (t.price / t.duration_days).toFixed(0);
            const isPopular = i === popularIdx;
            const months = Math.round(t.duration_days / 30);
            const monthLabel = months === 1 ? 'мес' : (months < 5 ? 'мес' : 'мес');

            return `
            <div class="card rounded-2xl p-5 card-hover cursor-pointer ${isPopular ? 'tariff-popular' : ''}"
                 onclick="handlePurchase('${escapeHtml(t.plan_code)}')" data-plan="${escapeHtml(t.plan_code)}">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-surface-container-highest flex items-center justify-center flex-shrink-0">
                            <span class="material-symbols-outlined text-on-surface-variant">${months <= 1 ? 'bolt' : months <= 2 ? 'speed' : 'workspace_premium'}</span>
                        </div>
                        <div>
                            <span class="text-sm font-semibold text-on-surface">${escapeHtml(t.name)}</span>
                            <p class="text-on-surface-variant text-xs mt-0.5">${t.duration_days} дней &#8226; ${pricePerDay} ₽/день</p>
                        </div>
                    </div>
                    <div class="text-right flex-shrink-0 ml-3">
                        <div class="text-lg font-bold text-on-surface">${t.price.toLocaleString('ru-RU')} ₽</div>
                        <div class="price-per-day">${months} ${monthLabel}</div>
                    </div>
                </div>
            </div>`;
        }).join('');

        grid.classList.remove('hidden');

    } catch (e) {
        console.error('[Tariffs] Error:', e);
    }
}

async function handlePurchase(planCode) {
    const card = document.querySelector(`[data-plan="${planCode}"]`);
    if (card) {
        card.style.opacity = '0.6';
        card.style.pointerEvents = 'none';
    }

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/subscribe/purchase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan_code: planCode }),
        });

        if (!resp || !resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Purchase failed');
        }

        const data = await resp.json();
        if (data.payment_url) {
            window.location.href = data.payment_url;
        }

    } catch (e) {
        console.error('[Purchase] Error:', e);
        if (card) {
            card.style.opacity = '1';
            card.style.pointerEvents = 'auto';
        }
    }
}

async function handleActivateTrial() {
    const btn = document.getElementById('subscribeBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Загрузка...';
    }

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/init-trial`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!resp || !resp.ok) {
            const err = await resp.json().catch(() => ({}));
            if (resp.status === 409) {
                window.location.href = '/onboarding/';
                return;
            }
            throw new Error(err.detail || 'Init failed');
        }

        const data = await resp.json();
        const widget = new cp.CloudPayments();

        const widgetOpts = {
            publicId: data.public_id,
            description: 'Верификация карты (1 руб. вернётся)',
            amount: 1,
            currency: 'RUB',
            accountId: data.account_id,
            invoiceId: String(data.payment_id),
            skin: 'mini',
            data: {
                trial: true,
                source: 'web',
            },
        };

        if (data.email) {
            widgetOpts.email = data.email;
        }

        widget.pay('auth', widgetOpts, {
            onSuccess: function () {
                window.location.href = '/onboarding/';
            },
            onFail: function (reason) {
                console.error('[CP Widget] Fail:', reason);
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Активировать подписку';
                }
            },
            onComplete: function () {},
        });

    } catch (e) {
        console.error('[Trial] Error:', e);
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Активировать подписку';
        }
    }
}

function showPaymentSuccess(status, hasOnboarding) {
    const banner = document.getElementById('paymentSuccessBanner');
    const desc = document.getElementById('paymentSuccessDesc');
    const link = document.getElementById('paymentSuccessLink');
    banner.classList.remove('hidden');

    if (hasOnboarding) {
        desc.textContent = 'Подписка активирована. Осталось привязать аккаунт hh.ru и выбрать резюме.';
        if (link) {
            link.href = '/onboarding/';
            link.innerHTML = '<span class="material-symbols-outlined text-lg">arrow_forward</span> Начать настройку';
        }
    } else if (status === 'trial') {
        desc.textContent = 'Пробный период активирован. Настройте поиск и начните получать отклики.';
    } else {
        desc.textContent = 'Подписка активирована. Все функции доступны.';
    }

    document.getElementById('loadingSkeleton').classList.add('hidden');
    document.getElementById('mainContent').classList.remove('hidden');
}

async function showPaymentPending(initialData) {
    const banner = document.getElementById('paymentSuccessBanner');
    const desc = document.getElementById('paymentSuccessDesc');
    banner.classList.remove('hidden');
    desc.textContent = 'Платёж обрабатывается, подождите...';

    document.getElementById('loadingSkeleton').classList.add('hidden');
    document.getElementById('mainContent').classList.remove('hidden');
    renderCabinet(initialData);

    let attempts = 0;
    const maxAttempts = 20;

    const poll = setInterval(async () => {
        attempts++;
        try {
            const resp = await apiFetch(`${API_BASE_URL}/api/auth/me`);
            if (!resp || !resp.ok) return;
            const data = await resp.json();

            if (data.subscription_status === 'active' || data.subscription_status === 'trial') {
                clearInterval(poll);
                currentUser = data;
                const hasOb = data.current_step && data.current_step.startsWith('onboarding_');
                showPaymentSuccess(data.subscription_status, hasOb);
                renderCabinet(data);
            }
        } catch (_) {}

        if (attempts >= maxAttempts) {
            clearInterval(poll);
            desc.textContent = 'Оплата принята. Подписка активируется в течение минуты — обновите страницу.';
        }
    }, 3000);
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
// MOBILE MENU
// ============================================================================

function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    const btn = document.getElementById('burger-btn');
    menu.classList.toggle('open');
    btn.classList.toggle('active');
}

// ============================================================================
// UTILS
// ============================================================================

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
