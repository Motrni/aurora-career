/**
 * setup-profile.js v1.0 — Настройка поискового профиля из кабинета.
 * Отдельный от онбординга флоу: smart_cluster -> выбор ролей -> smart_query.
 * Не затрагивает current_step в таблице users.
 */

const API_BASE_URL = window.AuroraSession
    ? window.AuroraSession.getApiBase()
    : ((window.location.hostname.includes('twc1.net') || window.location.hostname.includes('aurora-develop'))
        ? 'https://api.aurora-develop.ru'
        : 'https://api.aurora-career.ru');

let currentRoles = [];
let _rolesPollingId = null;
let _queryPollingId = null;
let _pollingStartedAt = null;
const POLLING_TIMEOUT_MS = 5 * 60 * 1000;

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

// ============================================================================
// INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const meResp = await apiFetch(`${API_BASE_URL}/api/auth/me`);
        if (!meResp || !meResp.ok) {
            window.location.href = '/auth/';
            return;
        }
        const me = await meResp.json();

        const hasAccess = me.subscription_status === 'trial' || me.subscription_status === 'active';
        if (!hasAccess) {
            window.location.href = '/cabinet/';
            return;
        }

        if (me.current_step && me.current_step.startsWith('onboarding_')) {
            window.location.href = '/onboarding/';
            return;
        }

        const resumesResp = await apiFetch(`${API_BASE_URL}/api/resumes/list`);
        if (!resumesResp || !resumesResp.ok) {
            window.location.href = '/cabinet/';
            return;
        }
        const resumesData = await resumesResp.json();
        const activeResume = (resumesData.resumes || []).find(r => r.is_active);

        if (activeResume && activeResume.has_custom_query) {
            window.location.href = '/settings/';
            return;
        }

        document.getElementById('loadingSkeleton').style.display = 'none';
        document.getElementById('mainContent').classList.remove('hidden');

        const rolesResp = await apiFetch(`${API_BASE_URL}/api/profile-setup/roles-status`);
        if (rolesResp && rolesResp.ok) {
            const rolesData = await rolesResp.json();
            if (rolesData.status === 'ready') {
                renderRoles(rolesData.roles);
                return;
            }
            if (rolesData.status === 'pending') {
                startRolesPolling();
                startRotatingText();
                return;
            }
        }

        const queryResp = await apiFetch(`${API_BASE_URL}/api/profile-setup/query-status`);
        if (queryResp && queryResp.ok) {
            const queryData = await queryResp.json();
            if (queryData.status === 'pending') {
                showQueryGenerating();
                startQueryPolling();
                return;
            }
            if (queryData.status === 'complete') {
                window.location.href = '/settings/?profile_ready=1';
                return;
            }
        }

        await startClustering();

    } catch (e) {
        console.error('[SetupProfile] Init error:', e);
        window.location.href = '/cabinet/';
    }
});

// ============================================================================
// CLUSTERING
// ============================================================================

async function startClustering() {
    startRotatingText();

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/profile-setup/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        if (!resp) return;

        if (resp.status === 409) {
            window.location.href = '/settings/';
            return;
        }

        if (!resp.ok) {
            console.error('[SetupProfile] start error:', resp.status);
            return;
        }

        startRolesPolling();
    } catch (e) {
        console.error('[SetupProfile] startClustering error:', e);
    }
}

const _rotatingPhrases = [
    'Ищу подходящие вакансии...',
    'Анализирую требования рынка...',
    'Группирую по категориям...',
    'Формирую список ролей...',
    'Почти готово...',
];
let _rotatingIdx = 0;
let _rotatingInterval = null;

function startRotatingText() {
    const el = document.getElementById('clusteringRotatingText');
    if (!el) return;
    _rotatingInterval = setInterval(() => {
        _rotatingIdx = (_rotatingIdx + 1) % _rotatingPhrases.length;
        el.classList.add('analysis-text-rotate');
        el.textContent = _rotatingPhrases[_rotatingIdx];
        setTimeout(() => el.classList.remove('analysis-text-rotate'), 500);
    }, 3000);
}

