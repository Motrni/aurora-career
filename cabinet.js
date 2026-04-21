/**
 * cabinet.js v3.9.3 — Логика личного кабинета Aurora Career.
 * Доступен всем авторизованным пользователям, включая subscription_status='none'.
 *
 * v3.8:   3-уровневая защита от блокировки popup при оплате (см. handlePurchase).
 * v3.9:   страница-прокладка /cabinet/payment-loading/ + postMessage/localStorage канал.
 * v3.9.1: трекинг tariff_modal_opened для воронки "интерес → оплата".
 * v3.9.2: тарифы видны и триальщикам — можно купить, не дожидаясь окончания триала
 *         (activate_paid_subscription корректно перезатирает trial → active).
 * v3.9.3: видимость #promoCard управляется флагом data.can_apply_promo (с бэка):
 *         - active: скрыто (скидка сгорит за 2 дня при подписке на 30+);
 *         - использован менторский промо: показано (плашка "применён");
 *         - есть post-purchase lock (истёкшая ref/mentor): скрыто;
 *         - none/trial/ended_trial/ended_active без lock: показано.
 */

const API_BASE_URL = window.AuroraSession
    ? window.AuroraSession.getApiBase()
    : ((window.location.hostname.includes('twc1.net') || window.location.hostname.includes('aurora-develop'))
        ? 'https://api.aurora-develop.ru'
        : 'https://api.aurora-career.ru');

let currentUser = null;
let _loadedTariffs = [];
let _paymentRedirectPollTimer = null;
let _paymentFallbackTimer = null;
let _lastPaymentContext = null;

// ============================================================================
// PAYMENT FUNNEL ANALYTICS — fire-and-forget трекинг точек отвала
// ============================================================================

function _trackPaymentEvent(eventType, paymentId, extra) {
    try {
        const body = JSON.stringify({
            event_type: eventType,
            payment_id: paymentId || null,
            extra: extra || undefined,
        });
        fetch(`${API_BASE_URL}/api/analytics/payment-event`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
        }).catch(() => {});
    } catch (_) {}
}

function _isWindowAlive(handle) {
    if (!handle) return false;
    try {
        return !handle.closed;
    } catch (_) {
        return true;
    }
}

// ============================================================================
// API HELPER
// ============================================================================

async function apiFetch(url, options = {}) {
    options.credentials = 'include';
    let resp = await fetch(url, options);

    if (resp.status === 403) {
        const subStatus = resp.headers.get('X-Sub-Status');
        if (subStatus) {
            window.location.href = '/cabinet/';
            return null;
        }
    }

    if (resp.status === 409) {
        const body = await resp.clone().json().catch(() => ({}));
        if (body.detail && body.detail.includes('re-authentication')) {
            window.location.href = '/reauth/';
            return null;
        }
    }

    if (resp.status === 401 && window.AuroraSession) {
        const ok = await AuroraSession.refreshNow();
        if (ok) {
            resp = await fetch(url, options);
        } else {
            window.location.href = '/auth/';
            return null;
        }
    }
    return resp;
}

/**
 * Блокировка прокрутки фона под модалкой.
 * Не трогаем padding-right: при `scrollbar-gutter: stable` на `html` дополнительный отступ дублирует резерв и смещает вёрстку.
 */
let _bodyScrollLockDepth = 0;

function lockBodyScroll() {
    _bodyScrollLockDepth += 1;
    if (_bodyScrollLockDepth !== 1) return;
    document.body.classList.add('overflow-hidden');
}

function unlockBodyScroll() {
    _bodyScrollLockDepth = Math.max(0, _bodyScrollLockDepth - 1);
    if (_bodyScrollLockDepth !== 0) return;
    document.body.classList.remove('overflow-hidden');
}

// ============================================================================
// INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        let meResp = await fetch(`${API_BASE_URL}/api/auth/me`, {
            method: 'GET', credentials: 'include',
        });

        if (meResp.status === 401 && window.AuroraSession) {
            const ok = await AuroraSession.refreshNow();
            if (ok) {
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

        if (data.need_reauth) {
            window.location.href = '/reauth/';
            return;
        }

        currentUser = data;

        if (window.AuroraSession) {
            window.AuroraSession.startPing();
        }

        if (typeof checkRegModal === 'function') {
            checkRegModal(data);
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
        loadPromoStatus();
        loadReferralCodes();
        initCabinetBoostModal();
        initTariffModal();

        if (window.DiscountBanner && data.discount) {
            window.DiscountBanner.init(data.discount, { onCabinet: true });
        }

    } catch (e) {
        console.error('[Cabinet] Init error:', e);
        window.location.href = '/auth/';
    }
});

// ============================================================================
// RENDER
// ============================================================================

