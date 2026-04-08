// audit.js — Лид-магнит «Бесплатный аудит резюме»
// v1.0

const API_BASE_URL = (window.location.hostname.includes('twc1.net') || window.location.hostname.includes('aurora-develop'))
    ? 'https://api.aurora-develop.ru'
    : 'https://api.aurora-career.ru';

const TURNSTILE_SITE_KEY = '0x4AAAAAAC2GxGcQ1mSylGca';

let selectedFile = null;
let turnstileToken = null;
let userEmail = '';
let turnstileReady = false;

// ============================================================================
// INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    loadCounter();
    initDragDrop();
    initFileInput();
});

function loadCounter() {
    fetch(`${API_BASE_URL}/api/audit/counter`, { method: 'GET' })
        .then(r => { if (r.ok) return r.json(); throw new Error(r.status); })
        .then(data => {
            const el = document.getElementById('counterValue');
            if (el && data.total_audits) {
                el.textContent = data.total_audits.toLocaleString('ru-RU');
            }
        })
        .catch(() => {
            const el = document.getElementById('counterValue');
            if (el) el.textContent = '1 400+';
        });
}

// ============================================================================
// FILE UPLOAD
// ============================================================================

function initDragDrop() {
    const zone = document.getElementById('dropZone');
    if (!zone) return;

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
}

function initFileInput() {
    const input = document.getElementById('fileInput');
    if (input) {
        input.addEventListener('change', () => {
            if (input.files.length) handleFile(input.files[0]);
        });
    }
}

function handleFile(file) {
    const errEl = document.getElementById('uploadError');
    const nameEl = document.getElementById('fileName');
    errEl.classList.add('hidden');

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx'].includes(ext)) {
        errEl.textContent = 'Поддерживаются только PDF и DOCX';
        errEl.classList.remove('hidden');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        errEl.textContent = 'Файл слишком большой (максимум 5 МБ)';
        errEl.classList.remove('hidden');
        return;
    }

    selectedFile = file;
    nameEl.textContent = file.name;
    nameEl.classList.remove('hidden');

    openEmailModal();
}

// ============================================================================
// EMAIL MODAL
// ============================================================================

function openEmailModal() {
    document.getElementById('emailModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('emailInput').focus(), 100);
    initTurnstile();
}

function closeEmailModal() {
    document.getElementById('emailModal').classList.add('hidden');
}

function initTurnstile() {
    if (!TURNSTILE_SITE_KEY || turnstileReady) return;
    turnstileReady = true;

    // Блокируем кнопку до прохождения капчи
    document.getElementById('btnGetResult').disabled = true;

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=renderTurnstile';
    script.async = true;
    document.head.appendChild(script);
}

window.renderTurnstile = function () {
    const container = document.getElementById('turnstileContainer');
    if (!container || !window.turnstile) return;

    window.turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'dark',
        callback: function (token) {
            turnstileToken = token;
            document.getElementById('btnGetResult').disabled = false;
        },
    });
};

// ============================================================================
// SUBMIT
// ============================================================================