function stopRotatingText() {
    if (_rotatingInterval) {
        clearInterval(_rotatingInterval);
        _rotatingInterval = null;
    }
}

// ============================================================================
// ROLES POLLING
// ============================================================================

function startRolesPolling() {
    _pollingStartedAt = Date.now();
    _rolesPollingId = setInterval(async () => {
        if (Date.now() - _pollingStartedAt > POLLING_TIMEOUT_MS) {
            stopRolesPolling();
            stopRotatingText();
            showRetryError();
            return;
        }
        try {
            const resp = await apiFetch(`${API_BASE_URL}/api/profile-setup/roles-status`);
            if (!resp || !resp.ok) return;
            const data = await resp.json();

            if (data.status === 'ready') {
                stopRolesPolling();
                stopRotatingText();
                renderRoles(data.roles);
            } else if (data.status === 'stale') {
                stopRolesPolling();
                stopRotatingText();
                await startClustering();
            }
        } catch (_) {}
    }, 3000);
}

function stopRolesPolling() {
    if (_rolesPollingId) {
        clearInterval(_rolesPollingId);
        _rolesPollingId = null;
    }
}

// ============================================================================
// ROLES UI
// ============================================================================

function renderRoles(roles) {
    currentRoles = roles.map(r => ({ name: r, active: true }));

    const wrapper = document.getElementById('contentWrapper');
    if (wrapper) wrapper.style.maxWidth = '960px';

    document.getElementById('clusteringLoading').classList.add('hidden');
    document.getElementById('rolesSection').classList.remove('hidden');

    const grid = document.getElementById('rolesGrid');
    grid.innerHTML = currentRoles.map((role, i) => `
        <div class="spotlight-card glass-card rounded-xl p-5 sm:p-6 border border-outline-variant/10 cursor-pointer select-none glow-green role-card-enter transition-all duration-200"
             style="animation-delay: ${i * 60}ms"
             data-role-idx="${i}" onclick="toggleRole(${i}, this)">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-vibrant-green/10 transition-colors duration-200 role-icon-bg">
                    <span class="material-symbols-outlined text-vibrant-green text-lg transition-colors duration-200 role-icon" style="font-variation-settings: 'FILL' 1;">check_circle</span>
                </div>
                <span class="text-on-surface font-medium text-sm sm:text-[15px]">${escapeHtml(role.name)}</span>
            </div>
        </div>
    `).join('');

    grid.addEventListener('mousemove', handleSpotlight);
}

function handleSpotlight(e) {
    const cards = e.currentTarget.querySelectorAll('.spotlight-card');
    cards.forEach(card => {
        const rect = card.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width * 100);
        const y = ((e.clientY - rect.top) / rect.height * 100);
        card.style.setProperty('--mouse-x', x + '%');
        card.style.setProperty('--mouse-y', y + '%');
    });
}

function toggleRole(idx, el) {
    const role = currentRoles[idx];
    role.active = !role.active;

    const iconBg = el.querySelector('.role-icon-bg');
    const icon = el.querySelector('.role-icon');

    if (role.active) {
        el.classList.remove('glow-red');
        el.classList.add('glow-green');
        el.classList.remove('border-error-container/30');
        el.classList.add('border-outline-variant/10');
        iconBg.classList.remove('bg-error/10');
        iconBg.classList.add('bg-vibrant-green/10');
        icon.classList.remove('text-error');
        icon.classList.add('text-vibrant-green');
        icon.textContent = 'check_circle';
    } else {
        el.classList.remove('glow-green');
        el.classList.add('glow-red');
        el.classList.remove('border-outline-variant/10');
        el.classList.add('border-error-container/30');
        iconBg.classList.remove('bg-vibrant-green/10');
        iconBg.classList.add('bg-error/10');
        icon.classList.remove('text-vibrant-green');
        icon.classList.add('text-error');
        icon.textContent = 'cancel';
    }
}