async function renderCabinet(user) {
    // Greeting
    const greetEl = document.getElementById('greetingTitle');
    if (user.first_name) {
        greetEl.textContent = `Привет, ${user.first_name}!`;
    } else {
        greetEl.textContent = 'Привет!';
    }

    document.getElementById('userEmail').textContent = user.email || 'Без email';

    updateSubscriptionCard(user);
    updateTelegramCard(user.has_telegram);
    applyTrialCardVisibility(user);

    if (user.has_access && !user.hh_linked) {
        document.getElementById('hhLinkBanner').classList.remove('hidden');
        const mob = document.getElementById('hhLinkBannerMobile');
        if (mob) mob.classList.remove('hidden');
    }

    const showTariffs =
        user.subscription_status === 'none' ||
        user.subscription_status === 'trial' ||
        user.subscription_status === 'ended_trial' ||
        user.subscription_status === 'ended_active';
    const featuresBlock = document.getElementById('tariffFeatures');
    if (showTariffs) {
        await loadTariffs();
        if (featuresBlock) featuresBlock.classList.remove('hidden');
    } else {
        if (featuresBlock) featuresBlock.classList.add('hidden');
    }

    const hasAccess = user.subscription_status === 'trial' || user.subscription_status === 'active';
    let activeResumeHasProfile = true;
    if (hasAccess) {
        loadDailyStats();
        activeResumeHasProfile = await loadResumeSelector();
    }

    // updateNavAccess вызывается ПОСЛЕ loadResumeSelector, уже зная статус профиля
    updateNavAccess(user.subscription_status, activeResumeHasProfile);

    document.getElementById('loadingSkeleton').style.display = 'none';
    document.getElementById('mainContent').style.display = '';

    if (window.location.hash === '#tariffGrid') {
        requestAnimationFrame(function () {
            var grid = document.getElementById('tariffGrid');
            if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }
}

// ============================================================================
// RESUME SELECTOR
// ============================================================================

let _resumeDropdownOpen = false;
let _resumesList = [];

async function loadResumeSelector() {
    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/resumes/list`);
        if (!resp || !resp.ok) return true;
        const data = await resp.json();
        _resumesList = data.resumes || [];
        if (_resumesList.length === 0) return true;

        const card = document.getElementById('resumeSelectCard');
        card.classList.remove('hidden');

        const active = _resumesList.find(r => r.is_active) || _resumesList[0];
        updateResumeDropdownUI(active);

        return active.has_custom_query !== false;
    } catch (e) {
        console.error('[Cabinet] loadResumeSelector error:', e);
        return true;
    }
}

function updateResumeDropdownUI(activeResume) {
    const label = document.getElementById('resumeDropdownLabel');
    const arrow = document.getElementById('resumeDropdownArrow');
    const list = document.getElementById('resumeDropdownList');
    const warning = document.getElementById('resumeWarning');

    label.textContent = activeResume.resume_title;

    if (_resumesList.length <= 1) {
        arrow.style.display = 'none';
        document.getElementById('resumeDropdownBtn').style.cursor = 'default';
    } else {
        arrow.style.display = '';
        document.getElementById('resumeDropdownBtn').style.cursor = 'pointer';
    }

    list.innerHTML = '';
    for (const r of _resumesList) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'w-full text-left px-4 py-2.5 text-sm transition-colors cursor-pointer hover:bg-surface-container-low flex items-center gap-2'
            + (r.resume_id === activeResume.resume_id ? ' text-primary font-medium' : ' text-on-surface');
        item.textContent = r.resume_title;
        if (r.resume_id === activeResume.resume_id) {
            const check = document.createElement('span');
            check.className = 'material-symbols-outlined text-primary text-lg ml-auto flex-shrink-0';
            check.textContent = 'check';
            item.appendChild(check);
        }
        item.addEventListener('click', () => handleSwitchResume(r.resume_id));
        list.appendChild(item);
    }

    if (activeResume.has_custom_query) {
        warning.classList.add('hidden');
    } else {
        warning.classList.remove('hidden');
    }
}

function setProfileLock(locked) {
    const navSettings = document.getElementById('navSettings');
    const navResponses = document.getElementById('navResponses');
    const navSettingsLink = document.getElementById('nav-settings');
    const navResponsesLink = document.getElementById('nav-responses');
    const navSettingsMob = document.getElementById('nav-settings-mobile');
    const navResponsesMob = document.getElementById('nav-responses-mobile');

    if (locked) {
        if (navSettings) navSettings.classList.add('profile-locked');
        if (navResponses) navResponses.classList.add('profile-locked');
        if (navSettingsLink) navSettingsLink.classList.add('profile-link-locked');
        if (navResponsesLink) navResponsesLink.classList.add('profile-link-locked');
        if (navSettingsMob) navSettingsMob.classList.add('profile-link-locked');
        if (navResponsesMob) navResponsesMob.classList.add('profile-link-locked');
    } else {
        if (navSettings) navSettings.classList.remove('profile-locked');
        if (navResponses) navResponses.classList.remove('profile-locked');
        if (navSettingsLink) navSettingsLink.classList.remove('profile-link-locked');
        if (navResponsesLink) navResponsesLink.classList.remove('profile-link-locked');
        if (navSettingsMob) navSettingsMob.classList.remove('profile-link-locked');
        if (navResponsesMob) navResponsesMob.classList.remove('profile-link-locked');
    }
}

function toggleResumeDropdown() {
    if (_resumesList.length <= 1) return;
    const list = document.getElementById('resumeDropdownList');
    const arrow = document.getElementById('resumeDropdownArrow');
    const btn = document.getElementById('resumeDropdownBtn');
    _resumeDropdownOpen = !_resumeDropdownOpen;
    if (_resumeDropdownOpen) {
        list.classList.remove('hidden');
        arrow.style.transform = 'rotate(180deg)';
        btn.style.borderRadius = '10px 10px 0 0';
    } else {
        list.classList.add('hidden');
        arrow.style.transform = '';
        btn.style.borderRadius = '10px';
    }
}

document.addEventListener('click', (e) => {
    if (!_resumeDropdownOpen) return;
    const wrap = document.getElementById('resumeDropdownWrap');
    if (wrap && !wrap.contains(e.target)) {
        _resumeDropdownOpen = false;
        document.getElementById('resumeDropdownList').classList.add('hidden');
        document.getElementById('resumeDropdownArrow').style.transform = '';
        document.getElementById('resumeDropdownBtn').style.borderRadius = '10px';
    }
});

async function handleSwitchResume(resumeId) {
    _resumeDropdownOpen = false;
    document.getElementById('resumeDropdownList').classList.add('hidden');
    document.getElementById('resumeDropdownArrow').style.transform = '';
    document.getElementById('resumeDropdownBtn').style.borderRadius = '10px';

    const current = _resumesList.find(r => r.is_active);
    if (current && current.resume_id === resumeId) return;

    const label = document.getElementById('resumeDropdownLabel');
    label.textContent = 'Переключение...';

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/cabinet/switch-resume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resume_id: resumeId }),
        });
        if (!resp || !resp.ok) {
            label.textContent = current ? current.resume_title : 'Ошибка';
            return;
        }
        const data = await resp.json();

        for (const r of _resumesList) {
            r.is_active = r.resume_id === resumeId;
        }
        const newActive = _resumesList.find(r => r.resume_id === resumeId);
        if (newActive) {
            newActive.has_custom_query = data.has_custom_query;
            updateResumeDropdownUI(newActive);
            setProfileLock(!data.has_custom_query);
        }
    } catch (e) {
        console.error('[Cabinet] switchResume error:', e);
        label.textContent = current ? current.resume_title : 'Ошибка';
    }
}

// ============================================================================
// SUBSCRIPTION CARD
// ============================================================================

function resetSubscriptionCardState() {
    const outer = document.getElementById('subscriptionCardOuter');
    const card = document.getElementById('subscriptionCard');
    const icon = document.getElementById('subIcon');
    const badge = document.getElementById('subBadge');

    outer.className = 'rounded-2xl overflow-hidden w-full min-w-0 max-w-full';
    card.className = 'glass-panel p-6 md:p-8 rounded-2xl border border-outline-variant/5 relative overflow-hidden';
    icon.style.fontVariationSettings = '';

    badge.classList.add('hidden');
    badge.textContent = '';

    document.getElementById('subDetails').classList.add('hidden');
    document.getElementById('subDetailBilling').classList.add('hidden');
    document.getElementById('subDetailAmount').classList.add('hidden');
    document.getElementById('subDetailCard').classList.add('hidden');
    document.getElementById('subActions').innerHTML = '';
    document.getElementById('subBillingValue').textContent = '—';
    document.getElementById('subAmountValue').textContent = '—';
}

function nextBillingDisplayText(sub) {
    const ar = !!sub.auto_renew_active;
    const cp = sub.cp_status || '';
    const nxt = sub.next_payment_date;
    if (ar) {
        if (nxt) return formatDate(nxt);
        return 'Дата следующего списания уточняется у платёжной системы.';
    }
    if (cp === 'Cancelled') {
        return 'Автопродление отключено — новых списаний не будет. Доступ сохраняется до конца оплаченного периода.';
    }
    if (cp === 'PastDue' || cp === 'Rejected') {
        return 'Проблема с оплатой — автосписание приостановлено. Обновите карту или напишите в поддержку.';
    }
    return 'Рекуррентные списания не подключены — списаний по расписанию не будет.';
}

function applySubscriptionBillingRows(sub) {
    const details = document.getElementById('subDetails');
    details.classList.remove('hidden');

    document.getElementById('subDetailExpires').classList.remove('hidden');
    if (sub.expires_at) {
        let t = formatDate(sub.expires_at);
        const dLeft = daysUntil(sub.expires_at);
        if (dLeft !== null && dLeft >= 0) t = `${t} (${dLeft} дн.)`;
        document.getElementById('subExpiresValue').textContent = t;
    } else {
        document.getElementById('subExpiresValue').textContent = '—';
    }

    document.getElementById('subDetailBilling').classList.remove('hidden');
    document.getElementById('subBillingValue').textContent = nextBillingDisplayText(sub);

    const amtRow = document.getElementById('subDetailAmount');
    if (sub.auto_renew_active && sub.recurring_amount != null && !Number.isNaN(Number(sub.recurring_amount))) {
        amtRow.classList.remove('hidden');
        const n = Number(sub.recurring_amount);
        document.getElementById('subAmountValue').textContent = `${Math.round(n).toLocaleString('ru-RU')} ₽`;
    } else {
        amtRow.classList.add('hidden');
    }

    const cardRow = document.getElementById('subDetailCard');
    if (sub.card_last_four) {
        cardRow.classList.remove('hidden');
        const cardType = sub.card_type || '';
        document.getElementById('subCardValue').textContent = `${cardType} •••• ${sub.card_last_four}`.trim();
    } else {
        cardRow.classList.add('hidden');
    }
}

function setSubscriptionActionButtons(sub, status) {
    const hasOnboarding = currentUser && currentUser.current_step && currentUser.current_step.startsWith('onboarding_');
    const parts = [];
    if (hasOnboarding && (status === 'active' || status === 'trial')) {
        parts.push('<a href="/onboarding/" class="btn-primary text-white font-medium py-2.5 px-6 rounded-xl text-sm inline-block cursor-pointer">Начать настройку</a>');
    }
    if (sub.auto_renew_active) {
        parts.push('<button type="button" onclick="openCancelSubscriptionModal()" class="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-error/35 text-error font-semibold text-sm hover:bg-error/10 transition-colors cursor-pointer">Отменить подписку</button>');
    }
    const el = document.getElementById('subActions');
    if (parts.length === 0) {
        el.innerHTML = '';
        return;
    }
    el.innerHTML = `<div class="flex flex-col gap-3">${parts.join('')}</div>`;
}

function updateSubscriptionCard(user) {
    const status = user.subscription_status;
    const sub = user.subscription || {};
    const icon = document.getElementById('subIcon');
    const iconWrap = document.getElementById('subIconWrap');
    const title = document.getElementById('subTitle');
    const desc = document.getElementById('subDescription');
    const badge = document.getElementById('subBadge');
    const card = document.getElementById('subscriptionCard');
    const outer = document.getElementById('subscriptionCardOuter');
    const hasOnboarding = currentUser && currentUser.current_step && currentUser.current_step.startsWith('onboarding_');

    resetSubscriptionCardState();

    switch (status) {
        case 'trial': {
            icon.textContent = 'hourglass_top';
            iconWrap.style.background = 'rgba(101,62,219,0.18)';
            title.textContent = 'Пробный период';
            badge.textContent = 'Trial';
            badge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#653edb]/20 text-primary';
            badge.classList.remove('hidden');

            if (hasOnboarding) {
                desc.textContent = 'Завершите первую настройку, чтобы начать поиск.';
            } else {
                desc.textContent = 'Пробный период: доступны поиск и автопилот. Ниже — даты и списания; настройки — в карточках справа.';
            }

            applySubscriptionBillingRows(sub);
            setSubscriptionActionButtons(sub, 'trial');
            break;
        }
        case 'active': {
            outer.classList.add('subscription-active-glow');
            icon.textContent = 'subscriptions';
            icon.style.fontVariationSettings = "'FILL' 0, 'wght' 400";
            iconWrap.style.background = 'rgba(74,222,128,0.12)';
            title.textContent = 'Подписка активна';
            badge.textContent = 'Active';
            badge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#4ade80]/15 text-[#4ade80]';
            badge.classList.remove('hidden');

            if (hasOnboarding) {
                desc.textContent = 'Завершите первую настройку — привяжите hh.ru и выберите резюме.';
            } else {
                desc.textContent = 'Все функции доступны. Управление поиском и откликами — в блоках справа.';
            }

            applySubscriptionBillingRows(sub);
            setSubscriptionActionButtons(sub, 'active');
            break;
        }
        case 'ended_trial': {
            card.className = 'cab-card p-6 md:p-8 rounded-2xl relative overflow-hidden';
            icon.textContent = 'timer_off';
            title.textContent = 'Пробный период закончился';
            desc.textContent = 'Выберите тариф ниже, чтобы продолжить пользоваться сервисом.';
            break;
        }
        case 'ended_active': {
            card.className = 'cab-card p-6 md:p-8 rounded-2xl relative overflow-hidden';
            icon.textContent = 'event_busy';
            title.textContent = 'Подписка истекла';
            desc.textContent = 'Продлите подписку, чтобы вернуть доступ к настройкам поиска и автопилоту.';
            break;
        }
        default: {
            card.className = 'cab-card p-6 md:p-8 rounded-2xl relative overflow-hidden';
            icon.textContent = 'credit_card_off';
            iconWrap.style.background = 'rgba(101,62,219,0.15)';
            title.textContent = 'Подписка не активна';
            desc.textContent = 'Выберите тариф, чтобы получить доступ к автопилоту откликов и настройкам поиска.';
            break;
        }
    }
}

function openCancelSubscriptionModal() {
    const m = document.getElementById('cancelSubModal');
    m.classList.remove('hidden');
    m.setAttribute('aria-hidden', 'false');
    lockBodyScroll();
}

function closeCancelSubscriptionModal() {
    const m = document.getElementById('cancelSubModal');
    m.classList.add('hidden');
    m.setAttribute('aria-hidden', 'true');
    unlockBodyScroll();
}

async function confirmCancelSubscription() {
    const btn = document.getElementById('cancelSubConfirmBtn');
    if (btn) {
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
    }
    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/subscription/cancel`, { method: 'POST' });
        if (!resp || !resp.ok) {
            const err = await resp.json().catch(() => ({}));
            alert(err.detail || 'Не удалось отключить автопродление. Попробуйте позже.');
            return;
        }
        closeCancelSubscriptionModal();
        await refreshCabinetUser();
    } catch (e) {
        console.error('[CancelSub]', e);
        alert('Ошибка сети. Попробуйте позже.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    }
}

async function refreshCabinetUser() {
    const resp = await apiFetch(`${API_BASE_URL}/api/auth/me`);
    if (!resp || !resp.ok) return;
    const data = await resp.json();
    if (data.status !== 'ok') return;
    currentUser = data;
    await renderCabinet(data);
    loadSessions();
}

// ============================================================================
// DAILY STATS
// ============================================================================

/**
 * Верх оси Y: «красивое» округление вверх по шагу 1–2–5 × 10ⁿ.
 */
function computeAxisMax(dataMax, segments = 4) {
    if (dataMax <= 0) return 5;
    const roughStep = dataMax / segments;
    const pow10 = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const f = roughStep / pow10;
    const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    const step = nf * pow10;
    return Math.ceil(dataMax / step) * step;
}

/** Ровно 5 отметок сверху вниз (макс → 0), как на референсе. */
function buildLinearTicks(axisMax, count = 5) {
    const raw = [];
    for (let i = 0; i < count; i++) {
        raw.push(Math.round((axisMax * (count - 1 - i)) / (count - 1)));
    }
    raw[count - 1] = 0;
    return [...new Set(raw)].sort((a, b) => b - a);
}

function computeAxisScale(dataMax) {
    const axisMax = computeAxisMax(dataMax);
    const ticks = buildLinearTicks(axisMax, 5);
    return { axisMax, ticks };
}

function formatChartDayMonth(isoDate) {
    const parts = isoDate.split('-');
    if (parts.length !== 3) return isoDate;
    const [y, m, day] = parts;
    return `${day.padStart(2, '0')}.${m.padStart(2, '0')}`;
}

function weekdayLongRu(isoDate) {
    const dt = new Date(`${isoDate}T12:00:00`);
    const s = dt.toLocaleDateString('ru-RU', { weekday: 'long' });
    if (!s) return '';
    return s.charAt(0).toLocaleUpperCase('ru-RU') + s.slice(1);
}

function weekdayShortRu(isoDate) {
    const dt = new Date(`${isoDate}T12:00:00`);
    const s = dt.toLocaleDateString('ru-RU', { weekday: 'short' });
    if (!s) return '';
    return s.charAt(0).toLocaleUpperCase('ru-RU') + s.slice(1);
}

async function loadDailyStats() {
    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/cabinet/daily-stats`);
        if (!resp || !resp.ok) return;

        const data = await resp.json();
        if (data.status !== 'ok' || !data.days) return;

        renderDailyChart(data.days);
    } catch (e) {
        console.error('[DailyStats] Error:', e);
    }
}

function renderDailyStatsFooter() {
    const u = currentUser;
    const gaEl = document.getElementById('statGlobalApps');
    const dlEl = document.getElementById('statDailyLimit');
    const cta = document.getElementById('cabinetBoostCta');
    if (!gaEl || !dlEl || !cta) return;

    if (!u) {
        gaEl.textContent = '—';
        dlEl.textContent = '—';
        cta.classList.add('hidden');
        return;
    }

    const ga = u.global_applications != null ? Number(u.global_applications) : 0;
    const dl = u.daily_limit != null ? Number(u.daily_limit) : 20;
    gaEl.textContent = Number.isFinite(ga) ? String(ga) : '0';
    dlEl.textContent = Number.isFinite(dl) ? String(dl) : '20';

    const isTrial = u.subscription_status === 'trial';
    if (isTrial || !Object.prototype.hasOwnProperty.call(u, 'has_active_boost')) {
        cta.classList.add('hidden');
    } else {
        cta.classList.toggle('hidden', u.has_active_boost === true);
    }
}

function renderDailyChart(days) {
    const card = document.getElementById('dailyStatsCard');
    const chart = document.getElementById('statsChart');
    const labels = document.getElementById('statsLabels');
    const yAxis = document.getElementById('statsYAxis');

    const dataMax = Math.max(...days.map(d => d.count), 0);
    const { axisMax, ticks } = computeAxisScale(dataMax);

    if (yAxis) {
        yAxis.innerHTML = ticks.map((t) => `<span class="block leading-none">${t}</span>`).join('');
    }

    chart.innerHTML = days.map((d) => {
        const hPct = axisMax > 0 ? (d.count / axisMax) * 100 : 0;
        return `<div class="stats-bar-slot" style="position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;flex:1;min-width:0;">
            <div class="bar-tooltip">${d.count}</div>
            <div class="stats-bar-track" style="position:relative;overflow:hidden;flex-shrink:0;width:100%;max-width:1.75rem;">
                <div class="stats-bar-fill" style="position:absolute;bottom:0;left:0;right:0;width:100%;height:${hPct}%;"></div>
            </div>
        </div>`;
    }).join('');

    labels.innerHTML = days.map((d) => {
        const dateLine = formatChartDayMonth(d.date);
        const wd = weekdayShortRu(d.date);
        return `<div style="flex:1;min-width:0;text-align:center;overflow:hidden;">
            <div class="stats-label-date" style="font-weight:600;color:#e7e0ef;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${dateLine}</div>
            <div class="stats-label-weekday" style="color:#cac3d7;line-height:1.3;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${wd}</div>
        </div>`;
    }).join('');

    renderDailyStatsFooter();
    card.classList.remove('hidden');
}

// ============================================================================
// BOOST MODAL (как на /responses/)
// ============================================================================

function openCabinetBoostModal() {
    const modal = document.getElementById('cabinetBoostModal');
    const card = document.getElementById('cabinetBoostModalCard');
    if (!modal) return;

    cabinetBoostShowStep1();

    modal.classList.remove('pointer-events-none');
    modal.setAttribute('aria-hidden', 'false');
    lockBodyScroll();

    requestAnimationFrame(() => {
        modal.classList.add('opacity-100');
        modal.classList.remove('opacity-0');
        card.classList.add('scale-100', 'opacity-100');
        card.classList.remove('scale-95', 'opacity-0');
    });
}

function closeCabinetBoostModal() {
    const modal = document.getElementById('cabinetBoostModal');
    const card = document.getElementById('cabinetBoostModalCard');
    if (!modal) return;

    modal.classList.remove('opacity-100');
    modal.classList.add('opacity-0');
    card.classList.remove('scale-100', 'opacity-100');
    card.classList.add('scale-95', 'opacity-0');

    const onDone = () => {
        modal.classList.add('pointer-events-none');
        modal.setAttribute('aria-hidden', 'true');
        unlockBodyScroll();
        modal.removeEventListener('transitionend', onDone);
    };
    modal.addEventListener('transitionend', onDone, { once: true });
}

function cabinetBoostShowStep1() {
    const s1 = document.getElementById('cabinetBoostStep1');
    const s2 = document.getElementById('cabinetBoostStep2');
    const err = document.getElementById('cabinetBoostError');
    if (s1) s1.classList.remove('hidden');
    if (s2) s2.classList.add('hidden');
    if (err) { err.classList.add('hidden'); err.textContent = ''; }
    document.querySelectorAll('.cabinet-boost-tier-btn').forEach((b) => { b.disabled = false; });
}

function cabinetBoostShowStep2(paymentUrl, amount, description) {
    document.getElementById('cabinetBoostStep1').classList.add('hidden');
    document.getElementById('cabinetBoostStep2').classList.remove('hidden');
    document.getElementById('cabinetBoostStep2Desc').textContent = description;
    document.getElementById('cabinetBoostStep2Price').textContent = Math.round(amount);
    document.getElementById('cabinetBoostPayLink').href = paymentUrl;
}

async function purchaseCabinetBoost(tier) {
    const errEl = document.getElementById('cabinetBoostError');

    document.querySelectorAll('.cabinet-boost-tier-btn').forEach((b) => { b.disabled = true; });
    if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/boost/purchase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier: String(tier) }),
        });

        if (!resp || !resp.ok) {
            const err = resp ? await resp.json().catch(() => ({})) : {};
            throw new Error(err.detail || (resp ? `HTTP ${resp.status}` : 'Нет ответа'));
        }

        const data = await resp.json();
        if (!data.payment_url) throw new Error('Не удалось сформировать ссылку на оплату');

        cabinetBoostShowStep2(data.payment_url, data.amount, data.description);
    } catch (e) {
        console.error('[purchaseCabinetBoost]', e);
        if (errEl) {
            errEl.textContent = e.message || 'Произошла ошибка';
            errEl.classList.remove('hidden');
        }
        document.querySelectorAll('.cabinet-boost-tier-btn').forEach((b) => { b.disabled = false; });
    }
}

function initCabinetBoostModal() {
    const modal = document.getElementById('cabinetBoostModal');
    const backdrop = document.getElementById('cabinetBoostModalBackdrop');
    const openBtn = document.getElementById('cabinetOpenBoostBtn');

    openBtn?.addEventListener('click', openCabinetBoostModal);

    modal?.addEventListener('click', (e) => {
        if (e.target === backdrop) closeCabinetBoostModal();
    });

    document.getElementById('cabinetBoostModalClose')?.addEventListener('click', closeCabinetBoostModal);
    document.querySelectorAll('.cabinet-boost-modal-close-btn').forEach((b) => {
        b.addEventListener('click', closeCabinetBoostModal);
    });

    document.querySelectorAll('.cabinet-boost-tier-btn').forEach((b) => {
        b.addEventListener('click', () => purchaseCabinetBoost(b.dataset.boostTier));
    });

    document.getElementById('cabinetBoostBackBtn')?.addEventListener('click', cabinetBoostShowStep1);

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !modal || modal.getAttribute('aria-hidden') === 'true') return;
        closeCabinetBoostModal();
    });
}

// ============================================================================
// NAV ACCESS
// ============================================================================

function updateNavAccess(status, activeResumeHasProfile = true) {
    const hasAccess = status === 'trial' || status === 'active';
    const hhLinked = !!(currentUser && currentUser.hh_linked);
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

    // Обновляем текст бейджа: если подписка есть, но hh не привязан — другой текст
    if (hasAccess && !hhLinked) {
        if (settingsLock) settingsLock.textContent = 'Нужен hh.ru';
        if (responsesLock) responsesLock.textContent = 'Нужен hh.ru';
    }

    // Разблокируем навигацию только если: есть подписка + hh.ru привязан + нет онбординга
    if (hasAccess && hhLinked && !hasOnboarding && activeResumeHasProfile) {
        navSettings.classList.remove('nav-locked');
        navResponses.classList.remove('nav-locked');
        settingsLock.classList.add('hidden');
        responsesLock.classList.add('hidden');
        document.querySelectorAll('.nav-link-locked').forEach(el => el.classList.remove('nav-link-locked'));
    } else if (hasAccess && hhLinked && !hasOnboarding && !activeResumeHasProfile) {
        // Подписка есть, hh привязан, но профиль резюме не настроен
        navSettings.classList.remove('nav-locked');
        navResponses.classList.remove('nav-locked');
        settingsLock.classList.add('hidden');
        responsesLock.classList.add('hidden');
        document.querySelectorAll('.nav-link-locked').forEach(el => el.classList.remove('nav-link-locked'));
        setProfileLock(true);
    }
    // Если !hhLinked — nav-locked остаётся (класс стоит в HTML по умолчанию)
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

// ============================================================================
// PROMO CODE (MENTOR)
// ============================================================================

async function loadPromoStatus() {
    const card = document.getElementById('promoCard');
    let mentorApplied = false;

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/mentor/my-promo`);
        if (resp && resp.ok) {
            const data = await resp.json();
            if (data.applied) {
                mentorApplied = true;
                document.getElementById('promoNotApplied').classList.add('hidden');
                const appliedEl = document.getElementById('promoApplied');
                appliedEl.classList.remove('hidden');
                document.getElementById('promoAppliedCode').textContent = `Промокод ${data.promo_code} применён`;
                const mentorInfo = data.mentor_name || '';
                const benefitInfo = data.benefit_type === 'discount' ? `Скидка ${data.benefit_value}%` : '';
                document.getElementById('promoAppliedMentor').textContent =
                    [mentorInfo, benefitInfo].filter(Boolean).join(' — ');
            }
        }
    } catch (_) {}

    if (card) {
        // Видимость карточки:
        //   - Если уже применён менторский промо — показываем (плашка "Промокод X применён").
        //   - Иначе показываем форму ввода ТОЛЬКО если can_apply_promo=true
        //     (none / trial / ended_trial / ended_active без post-purchase lock).
        const canApply = !!(currentUser && currentUser.can_apply_promo);
        if (mentorApplied || canApply) {
            card.classList.remove('hidden');
        } else {
            card.classList.add('hidden');
        }
    }

    const pendingCode = localStorage.getItem('aurora_ref_code');
    if (pendingCode) {
        const promoInput = document.getElementById('promoInput');
        if (promoInput && !promoInput.value) {
            promoInput.value = pendingCode;
            applyPromoCode();
        }
    }
}