async function submitAudit() {
    const emailInput = document.getElementById('emailInput');
    const emailErr = document.getElementById('emailError');
    const btn = document.getElementById('btnGetResult');

    userEmail = emailInput.value.trim().toLowerCase();
    emailErr.classList.add('hidden');

    if (!userEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
        emailErr.textContent = 'Введите корректный email';
        emailErr.classList.remove('hidden');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('email', userEmail);
    if (turnstileToken) formData.append('captcha_token', turnstileToken);

    try {
        const resp = await fetch(`${API_BASE_URL}/api/audit/analyze`, {
            method: 'POST',
            body: formData,
        });

        const data = await resp.json();

        if (resp.status === 409 && data.error === 'email_already_used') {
            showAlreadyUsed(data);
            return;
        }

        if (!resp.ok) {
            emailErr.textContent = data.detail || 'Произошла ошибка';
            emailErr.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = 'Получить разбор';
            return;
        }

        closeEmailModal();
        showLoading(data);

    } catch (e) {
        emailErr.textContent = 'Ошибка сети. Попробуйте ещё раз.';
        emailErr.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Получить разбор';
    }
}

// ============================================================================
// LOADING ANIMATION
// ============================================================================

function showLoading(data) {
    document.getElementById('stepUpload').classList.add('hidden');
    document.getElementById('stepLoading').classList.remove('hidden');

    const phases = [
        { text: 'Анализируем структуру резюме...', pct: 15 },
        { text: 'Проверяем ключевые слова для алгоритма hh.ru...', pct: 40 },
        { text: 'Оцениваем первое впечатление рекрутера...', pct: 70 },
        { text: 'Готовим рекомендации...', pct: 90 },
    ];

    const textEl = document.getElementById('loadingText');
    const barEl = document.getElementById('progressBar');
    const interval = 2500;

    phases.forEach((phase, i) => {
        setTimeout(() => {
            textEl.textContent = phase.text;
            barEl.style.width = phase.pct + '%';
        }, i * interval);
    });

    const minDelay = phases.length * interval;
    setTimeout(() => {
        barEl.style.width = '100%';
        setTimeout(() => showResult(data.result, data.total_audits), 500);
    }, minDelay);
}

// ============================================================================
// RESULT
// ============================================================================

function showResult(result, totalAudits) {
    document.getElementById('stepLoading').classList.add('hidden');
    document.getElementById('stepResult').classList.remove('hidden');

    // Score
    document.getElementById('scoreValue').textContent = result.score || '?';
    document.getElementById('verdictText').textContent = result.verdict || '';

    // Recruiter impression
    if (result.recruiter_first_impression) {
        const block = document.getElementById('impressionBlock');
        block.classList.remove('hidden');
        document.getElementById('impressionText').textContent = result.recruiter_first_impression;
    }

    // Critical issues
    const container = document.getElementById('issuesBlock');
    container.innerHTML = '';
    (result.critical_issues || []).forEach(issue => {
        const card = document.createElement('div');
        card.className = 'issue-card glass-card rounded-xl p-4 shadow-lg';
        card.innerHTML = `
            <h4 class="text-sm font-semibold text-on-surface flex items-center gap-2">
                <span class="material-symbols-outlined text-base" style="font-size:16px;color:#f59e0b">warning</span>
                ${esc(issue.title)}
            </h4>
            ${issue.quote ? `<p class="text-on-surface-variant text-xs mt-2 italic">&laquo;${esc(issue.quote)}&raquo;</p>` : ''}
            ${issue.why_it_hurts ? `<p class="text-on-surface-variant text-xs mt-1">${esc(issue.why_it_hurts)}</p>` : ''}
            ${issue.fix ? `<p class="text-primary text-xs mt-2 font-medium">${esc(issue.fix)}</p>` : ''}
        `;
        container.appendChild(card);
    });

    // HH Algorithm
    if (result.hh_algo_problems) {
        const block = document.getElementById('algoBlock');
        block.classList.remove('hidden');
        document.getElementById('algoText').textContent = result.hh_algo_problems;
    }

    // Update counter
    if (totalAudits) {
        const el = document.getElementById('counterValue');
        if (el) el.textContent = totalAudits.toLocaleString('ru-RU');
    }
}

// ============================================================================
// ALREADY USED / CTA
// ============================================================================

function showAlreadyUsed(data) {
    closeEmailModal();
    document.getElementById('stepUpload').classList.add('hidden');

    const stepResult = document.getElementById('stepResult');
    stepResult.classList.remove('hidden');
    stepResult.innerHTML = `
        <div class="glass-card rounded-2xl p-8 shadow-2xl text-center fade-in">
            <span class="material-symbols-outlined text-4xl text-primary mb-3" style="display:block">check_circle</span>
            <h2 class="text-lg font-bold text-on-surface">Вы уже получили бесплатный разбор резюме</h2>
            <p class="text-on-surface-variant text-sm mt-3 leading-relaxed">
                Чтобы Аврора писала сопроводительные письма под каждую вакансию
                и отправляла до 20 откликов в день — попробуйте бесплатно.
            </p>
            <a href="${data.cta_url || '/auth/?source=audit'}"
               class="btn-primary block mt-6 py-3.5 rounded-xl text-white font-semibold text-center text-sm">
                Попробовать 10 откликов бесплатно
            </a>
        </div>
    `;
}

function goToRegister() {
    const email = encodeURIComponent(userEmail);
    window.location.href = `/auth/?email=${email}&source=audit`;
}

// ============================================================================
// UTILS
// ============================================================================

function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}