// ============================================================================
// CONFIRM ROLES
// ============================================================================

async function handleConfirmRoles() {
    const liked = currentRoles.filter(r => r.active).map(r => r.name);
    const disliked = currentRoles.filter(r => !r.active).map(r => r.name);

    if (liked.length === 0) {
        alert('Выберите хотя бы одну роль');
        return;
    }

    const btn = document.getElementById('confirmRolesBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:20px;height:20px;display:inline-block;vertical-align:middle"></span> Сохраняем...';

    try {
        const resp = await apiFetch(`${API_BASE_URL}/api/profile-setup/confirm-roles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ liked, disliked }),
        });

        if (!resp || !resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Ошибка сохранения');
        }

        showQueryGenerating();
        startQueryPolling();

    } catch (e) {
        console.error('[SetupProfile] confirmRoles error:', e);
        btn.disabled = false;
        btn.textContent = 'Далее';
    }
}

// ============================================================================
// QUERY GENERATION
// ============================================================================

function showQueryGenerating() {
    const wrapper = document.getElementById('contentWrapper');
    if (wrapper) wrapper.style.maxWidth = '480px';

    document.getElementById('clusteringLoading').classList.add('hidden');
    document.getElementById('rolesSection').classList.add('hidden');
    document.getElementById('queryGenerating').classList.remove('hidden');
}

function startQueryPolling() {
    _pollingStartedAt = Date.now();
    _queryPollingId = setInterval(async () => {
        if (Date.now() - _pollingStartedAt > POLLING_TIMEOUT_MS) {
            stopQueryPolling();
            showRetryError();
            return;
        }
        try {
            const resp = await apiFetch(`${API_BASE_URL}/api/profile-setup/query-status`);
            if (!resp || !resp.ok) return;
            const data = await resp.json();

            if (data.status === 'complete') {
                stopQueryPolling();
                window.location.href = '/settings/?profile_ready=1';
            } else if (data.status === 'stale') {
                stopQueryPolling();
                showRetryError();
            }
        } catch (_) {}
    }, 3000);
}

function stopQueryPolling() {
    if (_queryPollingId) {
        clearInterval(_queryPollingId);
        _queryPollingId = null;
    }
}

// ============================================================================
// RETRY / ERROR UI
// ============================================================================

function showRetryError() {
    const loading = document.getElementById('clusteringLoading');
    const queryGen = document.getElementById('queryGenerating');
    if (loading) loading.classList.add('hidden');
    if (queryGen) queryGen.classList.add('hidden');

    let errorEl = document.getElementById('setupError');
    if (!errorEl) {
        errorEl = document.createElement('div');
        errorEl.id = 'setupError';
        errorEl.className = 'fade-in';
        document.getElementById('contentWrapper').appendChild(errorEl);
    }
    errorEl.innerHTML = `
        <div class="glass-panel rounded-xl p-8 md:p-12 shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-outline-variant/10">
            <div class="flex flex-col items-center text-center space-y-6 py-4">
                <div class="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center">
                    <span class="material-symbols-outlined text-error text-3xl">error</span>
                </div>
                <div class="space-y-3">
                    <h2 class="text-2xl font-bold tracking-tight text-on-surface">Что-то пошло не так</h2>
                    <p class="text-on-surface-variant text-sm leading-relaxed max-w-[320px] mx-auto">
                        Анализ занял слишком много времени. Попробуйте запустить заново.
                    </p>
                </div>
                <button onclick="retrySetup()" class="btn-primary text-white px-8 py-3 rounded-xl font-semibold text-base cursor-pointer">
                    Попробовать снова
                </button>
            </div>
        </div>`;
}

async function retrySetup() {
    const errorEl = document.getElementById('setupError');
    if (errorEl) errorEl.remove();

    const loading = document.getElementById('clusteringLoading');
    if (loading) loading.classList.remove('hidden');

    await startClustering();
}

// ============================================================================
// UTILS
// ============================================================================

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