// ============================================================================
// REFERRAL CODES
// ============================================================================

async function loadReferralCodes() {
    const card = document.getElementById('referralCard');
    if (!card) return;

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/referral/my-codes`);
        if (!resp || !resp.ok) return;
        const data = await resp.json();

        if (!data.available) return;

        card.classList.remove('hidden');
        const slotsEl = document.getElementById('referralSlots');
        const siteBase = window.location.hostname.includes('aurora-develop')
            ? 'https://aurora-develop.ru'
            : 'https://aurora-career.ru';

        slotsEl.innerHTML = data.slots.map(function(slot, i) {
            const num = i + 1;
            if (slot.used) {
                return `<div class="p-3 rounded-xl border border-outline-variant/10" style="background:rgba(74,222,128,0.04)">
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-[#4ade80] text-lg" style="font-variation-settings:'FILL' 1;">check_circle</span>
                        <span class="text-sm text-on-surface font-medium">Код #${num}</span>
                        <span class="text-xs text-[#4ade80] font-semibold ml-auto">Использован</span>
                    </div>
                    <code class="block mt-1.5 text-xs text-outline break-all line-through">${slot.code}</code>
                </div>`;
            }
            const link = `${siteBase}/auth/?ref=${encodeURIComponent(slot.code)}`;
            return `<div class="p-3 rounded-xl border border-outline-variant/10" style="background:rgba(204,190,255,0.03)">
                <div class="flex items-center gap-2 mb-2">
                    <span class="material-symbols-outlined text-primary text-lg">link</span>
                    <span class="text-sm text-on-surface font-medium">Код #${num}</span>
                    <span class="text-xs text-on-surface-variant ml-auto">Свободен</span>
                </div>
                <div class="flex items-center gap-2">
                    <code class="flex-1 text-xs text-primary break-all cursor-pointer hover:underline" onclick="navigator.clipboard.writeText('${link}')" title="Нажмите, чтобы скопировать">${link}</code>
                    <button onclick="copyRefLink(this, '${link}')" class="flex-shrink-0 text-xs text-on-surface-variant hover:text-primary transition-colors cursor-pointer" title="Скопировать">
                        <span class="material-symbols-outlined text-base">content_copy</span>
                    </button>
                </div>
            </div>`;
        }).join('');

        const bonusEl = document.getElementById('referralBonus');
        if (data.bonus_description) {
            bonusEl.classList.remove('hidden');
            document.getElementById('referralBonusText').textContent = data.bonus_description;
        }

        if (data.updated_at) {
            const d = new Date(data.updated_at);
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            const nextDate = new Date(d);
            nextDate.setDate(nextDate.getDate() + 30);
            const nd = String(nextDate.getDate()).padStart(2, '0');
            const nm = String(nextDate.getMonth() + 1).padStart(2, '0');
            const ny = nextDate.getFullYear();
            document.getElementById('referralUpdatedAt').textContent =
                `Обновлено: ${dd}.${mm}.${yyyy} · Коды обновятся: ${nd}.${nm}.${ny}`;
        }
    } catch (e) {
        console.error('[Cabinet] loadReferralCodes error:', e);
    }
}

function copyRefLink(btn, link) {
    navigator.clipboard.writeText(link).then(function() {
        const icon = btn.querySelector('.material-symbols-outlined');
        if (icon) {
            icon.textContent = 'check';
            setTimeout(function() { icon.textContent = 'content_copy'; }, 2000);
        }
    });
}

async function applyPromoCode() {
    const input = document.getElementById('promoInput');
    const btn = document.getElementById('promoApplyBtn');
    const errEl = document.getElementById('promoError');
    errEl.classList.add('hidden');

    const code = input.value.trim();
    if (!code) {
        errEl.textContent = 'Введите промокод';
        errEl.classList.remove('hidden');
        return;
    }

    btn.disabled = true;
    btn.textContent = '...';

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/mentor/apply-promo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ promo_code: code }),
        });

        if (!resp) { btn.disabled = false; btn.textContent = 'Применить'; return; }

        const data = await resp.json();

        if (resp.ok && data.ok) {
            localStorage.removeItem('aurora_ref_code');

            if (data.access_granted) {
                _showAccessActivationOverlay(data.access_days || 0);
                return;
            }

            document.getElementById('promoNotApplied').classList.add('hidden');
            const appliedEl = document.getElementById('promoApplied');
            appliedEl.classList.remove('hidden');
            document.getElementById('promoAppliedCode').textContent = `Промокод ${code} применён`;
            document.getElementById('promoAppliedMentor').textContent =
                [data.mentor_name, data.benefit].filter(Boolean).join(' — ');

            loadTariffs();
        } else {
            errEl.textContent = data.detail || 'Не удалось применить промокод';
            errEl.classList.remove('hidden');
            input.classList.add('shake');
            setTimeout(() => input.classList.remove('shake'), 500);
        }
    } catch (e) {
        errEl.textContent = 'Ошибка сети';
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Применить';
    }
}

function _showAccessActivationOverlay(days) {
    const overlay = document.createElement('div');
    overlay.id = 'accessActivationOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px)';

    const card = document.createElement('div');
    card.style.cssText = 'background:var(--md-sys-color-surface-container-highest,#1e1e2e);border-radius:20px;padding:36px 32px;text-align:center;max-width:380px;width:90%';

    const spinner = document.createElement('div');
    spinner.style.cssText = 'width:48px;height:48px;border:4px solid rgba(255,255,255,0.15);border-top-color:var(--md-sys-color-primary,#a78bfa);border-radius:50%;margin:0 auto 20px;animation:spin 0.8s linear infinite';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:18px;font-weight:700;color:var(--md-sys-color-on-surface,#e2e8f0);margin-bottom:8px';
    title.textContent = 'Активируем подписку...';

    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:14px;color:var(--md-sys-color-on-surface-variant,#94a3b8)';
    sub.textContent = 'Настраиваем ваш доступ';

    card.appendChild(spinner);
    card.appendChild(title);
    card.appendChild(sub);
    overlay.appendChild(card);

    const styleTag = document.createElement('style');
    styleTag.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(styleTag);
    document.body.appendChild(overlay);

    const daysLabel = days > 0 ? ` на ${days} дней` : '';

    setTimeout(() => {
        spinner.style.display = 'none';
        const check = document.createElement('div');
        check.style.cssText = 'font-size:48px;margin-bottom:16px';
        check.textContent = '\u2705';
        card.insertBefore(check, title);
        title.textContent = 'Подписка активирована!';
        sub.textContent = `Полный доступ${daysLabel}. Добро пожаловать!`;

        const btn = document.createElement('button');
        btn.style.cssText = 'margin-top:24px;padding:12px 32px;background:var(--md-sys-color-primary,#a78bfa);color:var(--md-sys-color-on-primary,#1e1e2e);border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer';
        btn.textContent = 'Продолжить';
        btn.onclick = () => window.location.reload();
        card.appendChild(btn);
    }, 1500);
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
// TRIAL CARD (только status === 'none' на бэкенде)
// ============================================================================

function applyTrialCardVisibility(user) {
    const trialCard = document.getElementById('trialCard');
    if (!trialCard) return;
    const show =
        user.can_start_trial === true
        || (user.can_start_trial === undefined && user.subscription_status === 'none');
    trialCard.classList.toggle('hidden', !show);
    trialCard.toggleAttribute('aria-hidden', !show);
    if (!show) {
        trialCard.removeAttribute('onclick');
        trialCard.style.pointerEvents = 'none';
        trialCard.style.cursor = 'default';
    } else {
        trialCard.setAttribute('onclick', 'handleActivateTrial()');
        trialCard.style.pointerEvents = '';
        trialCard.style.cursor = '';
    }
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
        _loadedTariffs = tariffs;

        if (tariffs.length === 0) {
            container.innerHTML = '';
            grid.classList.remove('hidden');
            return;
        }

        container.innerHTML = tariffs.map((t) => {
            const hasDiscount = t.discounted_price != null && t.discounted_price < t.price;
            const showPrice = hasDiscount ? t.discounted_price : t.price;
            const pricePerDay = (showPrice / t.duration_days).toFixed(0);
            const isPopular = !!t.is_popular;
            const months = Math.round(t.duration_days / 30);
            const monthLabel = 'мес';
            const hasBoost = t.included_boost_20 || t.included_boost_40;
            const boostAmount = t.included_boost_40 ? 40 : (t.included_boost_20 ? 20 : 0);

            const priceHtml = hasDiscount
                ? `<div class="text-xs text-on-surface-variant/60 line-through">${t.price.toLocaleString('ru-RU')} ₽</div>
                   <div class="text-lg font-bold text-primary">${showPrice.toLocaleString('ru-RU')} ₽</div>`
                : `<div class="text-lg font-bold text-on-surface">${t.price.toLocaleString('ru-RU')} ₽</div>`;

            return `
            <div class="p-5 rounded-2xl cab-card cursor-pointer transition-all ${isPopular ? 'tariff-popular' : ''}"
                 onclick="showTariffModal('${escapeHtml(t.plan_code)}')" data-plan="${escapeHtml(t.plan_code)}">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style="background:rgba(101,62,219,0.12);">
                            <span class="material-symbols-outlined text-primary">${months <= 1 ? 'bolt' : months <= 2 ? 'speed' : 'workspace_premium'}</span>
                        </div>
                        <div>
                            <span class="text-sm font-semibold text-on-surface">${escapeHtml(t.name)}</span>
                            <p class="text-on-surface-variant text-xs mt-0.5">${t.duration_days} дней &#8226; ${pricePerDay} ₽/день</p>
                            ${hasBoost ? `<p class="text-xs text-primary font-medium mt-0.5">Буст +${boostAmount} включён</p>` : ''}
                        </div>
                    </div>
                    <div class="text-right flex-shrink-0 ml-3">
                        ${priceHtml}
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

// URL страницы-прокладки. Открывается синхронно при клике на тариф.
// Главные плюсы (vs about:blank):
//   1) Юзер видит брендированный лоадер с темой Aurora, а не белый экран.
//   2) Сменяемые тексты дают понять, что мы работаем (особенно на медленном инете).
//   3) Если что-то пошло не так — у юзера на нашей странице понятный fallback.
const PAYMENT_LOADER_PATH = '/cabinet/payment-loading/';
const PAYMENT_STORAGE_KEY = 'aurora_pending_payment';
const PAYMENT_STORAGE_TTL_MS = 5 * 60 * 1000;

async function handlePurchase(planCode) {
    const card = document.querySelector(`[data-plan="${planCode}"]`);
    if (card) {
        card.style.opacity = '0.6';
        card.style.pointerEvents = 'none';
    }

    // L1: открываем НАШУ страницу-прокладку СИНХРОННО (user gesture trust).
    // Браузер не блокирует popup, юзер видит брендированный лоадер вместо about:blank.
    const loaderUrl = PAYMENT_LOADER_PATH + '?t=' + Date.now();
    let paymentWindow = null;
    try {
        paymentWindow = window.open(loaderUrl, '_blank');
    } catch (_) {
        paymentWindow = null;
    }

    _showPaymentRedirectOverlay();

    // Готовим обработчик ready-сигнала ОТ прокладки. Прокладка может прислать
    // его раньше, чем мы получим payment_url от бэка — тогда сохраняем URL
    // и отправим, как только он появится.
    let pendingUrl = null;
    let pendingError = null;
    let listenerActive = true;

    const onLoaderReady = (event) => {
        if (!listenerActive) return;
        if (event.source !== paymentWindow) return;
        if (event.origin !== location.origin) return;
        const data = event.data || {};
        if (data.type !== 'aurora_loader_ready') return;
        if (pendingUrl) {
            _postToLoader(paymentWindow, { type: 'aurora_payment_url', url: pendingUrl });
        } else if (pendingError) {
            _postToLoader(paymentWindow, { type: 'aurora_payment_error', message: pendingError });
        }
    };
    window.addEventListener('message', onLoaderReady);

    const cleanupListener = () => {
        listenerActive = false;
        window.removeEventListener('message', onLoaderReady);
    };

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/subscribe/purchase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan_code: planCode }),
        });

        if (!resp || !resp.ok) {
            const err = await (resp ? resp.json().catch(() => ({})) : Promise.resolve({}));
            throw new Error(err.detail || 'Purchase failed');
        }

        const data = await resp.json();
        if (!data.payment_url) {
            pendingError = 'Не удалось создать платёж. Попробуйте ещё раз.';
            _postToLoader(paymentWindow, { type: 'aurora_payment_error', message: pendingError });
            _hidePaymentRedirectOverlay();
            setTimeout(cleanupListener, 5000);
            return;
        }

        _lastPaymentContext = {
            payment_url: data.payment_url,
            payment_id: data.payment_id || null,
            plan_code: planCode,
            amount: data.amount,
            description: data.description,
        };

        pendingUrl = data.payment_url;

        // Резервный канал передачи URL: localStorage с TTL.
        // Используется если юзер обновит прокладку (postMessage потерян).
        try {
            localStorage.setItem(PAYMENT_STORAGE_KEY, JSON.stringify({
                url: data.payment_url,
                expires_at: Date.now() + PAYMENT_STORAGE_TTL_MS,
            }));
        } catch (_) {}

        if (_isWindowAlive(paymentWindow)) {
            // Отправляем URL прокладке. Дублируем 3 раза с интервалом —
            // защита от race condition (прокладка может ещё не повесить listener).
            _postToLoader(paymentWindow, { type: 'aurora_payment_url', url: data.payment_url });
            setTimeout(() => _postToLoader(paymentWindow, { type: 'aurora_payment_url', url: data.payment_url }), 250);
            setTimeout(() => _postToLoader(paymentWindow, { type: 'aurora_payment_url', url: data.payment_url }), 800);

            _trackPaymentEvent('window_open_ok', data.payment_id);
            _updatePaymentOverlayOpened(data.payment_url, data.payment_id);
            // Слушатель ready-сигнала живёт ещё 30 сек на случай очень медленной загрузки прокладки
            setTimeout(cleanupListener, 30000);
            return;
        }

        // L2: окно прокладки не открылось → fallback-модалка с прямой <a>
        _trackPaymentEvent('popup_blocked', data.payment_id, {
            ua: navigator.userAgent,
        });
        _hidePaymentRedirectOverlay();
        _showPaymentBlockedModal(data.payment_url, data.payment_id);
        cleanupListener();

    } catch (e) {
        console.error('[Purchase] Error:', e);
        pendingError = 'Не удалось создать платёж. Попробуйте ещё раз.';
        _postToLoader(paymentWindow, { type: 'aurora_payment_error', message: pendingError });
        // Прокладку не закрываем — пусть юзер увидит сообщение об ошибке и закроет сам
        _hidePaymentRedirectOverlay();
        if (card) {
            card.style.opacity = '1';
            card.style.pointerEvents = 'auto';
        }
        setTimeout(cleanupListener, 5000);
    }
}

function _postToLoader(win, payload) {
    if (!_isWindowAlive(win)) return;
    try {
        win.postMessage(payload, location.origin);
    } catch (_) {}
}

// ============================================================================
// TARIFF MODAL — транзитное окно перед оплатой тарифа
// ============================================================================

function showTariffModal(planCode) {
    const t = _loadedTariffs.find((x) => x.plan_code === planCode);
    if (!t) {
        handlePurchase(planCode);
        return;
    }

    // Трекинг: юзер открыл модалку конкретного тарифа.
    // Шаг "интерес → намерение" в воронке оплаты. Fire-and-forget.
    _trackPaymentEvent('tariff_modal_opened', null, {
        plan_code: planCode,
        price: t.price,
        discounted_price: t.discounted_price || null,
    });

    const modal = document.getElementById('tariffModal');
    const card = document.getElementById('tariffModalCard');
    const backdrop = document.getElementById('tariffModalBackdrop');
    if (!modal) return;

    const hasDiscount = t.discounted_price != null && t.discounted_price < t.price;
    const showPrice = hasDiscount ? t.discounted_price : t.price;
    const pricePerDay = Math.round(showPrice / t.duration_days);

    const titleEl = document.getElementById('tariffModalTitle');
    const descEl = document.getElementById('tariffModalDesc');
    const priceEl = document.getElementById('tariffModalPrice');
    const oldPriceEl = document.getElementById('tariffModalOldPrice');
    const metaEl = document.getElementById('tariffModalMeta');
    const boostBadge = document.getElementById('tariffModalBoostBadge');
    const boostText = document.getElementById('tariffModalBoostText');
    const payBtn = document.getElementById('tariffModalPayBtn');

    if (titleEl) titleEl.textContent = t.name;
    if (descEl) descEl.textContent = t.card_description || '';
    if (priceEl) priceEl.textContent = showPrice.toLocaleString('ru-RU');
    if (oldPriceEl) {
        if (hasDiscount) {
            oldPriceEl.textContent = t.price.toLocaleString('ru-RU') + ' ₽';
            oldPriceEl.classList.remove('hidden');
        } else {
            oldPriceEl.classList.add('hidden');
        }
    }
    if (metaEl) metaEl.textContent = `${t.duration_days} дней · ${pricePerDay}\u00a0₽/день`;

    const hasBoost = t.included_boost_20 || t.included_boost_40;
    if (boostBadge) {
        if (hasBoost) {
            const amt = t.included_boost_40 ? 40 : 20;
            boostText.textContent = `Буст +${amt} откликов включён в тариф`;
            boostBadge.classList.remove('hidden');
        } else {
            boostBadge.classList.add('hidden');
        }
    }

    if (payBtn) payBtn.dataset.plan = planCode;

    modal.classList.remove('pointer-events-none');
    modal.setAttribute('aria-hidden', 'false');
    lockBodyScroll();

    // Бэкдроп и карточка анимируются независимо — никаких родительских opacity,
    // поэтому нет момента «каши» из двух полупрозрачных слоёв одновременно.
    requestAnimationFrame(() => {
        backdrop.classList.add('opacity-100');
        backdrop.classList.remove('opacity-0');
        card.classList.add('scale-100', 'opacity-100');
        card.classList.remove('scale-95', 'opacity-0');
    });
}

function closeTariffModal() {
    const modal = document.getElementById('tariffModal');
    const card = document.getElementById('tariffModalCard');
    const backdrop = document.getElementById('tariffModalBackdrop');
    if (!modal) return;

    backdrop.classList.remove('opacity-100');
    backdrop.classList.add('opacity-0');
    card.classList.remove('scale-100', 'opacity-100');
    card.classList.add('scale-95', 'opacity-0');

    // transitionend теперь слушаем на карточке (родитель больше не анимируется)
    const onDone = () => {
        modal.classList.add('pointer-events-none');
        modal.setAttribute('aria-hidden', 'true');
        unlockBodyScroll();
    };
    card.addEventListener('transitionend', onDone, { once: true });
}

function initTariffModal() {
    const modal = document.getElementById('tariffModal');
    const backdrop = document.getElementById('tariffModalBackdrop');
    const closeBtn = document.getElementById('tariffModalClose');
    const payBtn = document.getElementById('tariffModalPayBtn');

    closeBtn?.addEventListener('click', closeTariffModal);

    backdrop?.addEventListener('click', closeTariffModal);

    payBtn?.addEventListener('click', () => {
        const planCode = payBtn.dataset.plan;
        closeTariffModal();
        handlePurchase(planCode);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !modal || modal.getAttribute('aria-hidden') === 'true') return;
        closeTariffModal();
    });
}

function _restoreTariffCardsAfterPaymentDismiss() {
    document.querySelectorAll('[data-plan]').forEach((el) => {
        el.style.opacity = '';
        el.style.pointerEvents = '';
    });
}

function _stopPaymentRedirectPoll() {
    if (_paymentRedirectPollTimer !== null) {
        clearInterval(_paymentRedirectPollTimer);
        _paymentRedirectPollTimer = null;
    }
}

function _showPaymentRedirectOverlay() {
    let overlay = document.getElementById('paymentRedirectOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'paymentRedirectOverlay';
        overlay.innerHTML = `
            <div id="paymentRedirectInner" style="position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;">
                <button type="button" id="paymentRedirectClose" aria-label="Закрыть"
                    class="payment-redirect-close"
                    style="position:absolute;top:max(16px,env(safe-area-inset-top));right:max(16px,env(safe-area-inset-right));width:44px;height:44px;border-radius:12px;border:1px solid rgba(204,190,255,0.25);background:rgba(33,30,41,0.9);color:#e7e0ef;font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s,border-color 0.2s;z-index:2;">
                    ×
                </button>
                <div id="paymentRedirectContent" style="display:flex;flex-direction:column;align-items:center;gap:24px;width:100%;max-width:min(100%,400px);">
                    <div id="paymentRedirectMain" style="display:flex;flex-direction:column;align-items:center;gap:20px;width:100%;">
                        <div class="payment-redirect-spinner" aria-hidden="true"></div>
                        <p id="paymentRedirectText" style="color:#e7e0ef;font-size:16px;font-weight:600;text-align:center;margin:0;line-height:1.45;max-width:100%;">
                            Перенаправление на страницу оплаты…
                        </p>
                    </div>
                </div>
            </div>`;
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', zIndex: '9999',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(21,18,28,0.92)', backdropFilter: 'blur(8px)',
            opacity: '0', transition: 'opacity 0.25s ease',
        });
        document.body.appendChild(overlay);

        const closeBtn = overlay.querySelector('#paymentRedirectClose');
        if (closeBtn) {
            closeBtn.addEventListener('mouseenter', () => {
                closeBtn.style.background = 'rgba(101,62,219,0.25)';
                closeBtn.style.borderColor = 'rgba(204,190,255,0.45)';
            });
            closeBtn.addEventListener('mouseleave', () => {
                closeBtn.style.background = 'rgba(33,30,41,0.9)';
                closeBtn.style.borderColor = 'rgba(204,190,255,0.25)';
            });
            closeBtn.addEventListener('click', () => {
                _hidePaymentRedirectOverlay();
            });
        }

        if (!document.getElementById('paymentRedirectSpinnerStyle')) {
            const style = document.createElement('style');
            style.id = 'paymentRedirectSpinnerStyle';
            style.textContent = `
                .payment-redirect-spinner {
                    width:44px;height:44px;border:3px solid rgba(204,190,255,0.15);
                    border-top-color:#ccbeff;border-radius:50%;
                    animation:paymentSpin 0.7s linear infinite;
                }
                @keyframes paymentSpin { to { transform:rotate(360deg); } }
            `;
            document.head.appendChild(style);
        }
    }
    overlay.style.display = 'flex';
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
}

function _updatePaymentOverlayOpened(paymentUrl, paymentId) {
    const text = document.getElementById('paymentRedirectText');
    if (text) {
        text.innerHTML = ''
            + '<span style="display:block;font-weight:600;color:#e7e0ef;">Оплата открыта в новой вкладке.</span>'
            + '<span style="display:block;font-weight:400;font-size:14px;color:#cac3d7;margin-top:10px;line-height:1.5;">После оплаты эта страница обновится автоматически.</span>';
    }

    // L3: через 4 секунды показываем резервную ссылку.
    // Если новая вкладка не открылась (что редко после L1, но возможно на
    // совсем строгих браузерах) или пользователь её случайно закрыл —
    // он увидит явный CTA "открыть оплату вручную" с прямой <a>.
    if (_paymentFallbackTimer) {
        clearTimeout(_paymentFallbackTimer);
        _paymentFallbackTimer = null;
    }
    if (paymentUrl) {
        _paymentFallbackTimer = setTimeout(() => {
            _showPaymentOverlayFallback(paymentUrl, paymentId);
        }, 4000);
    }

    setTimeout(() => _pollPaymentStatus(), 3000);
}

function _showPaymentOverlayFallback(paymentUrl, paymentId) {
    const overlay = document.getElementById('paymentRedirectOverlay');
    if (!overlay) return;
    if (overlay.querySelector('#paymentRedirectFallback')) return;

    const target = document.getElementById('paymentRedirectContent');
    if (!target) return;

    const wrap = document.createElement('div');
    wrap.id = 'paymentRedirectFallback';
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:stretch;gap:10px;width:100%;max-width:320px;';
    wrap.innerHTML = `
        <p style="color:#cac3d7;font-size:13px;line-height:1.5;text-align:center;margin:0;">
            Если новая вкладка не открылась — нажмите кнопку ниже.<br>
            Также счёт продублирован на вашу почту.
        </p>
        <a id="paymentRedirectFallbackLink" href="${paymentUrl}" target="_blank" rel="noopener noreferrer"
           style="display:block;text-align:center;padding:14px 18px;border-radius:14px;
                  background:linear-gradient(135deg,#7b4dff 0%,#5a30d0 100%);
                  color:#fff;font-weight:700;font-size:15px;text-decoration:none;
                  box-shadow:0 10px 30px rgba(90,48,208,0.35);
                  transition:filter 0.2s, transform 0.1s;">
            Открыть оплату вручную
        </a>
    `;
    target.appendChild(wrap);

    const link = wrap.querySelector('#paymentRedirectFallbackLink');
    link.addEventListener('mouseenter', () => { link.style.filter = 'brightness(1.1)'; });
    link.addEventListener('mouseleave', () => { link.style.filter = 'brightness(1)'; });
    link.addEventListener('mousedown', () => { link.style.transform = 'scale(0.98)'; });
    link.addEventListener('mouseup', () => { link.style.transform = 'scale(1)'; });
    link.addEventListener('click', () => {
        _trackPaymentEvent('fallback_link_clicked', paymentId);
    });
}

function _hidePaymentRedirectOverlay() {
    _stopPaymentRedirectPoll();
    _restoreTariffCardsAfterPaymentDismiss();
    if (_paymentFallbackTimer) {
        clearTimeout(_paymentFallbackTimer);
        _paymentFallbackTimer = null;
    }
    const overlay = document.getElementById('paymentRedirectOverlay');
    if (!overlay) return;
    const fb = overlay.querySelector('#paymentRedirectFallback');
    if (fb) fb.remove();
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 260);
}

// ============================================================================
// L2: PAYMENT BLOCKED MODAL — fallback когда window.open вернул null
// ============================================================================

function _showPaymentBlockedModal(paymentUrl, paymentId) {
    let modal = document.getElementById('paymentBlockedModal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'paymentBlockedModal';
    Object.assign(modal.style, {
        position: 'fixed', inset: '0', zIndex: '10000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', boxSizing: 'border-box',
        background: 'rgba(16,13,23,0.82)', backdropFilter: 'blur(10px)',
        opacity: '0', transition: 'opacity 0.25s ease',
    });
    modal.innerHTML = `
        <div style="position:relative;width:100%;max-width:420px;background:linear-gradient(180deg,#1c1726 0%,#15121c 100%);
                    border:1px solid rgba(204,190,255,0.12);border-radius:20px;
                    box-shadow:0 40px 100px rgba(0,0,0,0.55);overflow:hidden;
                    transform:scale(0.96);transition:transform 0.25s ease;">
            <div style="position:absolute;top:-80px;right:-80px;width:220px;height:220px;
                        background:rgba(101,62,219,0.18);border-radius:50%;filter:blur(70px);pointer-events:none;"></div>

            <button type="button" id="paymentBlockedClose" aria-label="Закрыть"
                    style="position:absolute;top:14px;right:14px;width:40px;height:40px;
                           border-radius:12px;border:1px solid rgba(204,190,255,0.18);
                           background:rgba(33,30,41,0.9);color:#e7e0ef;font-size:22px;
                           line-height:1;cursor:pointer;display:flex;align-items:center;
                           justify-content:center;z-index:2;transition:background 0.2s;">×</button>

            <div style="position:relative;padding:28px 24px 8px 24px;">
                <div style="display:flex;align-items:center;justify-content:center;
                            width:56px;height:56px;border-radius:16px;
                            background:rgba(255,176,71,0.12);
                            border:1px solid rgba(255,176,71,0.25);margin-bottom:14px;">
                    <span style="color:#ffb047;font-size:28px;line-height:1;">!</span>
                </div>
                <h2 style="color:#f1ecfa;font-size:20px;font-weight:800;line-height:1.25;
                           margin:0 0 8px 0;letter-spacing:-0.01em;">
                    Браузер заблокировал окно оплаты
                </h2>
                <p style="color:#a8a0b8;font-size:14px;line-height:1.55;margin:0;">
                    Это безопасная страница CloudPayments — нужно открыть её вручную.
                    Используйте кнопку ниже или ссылку из письма со счётом на вашей почте.
                </p>
            </div>

            <div style="position:relative;padding:18px 24px 24px 24px;display:flex;flex-direction:column;gap:10px;">
                <a id="paymentBlockedPayLink" href="${paymentUrl}" target="_blank" rel="noopener noreferrer"
                   style="display:block;text-align:center;padding:15px 18px;border-radius:14px;
                          background:linear-gradient(135deg,#7b4dff 0%,#5a30d0 100%);
                          color:#fff;font-weight:700;font-size:15px;text-decoration:none;
                          box-shadow:0 10px 30px rgba(90,48,208,0.35);
                          transition:filter 0.2s, transform 0.1s;">
                    Перейти к оплате
                </a>
                <button type="button" id="paymentBlockedCopy"
                        style="display:flex;align-items:center;justify-content:center;gap:8px;
                               padding:13px 18px;border-radius:14px;border:1px solid rgba(204,190,255,0.18);
                               background:transparent;color:#cac3d7;font-weight:600;font-size:14px;
                               cursor:pointer;transition:background 0.2s, border-color 0.2s;">
                    Скопировать ссылку
                </button>
                <p style="color:#7d7589;font-size:11px;line-height:1.5;text-align:center;margin:6px 0 0 0;">
                    После оплаты этот кабинет обновится автоматически.
                </p>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    requestAnimationFrame(() => {
        modal.style.opacity = '1';
        const card = modal.querySelector('div');
        if (card) card.style.transform = 'scale(1)';
    });

    const closeFn = () => {
        modal.style.opacity = '0';
        setTimeout(() => modal.remove(), 250);
        _restoreTariffCardsAfterPaymentDismiss();
    };
    modal.querySelector('#paymentBlockedClose').addEventListener('click', closeFn);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeFn(); });

    const payLink = modal.querySelector('#paymentBlockedPayLink');
    payLink.addEventListener('mouseenter', () => { payLink.style.filter = 'brightness(1.1)'; });
    payLink.addEventListener('mouseleave', () => { payLink.style.filter = 'brightness(1)'; });
    payLink.addEventListener('click', () => {
        _trackPaymentEvent('modal_link_clicked', paymentId);
        // Поллим статус оплаты — если оплата пройдёт, кабинет обновится сам
        setTimeout(() => _pollPaymentStatus(), 3000);
    });

    const copyBtn = modal.querySelector('#paymentBlockedCopy');
    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(paymentUrl);
            copyBtn.textContent = 'Ссылка скопирована';
            copyBtn.style.color = '#a78bfa';
            copyBtn.style.borderColor = 'rgba(167,139,250,0.45)';
            _trackPaymentEvent('modal_link_copied', paymentId);
            setTimeout(() => {
                copyBtn.textContent = 'Скопировать ссылку';
                copyBtn.style.color = '#cac3d7';
                copyBtn.style.borderColor = 'rgba(204,190,255,0.18)';
            }, 2200);
        } catch (e) {
            // Fallback для старых браузеров без navigator.clipboard
            const ta = document.createElement('textarea');
            ta.value = paymentUrl;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (_) {}
            ta.remove();
            copyBtn.textContent = 'Ссылка скопирована';
            _trackPaymentEvent('modal_link_copied', paymentId, { fallback: true });
        }
    });
}

function _pollPaymentStatus() {
    _stopPaymentRedirectPoll();
    let attempts = 0;
    const maxAttempts = 60;
    _paymentRedirectPollTimer = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
            _stopPaymentRedirectPoll();
            _hidePaymentRedirectOverlay();
            window.location.reload();
            return;
        }
        try {
            const resp = await fetch(`${API_BASE_URL}/api/auth/me`, { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                if (data.has_access && data.subscription_status === 'active') {
                    _stopPaymentRedirectPoll();
                    window.location.reload();
                }
            }
        } catch (_) {}
    }, 5000);
}

async function handleActivateTrial() {
    const trialCard = document.getElementById('trialCard');
    if (trialCard) {
        trialCard.style.opacity = '0.6';
        trialCard.style.pointerEvents = 'none';
    }

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/activate-trial-free`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!resp || !resp.ok) {
            const err = await resp.json().catch(() => ({}));
            if (resp.status === 409) {
                window.location.href = '/onboarding/';
                return;
            }
            if (resp.status === 403) {
                alert(err.detail || 'Пробный период для этого аккаунта недоступен.');
                return;
            }
            if (resp.status === 410) {
                alert(err.detail || 'Свободные места на пробный период закончились.');
                return;
            }
            throw new Error(err.detail || 'Activation failed');
        }

        window.location.href = '/onboarding/';
    } catch (e) {
        console.error('[Trial] Error:', e);
        if (trialCard) {
            trialCard.style.opacity = '1';
            trialCard.style.pointerEvents = 'auto';
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

    document.getElementById('loadingSkeleton').style.display = 'none';
    document.getElementById('mainContent').style.display = '';
}

async function showPaymentPending(initialData) {
    const banner = document.getElementById('paymentSuccessBanner');
    const desc = document.getElementById('paymentSuccessDesc');
    banner.classList.remove('hidden');
    desc.textContent = 'Платёж обрабатывается, подождите...';

    document.getElementById('loadingSkeleton').style.display = 'none';
    document.getElementById('mainContent').style.display = '';
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
    // L1: открываем пустую вкладку синхронно — иначе Safari/Brave заблокируют popup
    let tgWindow = null;
    try { tgWindow = window.open('about:blank', '_blank'); } catch (_) {}

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/auth/link-telegram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!resp || !resp.ok) {
            if (_isWindowAlive(tgWindow)) tgWindow.close();
            return;
        }

        const data = await resp.json();
        if (!data.link) {
            if (_isWindowAlive(tgWindow)) tgWindow.close();
            return;
        }

        if (_isWindowAlive(tgWindow)) {
            try {
                tgWindow.location.href = data.link;
                return;
            } catch (_) {}
        }

        // L2: вкладка не открылась — показываем простой alert-fallback с прямой <a>
        _showSimpleLinkFallback(data.link, 'Привязка Telegram');
    } catch (_) {
        if (_isWindowAlive(tgWindow)) {
            try { tgWindow.close(); } catch (_) {}
        }
    }
}

function _showSimpleLinkFallback(url, title) {
    let modal = document.getElementById('simpleLinkFallbackModal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'simpleLinkFallbackModal';
    Object.assign(modal.style, {
        position: 'fixed', inset: '0', zIndex: '10000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', boxSizing: 'border-box',
        background: 'rgba(16,13,23,0.82)', backdropFilter: 'blur(10px)',
        opacity: '0', transition: 'opacity 0.25s ease',
    });
    const safeTitle = String(title || 'Открыть ссылку').replace(/[<>&]/g, '');
    modal.innerHTML = `
        <div style="position:relative;width:100%;max-width:380px;background:#1c1726;
                    border:1px solid rgba(204,190,255,0.12);border-radius:18px;padding:24px;
                    box-shadow:0 30px 80px rgba(0,0,0,0.5);">
            <h3 style="color:#f1ecfa;font-size:17px;font-weight:700;margin:0 0 8px 0;">${safeTitle}</h3>
            <p style="color:#a8a0b8;font-size:13px;line-height:1.55;margin:0 0 16px 0;">
                Браузер заблокировал открытие новой вкладки. Нажмите кнопку, чтобы открыть вручную.
            </p>
            <a href="${url}" target="_blank" rel="noopener noreferrer"
               style="display:block;text-align:center;padding:13px 18px;border-radius:12px;
                      background:linear-gradient(135deg,#7b4dff 0%,#5a30d0 100%);color:#fff;
                      font-weight:700;font-size:14px;text-decoration:none;
                      box-shadow:0 8px 24px rgba(90,48,208,0.3);">
                Открыть
            </a>
            <button type="button" id="simpleLinkClose"
                    style="display:block;width:100%;margin-top:8px;padding:10px;border-radius:10px;
                           border:none;background:transparent;color:#7d7589;font-size:13px;cursor:pointer;">
                Закрыть
            </button>
        </div>
    `;
    document.body.appendChild(modal);
    requestAnimationFrame(() => { modal.style.opacity = '1'; });

    const closeFn = () => {
        modal.style.opacity = '0';
        setTimeout(() => modal.remove(), 250);
    };
    modal.querySelector('#simpleLinkClose').addEventListener('click', closeFn);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeFn(); });
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

function formatDate(isoStr) {
    if (!isoStr) return '—';
    try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (_) {
        return '—';
    }
}

function daysUntil(isoStr) {
    if (!isoStr) return null;
    try {
        const target = new Date(isoStr);
        const now = new Date();
        const diff = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
        return diff;
    } catch (_) {
        return null;
    }
}

// ============================================================================
// HH LINKING (for users with active subscription but no hh.ru account)
// ============================================================================

async function startHhLinking() {
    ['hhLinkBanner', 'hhLinkBannerMobile'].forEach(function(id) {
        const el = document.getElementById(id);
        const btn = el ? el.querySelector('button') : null;
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    });
    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/onboarding/start-linking`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!resp || !resp.ok) {
            const err = await resp.json().catch(() => ({}));
            alert(err.detail || 'Не удалось начать привязку');
            if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
            return;
        }
        window.location.href = '/onboarding/';
    } catch (e) {
        console.error('[HH Linking] Error:', e);
        alert('Произошла ошибка. Попробуйте ещё раз.');
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }
}
