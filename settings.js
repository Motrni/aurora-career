/* 
   AURORA CAREER SETTINGS - PROPRIETARY CODE 
   (c) 2024-2025 Aurora Career. All rights reserved.
*/

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

const API_BASE_URL = window.AuroraSession
    ? window.AuroraSession.getApiBase()
    : ((window.location.hostname.includes('twc1.net') || window.location.hostname.includes('aurora-develop'))
        ? 'https://api.aurora-develop.ru'
        : 'https://api.aurora-career.ru');

// State
let initialSettings = {};
let allIndustries = [];
let allAreas = [];
let flatAreaMap = {};
let currentSelectedIds = new Set();
let currentSelectedAreaIds = new Set();
let messageId = null;
window.BOT_USERNAME = "Aurora_Career_Bot";
window.USER_FIRST_NAME = "Кандидат";
window.USER_CONTACT_TG = null;
window.USER_PHONE = null;
window.USER_ENRICHMENT_DONE = false;
// Пол кандидата для согласования родовых окончаний в сопроводительных.
// USER_GENDER:        'male' | 'female' | null
// USER_GENDER_SOURCE: 'manual' (юзер выбрал сам) | 'detected' (snapshot/эвристика) | 'unknown'
window.USER_GENDER = null;
window.USER_GENDER_SOURCE = 'unknown';

// Auth State (Hybrid: JWT or Legacy HMAC)
let authMode = null; // 'jwt' or 'legacy'
let legacyUserId = null;
let legacySign = null;

async function authFetch(url, options = {}) {
    options.credentials = 'include';
    let resp = await fetch(url, options);

    if (resp.status === 403) {
        var subStatus = resp.headers.get('X-Sub-Status');
        if (subStatus) {
            window.location.href = '/cabinet/';
            return null;
        }
    }

    if (resp.status === 409) {
        const body = await resp.clone().json().catch(() => ({}));
        if (body.detail && body.detail.includes('re-authentication')) {
            window.location.href = '/reauth/';
            return resp;
        }
    }

    if (resp.status === 401 && authMode === 'jwt' && window.AuroraSession) {
        const ok = await AuroraSession.refreshNow();
        if (ok) {
            resp = await fetch(url, options);
        } else {
            window.location.href = '/auth/';
            return resp;
        }
    }
    return resp;
}

// Loading Flags
let isIndustriesLoaded = false;
let isAreasLoaded = false;
let isSettingsLoaded = false;
let vacancyCheckTimeout = null;
/** Debounce для /api/check_vacancies: обычные поля vs набор Boolean-строки. */
const VACANCY_DEBOUNCE_DEFAULT_MS = 700;
const VACANCY_DEBOUNCE_BOOLEAN_MS = 1600;

document.addEventListener("DOMContentLoaded", async () => {
    // Show Skeleton immediately
    toggleGlobalLoading(true);

    // 0. Initialize Theme
    initializeTheme();

    // 1. Initialize UI Components (Tag Inputs)
    window.tagsInclude = new TagInput("tagsIncludeContainer", "keywordsIncludeInput", "keywordsIncludeConfirm");
    window.tagsExclude = new TagInput("tagsExcludeContainer", "keywordsExcludeInput", "keywordsExcludeConfirm");
    window.ignoredEmployers = new IgnoredEmployersInput(
        "ignoredEmployerInput",
        "ignoredEmployerApplyBtn",
        "ignoredEmployersChips",
        "ignoredEmployersError"
    );

    // 1. URL Params (Legacy auth fallback)
    const urlParams = new URLSearchParams(window.location.search);
    legacyUserId = urlParams.get('user_id');
    legacySign = urlParams.get('sign');
    messageId = urlParams.get('message_id'); // Optional

    if (urlParams.get('profile_ready') === '1') {
        const banner = document.getElementById('profileReadyBanner');
        if (banner) banner.classList.remove('hidden');
    }

    // 2. Hybrid Auth: Try JWT first, auto-refresh, fallback to legacy
    try {
        let meResponse = await fetch(`${API_BASE_URL}/api/auth/me`, {
            method: "GET", credentials: "include",
        });

        if (meResponse.status === 401 && window.AuroraSession) {
            const ok = await AuroraSession.refreshNow();
            if (ok) {
                meResponse = await fetch(`${API_BASE_URL}/api/auth/me`, {
                    method: "GET", credentials: "include",
                });
            }
        }

        if (meResponse.ok) {
            const meData = await meResponse.json();
            if (meData.status === "ok") {
                if (meData.need_reauth) {
                    window.location.href = '/reauth/';
                    return;
                }
                if (meData.current_step && meData.current_step.startsWith('onboarding_')
                    && meData.current_step !== 'onboarding_settings'
                    && meData.current_step !== 'onboarding_save_pending') {
                    window.location.href = '/onboarding/';
                    return;
                }
                if (!meData.has_access) {
                    window.location.href = '/cabinet/';
                    return;
                }
                authMode = 'jwt';
                window._currentStep = meData.current_step || null;

                // Guard: если нет профиля у активного резюме — кидаем в кабинет
                try {
                    const resumesResp = await fetch(`${API_BASE_URL}/api/resumes/list`, { credentials: 'include' });
                    if (resumesResp.ok) {
                        const resumesData = await resumesResp.json();
                        const active = (resumesData.resumes || []).find(r => r.is_active);
                        if (active && !active.has_custom_query) {
                            window.location.href = '/cabinet/';
                            return;
                        }
                    }
                } catch (_) {}

                console.log("[Auth] JWT session active");
            }
        }
    } catch (e) {
        console.log("[Auth] JWT check failed, will use legacy");
    }

    // Fallback to legacy if JWT not available
    if (!authMode) {
        if (!legacyUserId || !legacySign) {
            window.location.href = '/auth/';
            return;
        }
        authMode = 'legacy';
        console.log("[Auth] Using legacy HMAC auth");
    }

    if (authMode === 'jwt' && window.AuroraSession) {
        window.AuroraSession.startPing();
    }

    // 2. Salary Logic
    const salaryInput = document.getElementById("salaryInput");
    const noSalaryCheckbox = document.getElementById("noSalaryCheckbox");

    noSalaryCheckbox.addEventListener("change", (e) => {
        clearSalaryFieldValidation();
        if (e.target.checked) {
            salaryInput.value = "";
            salaryInput.disabled = true;
            salaryInput.placeholder = "Не указана";
            salaryInput.style.borderColor = "#333";
        } else {
            salaryInput.disabled = false;
            salaryInput.placeholder = "Сумма в ₽";
            salaryInput.style.borderColor = "";
            salaryInput.focus();
        }
    });

    // 3. Search Logic
    const searchInput = document.getElementById("industrySearch");
    searchInput.addEventListener("input", (e) => {
        const text = e.target.value.trim().toLowerCase();
        filterIndustryTree(text);
    });

    // 3.1 Region Search
    const regionSearch = document.getElementById("regionSearch");
    if (regionSearch) {
        regionSearch.addEventListener("input", (e) => {
            const text = e.target.value.trim().toLowerCase();
            filterAreaTree(text);
        });
    }

    // 4. Load Data (Parallel)
    loadIndustriesDict();
    loadAreasDict();
    loadSettings();

    // 6. Save Logic (Search)
    document.getElementById("saveBtn").addEventListener("click", async () => {
        if (_isOnboardingMode) {
            await handleOnboardingSave();
            return;
        }
        await saveSettings();
    });

    // 6.1 Save Logic (Response)
    document.getElementById("saveResponseBtn").addEventListener("click", async () => {
        try {
            await saveResponseSettings();
        } catch (e) {
            showError("Ошибка при сохранении настроек откликов. " + e.message);
        }
    });

    // 7. Query Mode Logic
    window.switchQueryMode = (mode) => {
        const simpleBtn = document.getElementById("modeSimpleBtn");
        const advancedBtn = document.getElementById("modeAdvancedBtn");
        const simpleEditor = document.getElementById("simpleQueryEditor");
        const advancedEditor = document.getElementById("advancedQueryEditor");

        if (mode === 'simple') {
            simpleBtn.classList.add('active');
            advancedBtn.classList.remove('active');
            simpleEditor.style.display = 'block';
            advancedEditor.style.display = 'none';
        } else {
            simpleBtn.classList.remove('active');
            advancedBtn.classList.add('active');
            simpleEditor.style.display = 'none';
            advancedEditor.style.display = 'block';
        }
        updateSaveButtonState();
        checkVacancies();
    };

    // [NEW] 8. Bind Events for Vacancy Counter
    // Salary
    salaryInput.addEventListener("input", () => {
        clearSalaryFieldValidation();
        checkVacancies();
    });
    noSalaryCheckbox.addEventListener("change", () => checkVacancies());

    // Experience
    document.getElementById("experienceSelect").addEventListener("change", () => checkVacancies());

    // Schedule
    document.querySelectorAll("#scheduleContainer input").forEach(cb => {
        cb.addEventListener("change", () => {
            checkVacancies();
            syncScheduleVisualState();
            updateSaveButtonState();
        });
    });

    // Boolean: сразу помечаем форму «грязной» (через initDirtyStateTracking на textarea),
    // запрос счётчика к hh — с увеличенным debounce, не на каждый символ с тем же таймингом что у зарплаты.
    document.getElementById("booleanQueryInput").addEventListener("input", () => {
        checkVacancies(VACANCY_DEBOUNCE_BOOLEAN_MS);
    });

    // 9. Propagate auth params to Responses nav links
    if (authMode === 'legacy' && legacyUserId && legacySign) {
        const suffix = `?user_id=${legacyUserId}&sign=${legacySign}`;
        const navResp = document.getElementById('nav-responses');
        const navRespMob = document.getElementById('nav-responses-mobile');
        if (navResp) navResp.href = `/responses/${suffix}`;
        if (navRespMob) navRespMob.href = `/responses/${suffix}`;
    }

    window.addEventListener('scroll', requestSaveBarStateUpdate, { passive: true });
    window.addEventListener('resize', () => {
        refreshSaveBarBaseTop();
        requestSaveBarStateUpdate();
    });

}); // End of DOMContentLoaded

function dismissProfileReadyBanner() {
    const banner = document.getElementById('profileReadyBanner');
    if (banner) banner.classList.add('hidden');
    const url = new URL(window.location);
    url.searchParams.delete('profile_ready');
    window.history.replaceState({}, '', url.toString());
}

// --- TAB SWITCHING LOGIC ---
window.switchMainTab = function (tabName) {
    // 1. Update Tabs UI
    document.querySelectorAll('.segment-option').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-btn-${tabName}`).classList.add('active');

    // 2. Update Content Visibility
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    // Force hide/show (display: none handled by CSS class but ensure ID matches)
    if (tabName === 'search') {
        document.getElementById('searchSettingsTab').classList.add('active');
    } else {
        document.getElementById('responseSettingsTab').classList.add('active');
    }
    updateSaveBarFloatingState();
}

// --- DIRTY STATE LOGIC ---
let initialSearchState = null;
const SEARCH_SAVE_LABEL_DIRTY = "Сохранить";
const SEARCH_SAVE_LABEL_CLEAN = "Нет изменений";
let _hasSearchChanges = false;
let _saveBarBaseTop = null;
let _saveBarDocked = false;
let _saveBarRaf = null;

/** Режим запроса: у кнопок нет data-mode, ориентируемся на класс active. */
function getSearchQueryMode() {
    const advancedBtn = document.getElementById("modeAdvancedBtn");
    if (advancedBtn && advancedBtn.classList.contains("active")) {
        return "advanced";
    }
    return "simple";
}

function serializeSearchForm() {
    // Collects all data from Search Tab inputs
    let ignoredEmployersSerialized = "";
    if (window.ignoredEmployers) {
        const sortedPairs = Object.entries(window.ignoredEmployers.getEmployers())
            .sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
        ignoredEmployersSerialized = sortedPairs
            .map(([employerId, employerName]) => `${employerId}:${employerName}`)
            .join("|");
    }

    const booleanEl = document.getElementById("booleanQueryInput");
    const booleanQuery = booleanEl ? booleanEl.value : "";

    const data = {
        salary: document.getElementById('salaryInput').value,
        noSalary: document.getElementById('noSalaryCheckbox').checked,
        experience: document.getElementById('experienceSelect').value,
        industry: Array.from(currentSelectedIds || []).sort().join(','), // Assuming Set
        area: Array.from(currentSelectedAreaIds || []).sort().join(','),

        // Keywords
        keywordsInclude: window.tagsInclude ? window.tagsInclude.getTags().sort().join(',') : '',
        keywordsExclude: window.tagsExclude ? window.tagsExclude.getTags().sort().join(',') : '',

        queryMode: getSearchQueryMode(),
        booleanQuery,

        // Schedule
        schedule: Array.from(document.querySelectorAll('#scheduleContainer input:checked')).map(el => el.value).sort().join(','),
        ignoredEmployers: ignoredEmployersSerialized
    };
    return JSON.stringify(data);
}

function updateSaveButtonState() {
    const saveBtn = document.getElementById('saveBtn');
    if (!initialSearchState) return;

    const currentState = serializeSearchForm();
    _hasSearchChanges = currentState !== initialSearchState;

    if (_isOnboardingMode) {
        _styleOnboardingSaveBtn();
        updateSaveBarFloatingState();
        return;
    }

    if (_hasSearchChanges) {
        saveBtn.disabled = false;
        saveBtn.innerText = SEARCH_SAVE_LABEL_DIRTY;
        saveBtn.style.opacity = "1";
    } else {
        saveBtn.disabled = true;
        saveBtn.innerText = SEARCH_SAVE_LABEL_CLEAN;
        saveBtn.style.opacity = "0.5";
    }
    updateSaveBarFloatingState();
}


// ============================================================
// RESPONSE TAB — DIRTY STATE TRACKING + STICKY ACTION BAR
// (полный аналог логики search-таба, чтобы юзер не терял изменения)
// ============================================================
let initialResponseState = null;
const RESPONSE_SAVE_LABEL_DIRTY = "Сохранить настройки откликов";
const RESPONSE_SAVE_LABEL_CLEAN = "Нет изменений";
let _hasResponseChanges = false;
let _responseBarBaseTop = null;
let _responseBarDocked = false;

function serializeResponseForm() {
    // Собираем стейт всех полей вкладки "Настройки откликов" в JSON-строку.
    // Сравниваем при сохранении и при каждом input/change.
    const useDefaultEl  = document.getElementById("clUseDefaultCheckbox");
    const headerEl      = document.getElementById("clHeaderInput");
    const footerEl      = document.getElementById("clFooterInput");
    const styleEl       = document.getElementById("clStyleSelect");
    const tgEl          = document.getElementById("contactTgInput");
    const phoneEl       = document.getElementById("contactPhoneInput");
    const hideEl        = document.getElementById("contactHideCheckbox");
    const genderEl      = document.getElementById("contactGenderSelect");

    const data = {
        cl_use_default: useDefaultEl ? !!useDefaultEl.checked : true,
        cl_header:      headerEl ? headerEl.value.trim() : "",
        cl_footer:      footerEl ? footerEl.value.trim() : "",
        cl_style:       styleEl ? styleEl.value : "classic",
        contact_tg:     tgEl ? tgEl.value.trim() : "",
        phone:          phoneEl ? phoneEl.value.trim() : "",
        hide_contacts:  hideEl ? !!hideEl.checked : false,
        gender:         genderEl ? (genderEl.value || "") : "",
    };
    return JSON.stringify(data);
}

function captureResponseInitialState() {
    // Вызывается при загрузке настроек (после _applyContactDataUI) и после
    // успешного сохранения — чтобы sticky bar спрятался и beforeunload не дёргал.
    initialResponseState = serializeResponseForm();
    _hasResponseChanges = false;
}

function updateResponseSaveButtonState() {
    const saveBtn = document.getElementById('saveResponseBtn');
    if (!saveBtn || initialResponseState === null) return;

    const currentState = serializeResponseForm();
    _hasResponseChanges = currentState !== initialResponseState;

    if (_hasResponseChanges) {
        saveBtn.disabled = false;
        saveBtn.innerText = RESPONSE_SAVE_LABEL_DIRTY;
        saveBtn.style.opacity = "1";
    } else {
        saveBtn.disabled = true;
        saveBtn.innerText = RESPONSE_SAVE_LABEL_CLEAN;
        saveBtn.style.opacity = "0.5";
    }
    updateSaveBarFloatingState();
}

function updateAllDirtyStates() {
    // Универсальный listener для всех input/select/textarea на странице.
    // Каждый из updateXxxSaveButtonState внутри сам решит, его ли это поле
    // (по сравнению serialize-результата).
    if (typeof updateSaveButtonState === 'function')         updateSaveButtonState();
    if (typeof updateResponseSaveButtonState === 'function') updateResponseSaveButtonState();
}

function _adjustSaveBarAboveFooter(actionBar) {
    const footer = document.querySelector('footer');
    if (!footer || !actionBar) return;

    const footerRect = footer.getBoundingClientRect();
    const barRect = actionBar.getBoundingClientRect();
    const defaultBottom = window.innerWidth >= 768 ? 18 : 14;
    const gap = 12;

    // Footer is visible in viewport
    if (footerRect.top < window.innerHeight) {
        const needed = window.innerHeight - footerRect.top + gap;
        actionBar.style.bottom = Math.max(defaultBottom, needed) + 'px';
    } else {
        actionBar.style.bottom = '';
    }
}

// ===== STICKY ACTION BARS — общая логика для обоих табов =====
//
// Контракт: для каждого таба (search/response) поддерживаем свой actionBar
// и пару состояний (_saveBarBaseTop / _saveBarDocked) — отдельно, потому что
// они scroll-зависимые и могут быть разной высоты.
//
// Главная функция updateSaveBarFloatingState() решает, какой именно
// бар должен быть виден сейчас (по активной вкладке) и применяет к нему
// is-floating / is-docked / clean.

function _detectActiveTab() {
    const searchTab = document.getElementById('searchSettingsTab');
    if (searchTab && searchTab.classList.contains('active')) return 'search';
    const responseTab = document.getElementById('responseSettingsTab');
    if (responseTab && responseTab.classList.contains('active')) return 'response';
    return null;
}

function _clearActionBar(barId) {
    const bar = document.getElementById(barId);
    if (!bar) return;
    bar.classList.remove('is-floating', 'is-docked');
    bar.style.bottom = '';
}

function _applyFloatingToBar(bar, baseTopRefSetter, isDockedFlag, dockedSetter, scrollWindow) {
    // bar — элемент actionBar
    // baseTopRefSetter() — функция возвращающая текущий _xxxBarBaseTop (для null-init)
    // isDockedFlag — текущий флаг для этого бара
    // dockedSetter(bool) — функция выставляющая этот флаг
    // scrollWindow — { baseTop } объект, чтобы перерасчитать base top
    if (scrollWindow.baseTop === null) {
        // Расчёт baseTop делается извне (refreshXxxBarBaseTop); здесь просто пропускаем
        return isDockedFlag;
    }
    const viewportBottom = window.scrollY + window.innerHeight;
    let docked = isDockedFlag;
    if (docked) {
        if (viewportBottom < (scrollWindow.baseTop - 72)) docked = false;
    } else {
        if (viewportBottom >= (scrollWindow.baseTop + 24)) docked = true;
    }

    bar.classList.toggle('is-floating', !docked);
    bar.classList.toggle('is-docked', docked);
    document.body.classList.toggle('has-floating-save', !docked);
    if (!docked) _adjustSaveBarAboveFooter(bar);
    dockedSetter(docked);
    return docked;
}

function updateSaveBarFloatingState() {
    const searchBar   = document.getElementById('searchActionBar');
    const responseBar = document.getElementById('responseActionBar');
    const hint        = document.getElementById('onboardingSaveHint');

    const activeTab = _detectActiveTab();

    // Бары неактивных вкладок — гасим всегда.
    if (activeTab !== 'search') _clearActionBar('searchActionBar');
    if (activeTab !== 'response') _clearActionBar('responseActionBar');

    // --- Onboarding: всегда показываем search bar как floating ---
    if (_isOnboardingMode && searchBar) {
        _saveBarDocked = false;
        searchBar.classList.add('is-floating');
        searchBar.classList.remove('is-docked');
        document.body.classList.add('has-floating-save');
        _adjustSaveBarAboveFooter(searchBar);
        if (hint) hint.classList.remove('hidden');
        return;
    }
    if (hint) hint.classList.add('hidden');

    // --- Активный SEARCH таб ---
    if (activeTab === 'search' && searchBar) {
        if (_hasSearchChanges) {
            if (_saveBarBaseTop === null) refreshSaveBarBaseTop();
            const scrollWindow = { baseTop: _saveBarBaseTop };
            _applyFloatingToBar(
                searchBar,
                () => _saveBarBaseTop,
                _saveBarDocked,
                (v) => { _saveBarDocked = v; },
                scrollWindow,
            );
        } else {
            _saveBarDocked = false;
            _clearActionBar('searchActionBar');
            document.body.classList.remove('has-floating-save');
        }
        return;
    }

    // --- Активный RESPONSE таб ---
    if (activeTab === 'response' && responseBar) {
        if (_hasResponseChanges) {
            if (_responseBarBaseTop === null) refreshResponseBarBaseTop();
            const scrollWindow = { baseTop: _responseBarBaseTop };
            _applyFloatingToBar(
                responseBar,
                () => _responseBarBaseTop,
                _responseBarDocked,
                (v) => { _responseBarDocked = v; },
                scrollWindow,
            );
        } else {
            _responseBarDocked = false;
            _clearActionBar('responseActionBar');
            document.body.classList.remove('has-floating-save');
        }
        return;
    }

    // Никакой активной вкладки нет — всё гасим
    document.body.classList.remove('has-floating-save');
}

function _refreshBarBaseTop(barId, baseTopGetter, baseTopSetter) {
    const actionBar = document.getElementById(barId);
    if (!actionBar) return;

    const hadFloating = actionBar.classList.contains('is-floating');
    const hadDocked = actionBar.classList.contains('is-docked');
    if (hadFloating || hadDocked) {
        actionBar.classList.remove('is-floating', 'is-docked');
        document.body.classList.remove('has-floating-save');
    }

    const rect = actionBar.getBoundingClientRect();
    baseTopSetter(rect.top + window.scrollY);

    if (hadDocked) {
        actionBar.classList.add('is-docked');
    } else if (hadFloating) {
        actionBar.classList.add('is-floating');
        document.body.classList.add('has-floating-save');
    }
}

function refreshSaveBarBaseTop() {
    _refreshBarBaseTop('searchActionBar', () => _saveBarBaseTop, (v) => { _saveBarBaseTop = v; });
}

function refreshResponseBarBaseTop() {
    _refreshBarBaseTop('responseActionBar', () => _responseBarBaseTop, (v) => { _responseBarBaseTop = v; });
}

function requestSaveBarStateUpdate() {
    if (_saveBarRaf !== null) return;
    _saveBarRaf = requestAnimationFrame(() => {
        _saveBarRaf = null;
        updateSaveBarFloatingState();
    });
}

function syncScheduleVisualState() {
    document.querySelectorAll('#scheduleContainer input[type="checkbox"]').forEach(cb => {
        const label = cb.closest('label');
        if (!label) return;
        if (cb.checked) {
            label.style.background = 'rgba(90,48,208,0.1)';
            label.style.borderColor = 'rgba(90,48,208,0.3)';
            label.style.color = '#ccbeff';
        } else {
            label.style.background = '';
            label.style.borderColor = '';
            label.style.color = '';
        }
    });
}

function initDirtyStateTracking() {
    initialSearchState = serializeSearchForm();
    captureResponseInitialState();
    updateSaveButtonState();
    updateResponseSaveButtonState();

    // Единый listener на все input/select/textarea — каждая updateXxx внутри
    // сама определит "своё" ли это поле через сравнение serialize-результата.
    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('input', updateAllDirtyStates);
        input.addEventListener('change', updateAllDirtyStates);
    });

    // MutationObserver for tags or custom components
    // (Simpler: Just call updateSaveButtonState when specific things change)
}

// Hook into existing logic
// We need to call initDirtyStateTracking() AFTER settings are loaded.


// --- TAG INPUT CLASS ---
class TagInput {
    constructor(containerId, inputId, confirmBtnId) {
        this.container = document.getElementById(containerId);
        this.input = document.getElementById(inputId);
        this.confirmBtn = confirmBtnId ? document.getElementById(confirmBtnId) : null;
        this.tags = [];

        if (!this.container || !this.input) return;

        this.input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                this._commitInput();
            }
            if (e.key === "Backspace" && this.input.value === "" && this.tags.length > 0) {
                this.removeTag(this.tags.length - 1);
            }
        });

        if (this.confirmBtn) {
            this.confirmBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._commitInput();
            });
        }

        // Show/hide confirm button based on input content
        this.input.addEventListener("input", () => {
            if (this.confirmBtn) {
                if (this.input.value.trim()) {
                    this.confirmBtn.classList.add("visible");
                } else {
                    this.confirmBtn.classList.remove("visible");
                }
            }
        });

        this.container.addEventListener("click", (e) => {
            if (e.target !== this.confirmBtn) {
                this.input.focus();
            }
        });
    }

    _commitInput() {
        const val = this.input.value.trim();
        if (val) {
            this.addTag(val);
            this.input.value = "";
        }
        if (this.confirmBtn) {
            this.confirmBtn.classList.remove("visible");
        }
        this.input.focus();
    }

    addTag(text) {
        // Prevent duplicates
        if (this.tags.includes(text)) return;
        this.tags.push(text);
        this.render();
        checkVacancies(); // Trigger check
        updateSaveButtonState(); // [FIX] Trigger dirty state
    }

    removeTag(index) {
        this.tags.splice(index, 1);
        this.render();
        checkVacancies(); // Trigger check
        updateSaveButtonState(); // [FIX] Trigger dirty state
    }

    setTags(tagsArray) {
        this.tags = tagsArray || [];
        this.render();
    }

    getTags() {
        return this.tags;
    }

    render() {
        // Clear current tags (keep input)
        // We remove all .tag elements
        const existingTags = this.container.querySelectorAll(".tag");
        existingTags.forEach(t => t.remove());

        // Render new tags
        this.tags.forEach((tagText, index) => {
            const tag = document.createElement("div");
            tag.className = "tag";
            tag.innerHTML = `
                <span>${escapeHtml(tagText)}</span>
                <div class="tag-remove" onclick="this.parentNode.remove(); window.${this === window.tagsInclude ? 'tagsInclude' : 'tagsExclude'}.removeTag(${index})">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </div>
            `;
            // Insert before input
            this.container.insertBefore(tag, this.input);
        });
    }
}

class IgnoredEmployersInput {
    constructor(inputId, applyBtnId, chipsContainerId, errorId) {
        this.input = document.getElementById(inputId);
        this.applyBtn = document.getElementById(applyBtnId);
        this.chipsContainer = document.getElementById(chipsContainerId);
        this.errorBox = document.getElementById(errorId);
        this.errorRail = document.getElementById("ignoredEmployersErrorRail");
        this.employers = {};
        this.isResolving = false;
        this._lastAddedId = null;
        this._errorHideTimeout = null;
        this._errorClearTimeout = null;
        this._inputFlashTimeout = null;
        this._transientErrorMs = 3800;
        this._railCollapseMs = 450;

        if (!this.input || !this.applyBtn || !this.chipsContainer || !this.errorBox) {
            return;
        }

        this.applyBtn.addEventListener("click", () => this.applyInput());
        this.input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                this.applyInput();
            }
        });

        this.render();
    }

    getEmployers() {
        return { ...this.employers };
    }

    _extractEmployerIdForDuplicateCheck(raw) {
        const value = String(raw || "").trim();
        if (!value) return null;
        if (/^\d+$/.test(value)) return value;
        const match = value.match(/(?:^|[/])employer\/(\d+)(?:[/?#]|$)/i);
        return match ? match[1] : null;
    }

    _clearFeedbackTimers() {
        if (this._errorHideTimeout) {
            clearTimeout(this._errorHideTimeout);
            this._errorHideTimeout = null;
        }
        if (this._errorClearTimeout) {
            clearTimeout(this._errorClearTimeout);
            this._errorClearTimeout = null;
        }
        if (this._inputFlashTimeout) {
            clearTimeout(this._inputFlashTimeout);
            this._inputFlashTimeout = null;
        }
    }

    _flashInput(kind) {
        if (!this.input) return;
        this.input.classList.remove("ignored-input-flash-error", "ignored-input-flash-success");
        void this.input.offsetWidth;
        if (kind === "error") {
            this.input.classList.add("ignored-input-flash-error");
            // Класс снимается в одном кадре с закрытием рельсы (showTransientError / hideError), без отдельного таймера.
        } else if (kind === "success") {
            this.input.classList.add("ignored-input-flash-success");
            this._inputFlashTimeout = setTimeout(() => {
                this.input.classList.remove("ignored-input-flash-success");
                this._inputFlashTimeout = null;
            }, 2000);
        }
    }

    showTransientError(message) {
        if (!this.errorBox) return;
        this._clearFeedbackTimers();

        if (this.errorRail) {
            this.errorRail.classList.remove("is-visible");
            void this.errorRail.offsetHeight;
        }

        this.errorBox.textContent = message;
        if (this.errorRail) {
            this.errorRail.classList.add("is-visible");
        } else {
            this.errorBox.classList.remove("hidden");
        }

        this._flashInput("error");

        this._errorHideTimeout = setTimeout(() => {
            this._errorHideTimeout = null;
            if (this.input) {
                this.input.classList.remove("ignored-input-flash-error");
            }
            if (this.errorRail) {
                this.errorRail.classList.remove("is-visible");
                this._errorClearTimeout = setTimeout(() => {
                    this._errorClearTimeout = null;
                    if (this.errorRail && !this.errorRail.classList.contains("is-visible")) {
                        this.errorBox.textContent = "";
                    }
                }, this._railCollapseMs);
            } else {
                this.errorBox.textContent = "";
                this.errorBox.classList.add("hidden");
            }
        }, this._transientErrorMs);
    }

    setEmployers(rawEmployers) {
        this.employers = {};
        if (rawEmployers && typeof rawEmployers === "object" && !Array.isArray(rawEmployers)) {
            Object.entries(rawEmployers).forEach(([employerId, employerName]) => {
                const normalizedId = String(employerId).trim();
                if (!normalizedId) return;
                this.employers[normalizedId] = employerName == null ? "" : String(employerName).trim();
            });
        }
        this.hideError();
        this.render();
    }

    async applyInput() {
        if (this.isResolving || !this.input || !this.applyBtn) return;

        const value = this.input.value.trim();
        if (!value) {
            this.showTransientError("Введите ID или ссылку на работодателя.");
            return;
        }

        if (Object.keys(this.employers).length >= 20) {
            this.showTransientError("Достигнут лимит: не более 20 работодателей.");
            return;
        }

        const duplicateId = this._extractEmployerIdForDuplicateCheck(value);
        if (duplicateId && Object.prototype.hasOwnProperty.call(this.employers, duplicateId)) {
            this.showTransientError("Работодатель уже есть в списке");
            return;
        }

        this.isResolving = true;
        const originalBtnText = this.applyBtn.textContent;
        this.applyBtn.disabled = true;
        this.applyBtn.textContent = "Проверяю...";

        try {
            const payload = { value };
            if (authMode === "legacy" && legacyUserId && legacySign) {
                payload.user_id = parseInt(legacyUserId);
                payload.sign = legacySign;
            }

            const response = await authFetch(`${API_BASE_URL}/api/ignored-employers/resolve`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.status !== "ok") {
                const message = data.detail || data.error || "Не удалось проверить работодателя.";
                throw new Error(message);
            }

            const employerId = String(data.id || "").trim();
            const employerName = String(data.name || "").trim();
            if (!employerId) {
                throw new Error("Некорректный ID работодателя.");
            }

            if (Object.prototype.hasOwnProperty.call(this.employers, employerId)) {
                this.showTransientError("Работодатель уже есть в списке");
                return;
            }

            this.hideError();
            this.employers[employerId] = employerName || employerId;
            this._lastAddedId = employerId;
            this.input.value = "";
            this._flashInput("success");
            this.render();
            updateSaveButtonState();
        } catch (error) {
            this.showTransientError(error.message || "Ошибка проверки работодателя.");
        } finally {
            this.isResolving = false;
            this.applyBtn.disabled = false;
            this.applyBtn.textContent = originalBtnText || "Применить";
        }
    }

    removeEmployer(employerId) {
        delete this.employers[employerId];
        this.render();
        updateSaveButtonState();
    }

    hideError() {
        this._clearFeedbackTimers();
        if (this.input) {
            this.input.classList.remove("ignored-input-flash-error", "ignored-input-flash-success");
        }
        if (!this.errorBox) return;
        if (this.errorRail) {
            this.errorRail.classList.remove("is-visible");
            this.errorBox.textContent = "";
        } else {
            this.errorBox.textContent = "";
            this.errorBox.classList.add("hidden");
        }
    }

    render() {
        if (!this.chipsContainer) return;
        const lastAdded = this._lastAddedId;
        this._lastAddedId = null;

        this.chipsContainer.innerHTML = "";

        const entries = Object.entries(this.employers).sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
        if (entries.length === 0) {
            const placeholder = document.createElement("span");
            placeholder.className = "text-xs text-on-surface-variant/70";
            placeholder.textContent = "Исключений пока нет";
            this.chipsContainer.appendChild(placeholder);
            return;
        }

        entries.forEach(([employerId, employerName]) => {
            const chip = document.createElement("div");
            chip.className = "tag";
            if (lastAdded && employerId === lastAdded) {
                chip.classList.add("tag--ignored-enter");
                chip.addEventListener(
                    "animationend",
                    () => chip.classList.remove("tag--ignored-enter"),
                    { once: true }
                );
            }

            const text = document.createElement("span");
            text.textContent = employerName || employerId;
            chip.appendChild(text);

            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "tag-remove";
            removeButton.innerHTML = "&times;";
            removeButton.setAttribute("aria-label", `Удалить ${employerName || employerId}`);
            removeButton.onclick = () => this.removeEmployer(employerId);
            chip.appendChild(removeButton);

            this.chipsContainer.appendChild(chip);
        });
    }
}


// --- HELPER FUNCTIONS FOR QUERY ---

function buildBooleanQuery(incStr, excStr) {
    // incStr: "Python, Django" -> NAME:(Python OR Django)
    const incList = incStr.split(',').map(s => s.trim()).filter(s => s);
    const excList = excStr.split(',').map(s => s.trim()).filter(s => s);

    let parts = [];

    if (incList.length > 0) {
        const joined = incList.map(w => w.includes(' ') ? `"${w}"` : w).join(' OR ');
        parts.push(`NAME:(${joined})`);
    }

    if (excList.length > 0) {
        const joined = excList.map(w => w.includes(' ') ? `"${w}"` : w).join(' OR ');
        parts.push(`NAME:(NOT (${joined}))`);
    }

    return parts.join(' AND ');
}

function parseBooleanQuery(query) {
    // Reverse logic: NAME:(A OR B) AND NAME:(NOT (C))
    // Very basic parser.
    try {
        let included = [];
        let excluded = [];

        // Split by AND (assuming top level AND)
        const parts = query.split(' AND ');

        parts.forEach(part => {
            part = part.trim();
            if (part.includes('NAME:(NOT (')) {
                // Excluded
                const match = part.match(/NAME:\(NOT \((.*)\)\)/);
                if (match && match[1]) {
                    excluded.push(...extractWords(match[1]));
                }
            } else if (part.includes('NAME:(')) {
                // Included
                const match = part.match(/NAME:\((.*)\)/);
                if (match && match[1]) {
                    included.push(...extractWords(match[1]));
                }
            }
        });

        return { included, excluded };
    } catch (e) {
        console.error("Parse error", e);
        return null; // Failed to parse (complex query)
    }
}

function extractWords(innerStr) {
    // "Python OR Django OR \"Machine Learning\""
    // Simple split by OR
    return innerStr.split(' OR ').map(w => w.trim().replace(/"/g, "").replace(/^\(/, "").replace(/\)$/, ""));
}

// ----------------------------------

// [NEW] VACANCY COUNTER LOGIC
function checkVacancies(debounceMs = VACANCY_DEBOUNCE_DEFAULT_MS) {
    // Debounce
    if (vacancyCheckTimeout) clearTimeout(vacancyCheckTimeout);

    // UI Loading state
    const countSpan = document.getElementById("vacancyCountValue");
    if (countSpan) countSpan.innerText = "...";

    const counterPanel = document.getElementById("vacancyCounterPanel");
    if (counterPanel) counterPanel.style.display = "block";

    const statusDot = document.getElementById("vacancyStatusDot");
    const statusText = document.getElementById("vacancyStatusText");
    if (statusDot) { statusDot.className = "flex h-2 w-2 rounded-full bg-amber-400 animate-pulse"; }
    if (statusText) { statusText.innerText = "Обновление"; }

    vacancyCheckTimeout = setTimeout(async () => {
        try {
            // 1. Collect Data (Similar to saveSettings)
            const salaryInput = document.getElementById("salaryInput");
            const experienceSelect = document.getElementById("experienceSelect");

            // Salary
            let salary = null;
            if (!salaryInput.disabled && salaryInput.value) {
                salary = parseInt(salaryInput.value);
            }

            // Experience
            let experience = experienceSelect.value;

            // Query Mode & Text
            const simpleBtn = document.getElementById("modeSimpleBtn");
            const isSimple = simpleBtn.classList.contains("active");
            let queryMode = isSimple ? 'simple' : 'advanced';

            let text = "";
            let keywordsData = null;
            let booleanDraft = null;

            if (isSimple) {
                const inc = window.tagsInclude ? window.tagsInclude.getTags() : [];
                const exc = window.tagsExclude ? window.tagsExclude.getTags() : [];
                keywordsData = { included: inc, excluded: exc };
                if (inc.length > 0) {
                    const joined = inc.map(w => w.includes(' ') ? `"${w}"` : w).join(' OR ');
                    text = `NAME:(${joined})`;
                    if (exc.length > 0) {
                        const excJoined = exc.map(w => w.includes(' ') ? `"${w}"` : w).join(' OR ');
                        text += ` AND NOT NAME:(${excJoined})`;
                    }
                }
            } else {
                const rawBool = document.getElementById("booleanQueryInput").value;
                if (rawBool) {
                    text = rawBool;
                    booleanDraft = rawBool;
                }
            }

            // Areas
            let searchAreas = Array.from(currentSelectedAreaIds).map(Number);

            // Schedule
            let workFormats = [];
            document.querySelectorAll("#scheduleContainer input:checked").forEach(cb => {
                workFormats.push(cb.value);
            });

            // Industry
            const industry = finalizeIdsFromSet();

            // 2. Build payload — Hybrid auth
            const payload = {
                text: text,
                salary: salary,
                experience: experience,
                search_areas: searchAreas,
                work_formats: workFormats,
                industry: industry,
                query_mode: queryMode,
                keywords_data: keywordsData,
                boolean_draft: booleanDraft
            };
            
            // Add legacy auth if needed
            if (authMode === 'legacy' && legacyUserId && legacySign) {
                payload.user_id = parseInt(legacyUserId);
                payload.sign = legacySign;
            }

            const response = await authFetch(`${API_BASE_URL}/api/check_vacancies`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (data.status === "ok") {
                if (countSpan) countSpan.innerText = data.found.toLocaleString('ru-RU');

                const linkBtn = document.getElementById("vacancyLink");
                if (linkBtn) {
                    linkBtn.href = data.url;
                    linkBtn.style.display = "inline-block";
                }

                const sDot = document.getElementById("vacancyStatusDot");
                const sText = document.getElementById("vacancyStatusText");
                if (sDot) { sDot.className = "flex h-2 w-2 rounded-full bg-emerald-400"; }
                if (sText) { sText.innerText = "Обновлено"; }
            } else {
                console.error("Check vacancies error:", data.message);
                if (countSpan) countSpan.innerText = "?";
                const sDot = document.getElementById("vacancyStatusDot");
                const sText = document.getElementById("vacancyStatusText");
                if (sDot) { sDot.className = "flex h-2 w-2 rounded-full bg-red-400"; }
                if (sText) { sText.innerText = "Ошибка"; }
            }

        } catch (e) {
            console.error(e);
            const countSpan = document.getElementById("vacancyCountValue");
            if (countSpan) countSpan.innerText = "—";
            const sDot = document.getElementById("vacancyStatusDot");
            const sText = document.getElementById("vacancyStatusText");
            if (sDot) { sDot.className = "flex h-2 w-2 rounded-full bg-red-400"; }
            if (sText) { sText.innerText = "Ошибка"; }
        }
    }, debounceMs);
}

function toggleGlobalLoading(isLoading) {
    const skeleton = document.getElementById("globalSkeleton");
    const content = document.getElementById("mainContent");

    if (isLoading) {
        if (skeleton) skeleton.style.display = "block";
        if (content) content.style.display = "none";
    } else {
        if (skeleton) skeleton.style.display = "none";
        if (content) content.style.display = "block";
    }
}

async function loadIndustriesDict() {
    try {
        const resp = await fetch('industries.json');
        if (!resp.ok) throw new Error("Industries failed");
        allIndustries = await resp.json();
    } catch (e) {
        console.error(e);
        showError("Не удалось загрузить справочник отраслей.");
    } finally {
        isIndustriesLoaded = true;
        tryInitTree();
    }
}

async function loadSettings() {
    try {
        // Build URL based on auth mode
        let url = `${API_BASE_URL}/api/settings/get`;
        if (authMode === 'legacy' && legacyUserId && legacySign) {
            url += `?user_id=${legacyUserId}&sign=${legacySign}`;
        }
        
        const response = await authFetch(url, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        });

        const data = await response.json();
        if (data.status !== "ok") {
            throw new Error(data.error || "Неизвестная ошибка");
        }

        if (data.bot_username) {
            window.BOT_USERNAME = data.bot_username;
        }
        if (data.first_name) {
            window.USER_FIRST_NAME = data.first_name;
        }

        // Contact data
        window.USER_CONTACT_TG = data.contact_tg || null;
        window.USER_PHONE = data.phone || null;
        window.USER_ENRICHMENT_DONE = data.contact_enrichment_done || false;
        // Пол: 'male' / 'female' / null. Источник: 'manual' / 'detected' / 'unknown'.
        window.USER_GENDER = (data.gender === 'male' || data.gender === 'female') ? data.gender : null;
        window.USER_GENDER_SOURCE = data.gender_source || 'unknown';
        _applyContactDataUI();

        const settings = data.settings;

        // --- Apply UI State ---

        // Salary
        const salaryInput = document.getElementById("salaryInput");
        const noSalaryCheckbox = document.getElementById("noSalaryCheckbox");

        if (!settings.salary || settings.salary === 0) {
            noSalaryCheckbox.checked = true;
            salaryInput.value = "";
            salaryInput.disabled = true;
            salaryInput.placeholder = "Не указана";
        } else {
            noSalaryCheckbox.checked = false;
            salaryInput.value = settings.salary;
            salaryInput.disabled = false;
            salaryInput.placeholder = "Сумма в ₽";
        }

        // Experience
        if (settings.experience) {
            document.getElementById("experienceSelect").value = settings.experience;
        }

        // Region
        currentSelectedAreaIds.clear();

        let areaIds = [];
        let rawAreas = settings.search_areas;

        if (typeof rawAreas === 'string') {
            try { rawAreas = JSON.parse(rawAreas); } catch (e) { rawAreas = []; }
        }

        if (rawAreas && Array.isArray(rawAreas)) {
            // New format
            areaIds = rawAreas;
        } else if (settings.search_area && settings.search_area !== 113) {
            // Legacy fallback
            areaIds = [settings.search_area];
        }

        areaIds.forEach(id => currentSelectedAreaIds.add(String(id)));
        updateSelectedRegionsSummary();

        // Schedule (Work Formats)
        let scheduleData = settings.work_formats || settings.search_schedule;
        document.querySelectorAll('#scheduleContainer input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
        });

        if (scheduleData) {
            let sched = [];
            if (typeof scheduleData === 'string') {
                try { sched = JSON.parse(scheduleData); } catch (e) { sched = []; }
            } else if (Array.isArray(scheduleData)) {
                sched = scheduleData;
            }

            sched.forEach(val => {
                let cb = document.querySelector(`#scheduleContainer input[value="${val.toUpperCase()}"]`);
                if (!cb) cb = document.querySelector(`#scheduleContainer input[value="${val}"]`);
                if (cb) cb.checked = true;
            });
        }
        syncScheduleVisualState();

        // Query Mode & Boolean Logic
        const mode = settings.query_mode || 'simple';

        // Load Keywords -> Tags
        let keywordsData = settings.keywords_data;
        if (typeof keywordsData === 'string') {
            try {
                keywordsData = JSON.parse(keywordsData);
            } catch (e) {
                console.error("Failed to parse keywords_data", e);
                keywordsData = { included: [], excluded: [] };
            }
        }
        const keys = keywordsData || { included: [], excluded: [] };
        if (window.tagsInclude) window.tagsInclude.setTags(keys.included || []);
        if (window.tagsExclude) window.tagsExclude.setTags(keys.excluded || []);
        if (window.ignoredEmployers) {
            window.ignoredEmployers.setEmployers(settings.ignored_employers || {});
        }

        // Load Boolean Draft or Custom Query
        let boolVal = settings.boolean_draft || settings.custom_query || "";
        document.getElementById("booleanQueryInput").value = boolVal;

        // Init Mode UI
        if (window.switchQueryMode) {
            window.switchQueryMode(mode);
        }

        // Industries
        let inds = settings.industry || [];
        if (typeof inds === 'string') {
            try { inds = JSON.parse(inds); } catch (e) { inds = []; }
        }

        currentSelectedIds = new Set(inds.map(String));

        // [NEW] Cover Letter
        const clUseDefault = settings.cl_use_default !== false; // Default True if undefined
        const clHeader = settings.cl_header || "";
        const clFooter = settings.cl_footer || "";
        const clStyle = settings.cl_style || "classic";

        const clCheckbox = document.getElementById("clUseDefaultCheckbox");
        if (clCheckbox) {
            clCheckbox.checked = clUseDefault;
            document.getElementById("clHeaderInput").value = clHeader;
            document.getElementById("clFooterInput").value = clFooter;

            const clStyleSelect = document.getElementById("clStyleSelect");
            if (clStyleSelect) {
                clStyleSelect.value = clStyle;
                clStyleSelect.addEventListener("change", updateCLPreview);
            }

            toggleCLFields(!clUseDefault);
            updateCLPreview(); // Initial render

            // Add listeners
            clCheckbox.onchange = (e) => {
                toggleCLFields(!e.target.checked);
                updateCLPreview();
            };

            document.getElementById("clHeaderInput").addEventListener("input", updateCLPreview);
            document.getElementById("clFooterInput").addEventListener("input", updateCLPreview);
        }

        // Dirty State Tracking moved to tryInitTree() for correct timing

    } catch (e) {
        showError("Не удалось загрузить настройки. " + e.message);
    } finally {
        isSettingsLoaded = true;
        tryInitTree();
    }
}

async function loadAreasDict() {
    try {
        const resp = await fetch('areas_tree.json');
        if (!resp.ok) throw new Error("Areas failed");
        allAreas = await resp.json();

        // Build flat map for fast lookup (Store FULL OBJECT)
        flatAreaMap = {};
        function buildFlatMap(list) {
            list.forEach(a => {
                flatAreaMap[String(a.id)] = a; // Store Object
                if (a.areas) buildFlatMap(a.areas);
            });
        }
        buildFlatMap(allAreas);
    } catch (e) {
        console.error(e);
        const tree = document.getElementById("regionTree");
        if (tree) tree.innerHTML = '<div style="padding:20px; text-align:center; color:red;">Ошибка загрузки регионов</div>';
    } finally {
        isAreasLoaded = true;
        tryInitTree();
    }
}

function tryInitTree() {
    if (isIndustriesLoaded && isSettingsLoaded && isAreasLoaded) {
        initIndustryTree();
        initAreaTree();
        toggleGlobalLoading(false);
        setTimeout(() => {
            refreshSaveBarBaseTop();
            refreshResponseBarBaseTop();
            initDirtyStateTracking();
            checkVacancies();
            if (window._currentStep === 'onboarding_settings') {
                activateOnboardingMode();
            } else if (window._currentStep === 'onboarding_save_pending') {
                activateOnboardingSavePending();
            }
            requestSaveBarStateUpdate();
        }, 100);
        initAccountSection();
    }
}

function initIndustryTree() {
    const container = document.getElementById("industryTree");
    container.innerHTML = "";

    if (!allIndustries || allIndustries.length === 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">Нет данных</div>';
        return;
    }

    const chevronSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

    // --- SORTING LOGIC ---
    // 1. Helper to check if category is "selected" (has any ID in set)
    const isCatSelected = (cat) => {
        if (currentSelectedIds.has(String(cat.id))) return true;
        return (cat.industries || []).some(sub => currentSelectedIds.has(String(sub.id)));
    };

    // 2. Sort: Selected First, then Alphabetical
    const sortedIndustries = [...allIndustries].sort((a, b) => {
        const selA = isCatSelected(a);
        const selB = isCatSelected(b);
        if (selA && !selB) return -1;
        if (!selA && selB) return 1;
        return a.name.localeCompare(b.name);
    });

    sortedIndustries.forEach(category => {
        const catIdStr = String(category.id);
        const catDiv = document.createElement("div");
        catDiv.className = "ind-category";
        catDiv.dataset.name = category.name.toLowerCase();

        const headerDiv = document.createElement("div");
        headerDiv.className = "ind-header";

        const toggleIcon = document.createElement("div");
        toggleIcon.className = "toggle-icon";
        toggleIcon.innerHTML = chevronSvg;

        const catCheckbox = document.createElement("input");
        catCheckbox.type = "checkbox";
        catCheckbox.className = "custom-checkbox";
        catCheckbox.value = catIdStr;
        catCheckbox.dataset.type = "parent";

        const catLabel = document.createElement("span");
        catLabel.className = "ind-label";
        catLabel.innerText = category.name;

        headerDiv.appendChild(toggleIcon);
        headerDiv.appendChild(catCheckbox);
        headerDiv.appendChild(catLabel);
        catDiv.appendChild(headerDiv);

        const childrenContainer = document.createElement("div");
        childrenContainer.className = "ind-children";

        const children = category.industries || [];
        children.forEach(sub => {
            const subIdStr = String(sub.id);
            const subDiv = document.createElement("div");
            subDiv.className = "ind-sub";
            subDiv.dataset.name = sub.name.toLowerCase();

            const subCheckbox = document.createElement("input");
            subCheckbox.type = "checkbox";
            subCheckbox.className = "custom-checkbox";
            subCheckbox.value = subIdStr;
            subCheckbox.dataset.type = "child";
            subCheckbox.dataset.parentId = catIdStr;

            if (currentSelectedIds.has(subIdStr) || currentSelectedIds.has(catIdStr)) {
                subCheckbox.checked = true;
            }

            const subLabel = document.createElement("span");
            subLabel.className = "ind-sub-label";
            subLabel.innerText = sub.name;

            subLabel.onclick = () => { subCheckbox.checked = !subCheckbox.checked; updateState(true); checkVacancies(); updateSaveButtonState(); };
            subDiv.appendChild(subCheckbox);
            subDiv.appendChild(subLabel);
            childrenContainer.appendChild(subDiv);

            subCheckbox.addEventListener("change", () => {
                updateState(true);
                checkVacancies();
                updateSaveButtonState();
            });
        });

        catDiv.appendChild(childrenContainer);
        container.appendChild(catDiv);

        updateParentCheckboxState(catCheckbox, childrenContainer);
        if (catCheckbox.checked && !catCheckbox.indeterminate) currentSelectedIds.add(catIdStr);


        const toggle = () => {
            childrenContainer.classList.toggle("open");
            toggleIcon.classList.toggle("expanded");
        };

        toggleIcon.onclick = (e) => { e.stopPropagation(); toggle(); };
        catLabel.onclick = toggle;

        catCheckbox.addEventListener("change", () => {
            const childrenInputs = childrenContainer.querySelectorAll("input[data-type='child']");
            childrenInputs.forEach(ch => ch.checked = catCheckbox.checked);
            updateState(true);
            checkVacancies();
            updateSaveButtonState();
        });

        function updateState(isInteraction = false) {
            updateParentCheckboxState(catCheckbox, childrenContainer);

            const childrenInputs = childrenContainer.querySelectorAll("input[data-type='child']");
            childrenInputs.forEach(ch => {
                if (ch.checked) currentSelectedIds.add(ch.value);
                else currentSelectedIds.delete(ch.value);
            });

            if (catCheckbox.checked && !catCheckbox.indeterminate) {
                currentSelectedIds.add(catIdStr);
            } else {
                currentSelectedIds.delete(catIdStr);
            }

            if (isInteraction) {
                const isSelected = catCheckbox.checked || catCheckbox.indeterminate;
                if (isSelected) {
                    container.prepend(catDiv);
                    container.scrollTop = 0;
                }
            }
        }
    });
}

function filterIndustryTree(text) {
    const container = document.getElementById("industryTree");
    const categories = container.querySelectorAll(".ind-category");

    categories.forEach(catDiv => {
        const catName = catDiv.dataset.name;
        const childrenContainer = catDiv.querySelector(".ind-children");
        const childrenDivs = childrenContainer.querySelectorAll(".ind-sub");
        const toggleIcon = catDiv.querySelector(".toggle-icon");

        let isCatMatch = catName.includes(text);
        let hasVisibleChild = false;

        childrenDivs.forEach(subDiv => {
            const subName = subDiv.dataset.name;
            if (isCatMatch || subName.includes(text)) {
                subDiv.style.display = "flex";
                hasVisibleChild = true;
            } else {
                subDiv.style.display = "none";
            }
        });

        if (isCatMatch || hasVisibleChild) {
            catDiv.style.display = "block";
            if (text.length > 0) {
                childrenContainer.classList.add("open");
                toggleIcon.classList.add("expanded");
            }
        } else {
            catDiv.style.display = "none";
        }
    });
}

function updateParentCheckboxState(parentCheckbox, childrenContainer) {
    const children = Array.from(childrenContainer.querySelectorAll("input"));
    if (children.length === 0) return;

    const checkedCount = children.filter(c => c.checked).length;

    if (checkedCount === 0) {
        parentCheckbox.checked = false;
        parentCheckbox.indeterminate = false;
    } else if (checkedCount === children.length) {
        parentCheckbox.checked = true;
        parentCheckbox.indeterminate = false;
    } else {
        parentCheckbox.checked = false;
        parentCheckbox.indeterminate = true;
    }
}

function finalizeIdsFromSet() {
    const result = [];
    const set = currentSelectedIds;

    allIndustries.forEach(cat => {
        const catIdStr = String(cat.id);
        const children = cat.industries || [];
        if (children.length === 0) return;

        const allChildrenIds = children.map(c => String(c.id));
        const selectedChildrenIds = allChildrenIds.filter(id => set.has(id));

        if (selectedChildrenIds.length === allChildrenIds.length) {
            result.push(catIdStr);
        } else {
            if (set.has(catIdStr)) {
                result.push(catIdStr);
            } else {
                result.push(...selectedChildrenIds);
            }
        }
    });

    return result;
}

function clearSalaryFieldValidation() {
    const salarySection = document.getElementById("salarySection");
    const salaryInput = document.getElementById("salaryInput");
    const inline = document.getElementById("salaryFieldError");
    const errDiv = document.getElementById("errorMsg");
    if (salarySection) salarySection.classList.remove("salary-field-error");
    if (salaryInput) {
        salaryInput.classList.remove("salary-input-error");
    }
    if (inline) {
        inline.classList.add("hidden");
        inline.textContent = "";
    }
    if (errDiv) errDiv.style.display = "none";
}

function scrollToSalarySection() {
    const el = document.getElementById("salarySection");
    if (!el) return;
    const headerOffset = window.matchMedia("(min-width: 768px)").matches ? 128 : 104;
    const y = el.getBoundingClientRect().top + window.scrollY - headerOffset;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}

function showSalaryValidationError(msg) {
    showError(msg);
    const salarySection = document.getElementById("salarySection");
    const salaryInput = document.getElementById("salaryInput");
    const inline = document.getElementById("salaryFieldError");
    if (inline) {
        inline.textContent = msg;
        inline.classList.remove("hidden");
    }
    if (salarySection) salarySection.classList.add("salary-field-error");
    if (salaryInput && !salaryInput.disabled) {
        salaryInput.classList.add("salary-input-error");
    }
    scrollToSalarySection();
    window.setTimeout(() => {
        if (salaryInput && !salaryInput.disabled) {
            try {
                salaryInput.focus({ preventScroll: true });
            } catch (_) {
                salaryInput.focus();
            }
        }
    }, 350);
}

async function saveSettings() {
    const salaryInput = document.getElementById("salaryInput");
    const noSalaryCheckbox = document.getElementById("noSalaryCheckbox");

    clearSalaryFieldValidation();

    let salary = null;

    if (!noSalaryCheckbox.checked) {
        let val = salaryInput.value.trim();
        if (val === "") {
            showSalaryValidationError("Введите сумму или поставьте галочку 'Не указывать'");
            return false;
        }
        salary = parseInt(val);
        if (isNaN(salary) || salary < 0) {
            showSalaryValidationError("Зарплата должна быть положительным числом!");
            return false;
        }
        if (salary > 100000000) {
            showSalaryValidationError("Зарплата не может превышать 100 млн ₽");
            return false;
        }
    }

    const experience = document.getElementById("experienceSelect").value;
    const selectedIndustries = finalizeIdsFromSet();

    // Schedule
    const scheduleInputs = document.querySelectorAll("#scheduleContainer input:checked");
    const selectedSchedule = Array.from(scheduleInputs).map(cb => cb.value);

    // Query Data
    const isAdvanced = document.getElementById("modeAdvancedBtn").classList.contains("active");
    const queryMode = isAdvanced ? 'advanced' : 'simple';

    // Tags
    const incStr = window.tagsInclude ? window.tagsInclude.getTags().join(", ") : "";
    const excStr = window.tagsExclude ? window.tagsExclude.getTags().join(", ") : "";

    const keywordsData = {
        included: window.tagsInclude ? window.tagsInclude.getTags() : [],
        excluded: window.tagsExclude ? window.tagsExclude.getTags() : []
    };

    const booleanDraft = document.getElementById("booleanQueryInput").value;

    // Logic: What is the final custom_query?
    let finalQuery = "";
    if (isAdvanced) {
        finalQuery = booleanDraft;
    } else {
        finalQuery = buildBooleanQuery(incStr, excStr);
    }

    // Collect Data — Hybrid auth
    const payload = {
        salary: salary,
        experience: experience,
        industry: selectedIndustries,
        search_areas: Array.from(currentSelectedAreaIds).map(Number),
        work_formats: selectedSchedule,
        query_mode: queryMode,
        keywords: keywordsData,
        boolean_draft: booleanDraft,
        custom_query: finalQuery,
        ignored_employers: window.ignoredEmployers ? window.ignoredEmployers.getEmployers() : {},
        message_id: messageId ? parseInt(messageId) : null
    };
    
    // Add legacy auth if needed
    if (authMode === 'legacy' && legacyUserId && legacySign) {
        payload.user_id = parseInt(legacyUserId);
        payload.sign = legacySign;
    }

    const saveBtn = document.getElementById("saveBtn");
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Сохраняю...";
        saveBtn.style.background = "";
    }

    try {
        const response = await authFetch(`${API_BASE_URL}/api/settings/update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.status !== "ok") {
            throw new Error(data.error || "Ошибка сервера");
        }

        if (saveBtn) {
            saveBtn.textContent = "Сохранено!";
            saveBtn.style.background = "#4caf50";
        }

        initialSearchState = serializeSearchForm();
        _hasSearchChanges = false;

        initialSettings = {
            salary: salary,
            experience: experience,
            industry: selectedIndustries,
            work_formats: selectedSchedule
        };

        const errDiv = document.getElementById("errorMsg");
        if (errDiv) errDiv.style.display = "none";

        setTimeout(() => {
            if (saveBtn) saveBtn.style.background = "";
            if (!_isOnboardingMode) {
                updateSaveButtonState();
            }
        }, 2000);

        return true;
    } catch (e) {
        console.error(e);
        if (saveBtn) {
            saveBtn.textContent = "Ошибка";
            saveBtn.style.background = "#ff4d4d";
            saveBtn.disabled = false;
            setTimeout(() => {
                saveBtn.style.background = "";
                if (_isOnboardingMode) {
                    saveBtn.textContent = "Сохранить и начать поиск";
                } else {
                    updateSaveButtonState();
                }
            }, 3000);
        }
        showError(e.message || "Ошибка при сохранении.");
        return false;
    }
}

// (Duplicate code removed)



function showError(msg) {
    const errDiv = document.getElementById("errorMsg");
    errDiv.innerText = msg;
    errDiv.style.display = "block";
}

// --- OPTIMIZED AREA TREE LOGIC ---

// Cache for search results to avoid lag
let areaSearchTimeout = null;

function renderSelectedRegions() {
    const listContainer = document.getElementById("selectedRegionsList");
    const summary = document.getElementById("selectedRegionsSummary");

    if (!listContainer || !summary) return;

    listContainer.innerHTML = "";
    const count = currentSelectedAreaIds.size;

    summary.innerText = `Выбрано: ${count}`;

    if (count === 0) {
        listContainer.innerHTML = '<span style="color: #666; font-size: 13px; padding: 4px;">Ничего не выбрано (поиск по всему миру)</span>';
        return;
    }

    currentSelectedAreaIds.forEach(idStr => {
        const item = flatAreaMap[idStr];
        const name = item ? item.name : `ID: ${idStr}`; // Fallback if name not found

        const chip = document.createElement("div");
        chip.className = "region-chip";
        chip.style.background = "#333";
        chip.style.color = "#fff";
        chip.style.padding = "4px 8px";
        chip.style.borderRadius = "12px";
        chip.style.fontSize = "12px";
        chip.style.display = "flex";
        chip.style.alignItems = "center";
        chip.style.border = "1px solid #444";

        const text = document.createElement("span");
        text.innerText = name;

        const close = document.createElement("span");
        close.innerHTML = "&times;";
        close.style.marginLeft = "6px";
        close.style.cursor = "pointer";
        close.style.color = "#aaa";
        close.style.fontWeight = "bold";
        close.onmouseover = () => close.style.color = "#fff";
        close.onmouseout = () => close.style.color = "#aaa";

        close.onclick = () => {
            currentSelectedAreaIds.delete(idStr);
            renderSelectedRegions();
            const checkbox = document.querySelector(`#regionTree input[value="${idStr}"]`);
            if (checkbox) checkbox.checked = false;
            updateSaveButtonState();
        };

        chip.appendChild(text);
        chip.appendChild(close);
        listContainer.appendChild(chip);
    });
}

function clearAllRegions() {
    currentSelectedAreaIds.clear();
    renderSelectedRegions();
    const checkboxes = document.querySelectorAll("#regionTree input:checked");
    checkboxes.forEach(cb => cb.checked = false);
    updateSaveButtonState();
}

function updateSelectedRegionsSummary() {
    // Replaced by renderSelectedRegions, but kept for compatibility if called elsewhere
    renderSelectedRegions();
}

// --- FLAT REGION LIST LOGIC (PAGINATED) ---

let currentRegionLimit = 30;
let displayedRegions = [];

function initAreaTree() {
    // Reset limit on init
    currentRegionLimit = 30;
    renderRegionList();
    renderSelectedRegions(); // [FIX] Re-render chips now that names are loaded
}

function renderRegionList() {
    const container = document.getElementById("regionTree");
    if (!container) return;

    // 1. Prepare Data: All Selected Objects + All Root Objects
    // use a Map to ensure uniqueness by ID
    const itemsMap = new Map();

    // A. Add ALL Selected items (from flat map)
    currentSelectedAreaIds.forEach(id => {
        const item = flatAreaMap[String(id)];
        if (item) itemsMap.set(String(item.id), item);
    });

    // B. Add Root items (Countries) from allAreas
    if (allAreas) {
        allAreas.forEach(area => {
            if (!itemsMap.has(String(area.id))) {
                itemsMap.set(String(area.id), area);
            }
        });
    }

    // Convert to array
    let combinedItems = Array.from(itemsMap.values());

    // 2. Filter via Search
    const searchInput = document.getElementById("regionSearch");
    const searchText = searchInput ? searchInput.value.toLowerCase().trim() : "";

    if (searchText) {
        // Search in ALL flat items
        combinedItems = Object.values(flatAreaMap).filter(item =>
            item.name.toLowerCase().includes(searchText)
        );
    }

    // 3. Sort: Selected First, then Alphabetical
    combinedItems.sort((a, b) => {
        const selA = currentSelectedAreaIds.has(String(a.id));
        const selB = currentSelectedAreaIds.has(String(b.id));

        if (selA && !selB) return -1;
        if (!selA && selB) return 1;
        return a.name.localeCompare(b.name);
    });

    // 4. Paginate
    const totalCount = combinedItems.length;
    const itemsToShow = combinedItems.slice(0, currentRegionLimit);

    // 5. Render
    container.innerHTML = "";

    if (itemsToShow.length === 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">Ничего не найдено</div>';
        return;
    }

    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexDirection = "column";

    itemsToShow.forEach(area => {
        const row = document.createElement("label");
        row.className = "region-flat-row";
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.padding = "8px 12px";
        row.style.cursor = "pointer";
        row.style.borderBottom = "1px solid #222";
        row.onmouseover = () => row.style.background = "#252525";
        row.onmouseout = () => row.style.background = "transparent";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "custom-checkbox";
        cb.style.marginRight = "10px";
        cb.value = String(area.id);
        if (currentSelectedAreaIds.has(String(area.id))) {
            cb.checked = true;
        }

        cb.onchange = () => {
            if (cb.checked) currentSelectedAreaIds.add(String(area.id));
            else currentSelectedAreaIds.delete(String(area.id));

            renderSelectedRegions();
            updateSaveButtonState();
        };

        const nameSpan = document.createElement("span");
        nameSpan.innerText = area.name;
        nameSpan.style.color = "#ececec";
        nameSpan.style.fontSize = "0.95rem";

        row.appendChild(cb);
        row.appendChild(nameSpan);
        list.appendChild(row);
    });

    container.appendChild(list);

    // 6. Show More Button
    if (totalCount > currentRegionLimit) {
        const btnMore = document.createElement("div");
        btnMore.innerText = `Показать еще (${totalCount - currentRegionLimit})`;
        btnMore.style.padding = "10px";
        btnMore.style.textAlign = "center";
        btnMore.style.color = "#a962ff";
        btnMore.style.cursor = "pointer";
        btnMore.style.fontSize = "0.9rem";
        btnMore.style.background = "#1a1a1a";
        btnMore.style.marginTop = "4px";

        btnMore.onmouseover = () => btnMore.style.background = "#222";
        btnMore.onmouseout = () => btnMore.style.background = "#1a1a1a";

        btnMore.onclick = () => {
            currentRegionLimit += 30;
            renderRegionList(); // Re-render with new limit
        };

        container.appendChild(btnMore);
    }
}

// Override Filter to use render
function filterAreaTree(text) {
    // Reset limit on search
    currentRegionLimit = 30;
    renderRegionList();
}

function updateFlatListCheckbox(id, checked) {
    const cb = document.querySelector(`#regionTree input[value="${id}"]`);
    if (cb) cb.checked = checked;
}



// --- SAVE RESPONSE SETTINGS ---
async function saveResponseSettings() {
    const saveBtn = document.getElementById("saveResponseBtn");
    const originalText = saveBtn.innerText;

    try {
        saveBtn.disabled = true;
        saveBtn.innerText = "Сохраняю...";

        // Collect Data — Hybrid auth
        const hideContacts = document.getElementById("contactHideCheckbox").checked;
        const genderSelect = document.getElementById("contactGenderSelect");
        const genderVal = genderSelect ? genderSelect.value : "";

        // [DEBUG] Сразу видно в DevTools Console если что-то не так с gender:
        // если genderVal === '' при визуально выбранном "Женский" → кэш JS / битый select.
        console.debug("[saveResponseSettings] genderSelect found:", !!genderSelect,
                      "value:", JSON.stringify(genderVal),
                      "USER_GENDER:", window.USER_GENDER,
                      "USER_GENDER_SOURCE:", window.USER_GENDER_SOURCE);

        const payload = {
            cl_use_default: document.getElementById("clUseDefaultCheckbox").checked,
            cl_header: document.getElementById("clHeaderInput").value.trim(),
            cl_footer: document.getElementById("clFooterInput").value.trim(),
            cl_style: document.getElementById("clStyleSelect").value,
            contact_tg: hideContacts ? "" : (document.getElementById("contactTgInput").value.trim() || ""),
            phone: hideContacts ? "" : (document.getElementById("contactPhoneInput").value.trim() || ""),
        };

        // Пол: 'male' / 'female' — отправляем явно. Placeholder (value="") не шлём,
        // чтобы случайно не сбросить значение в БД.
        if (genderVal === 'male' || genderVal === 'female') {
            payload.gender = genderVal;
        }

        console.debug("[saveResponseSettings] final payload:", payload);

        // Add legacy auth if needed
        if (authMode === 'legacy' && legacyUserId && legacySign) {
            payload.user_id = parseInt(legacyUserId);
            payload.sign = legacySign;
        }

        const response = await authFetch(`${API_BASE_URL}/api/save_response_settings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        // FastAPI HTTPException возвращает {"detail": "..."} с не-2xx статусом.
        // Pydantic-валидаторы — массив errors с сообщениями.
        let data = null;
        try {
            data = await response.json();
        } catch (_) { /* not json — игнорируем */ }

        if (!response.ok) {
            const detail = data && (
                (typeof data.detail === 'string' && data.detail) ||
                (Array.isArray(data.detail) && data.detail.map(e => e.msg).join("; ")) ||
                data.error
            );
            throw new Error(detail || `HTTP ${response.status}`);
        }

        if (data && data.status === "ok") {
            saveBtn.innerText = "Сохранено!";
            saveBtn.style.background = "#4caf50";

            setTimeout(() => {
                saveBtn.style.background = ""; // Reset
                // Только теперь фиксируем новое "чистое" состояние и
                // обновляем кнопку — это спрячет sticky bar и сбросит
                // подсказку beforeunload. Если бы сделали раньше,
                // updateResponseSaveButtonState мгновенно затёр бы
                // "Сохранено!" на "Нет изменений".
                if (typeof captureResponseInitialState === 'function') {
                    captureResponseInitialState();
                }
                if (typeof updateResponseSaveButtonState === 'function') {
                    updateResponseSaveButtonState();
                }
            }, 2000);
        } else {
            throw new Error((data && data.error) || "Ошибка сервера");
        }

    } catch (e) {
        console.error("[saveResponseSettings] failed:", e);
        saveBtn.innerText = "Ошибка";
        saveBtn.style.background = "#ff4d4d";
        // Покажем понятный alert юзеру с реальным текстом ошибки
        // (а не просто красную кнопку — он не поймёт что не так).
        try {
            alert("Не удалось сохранить настройки откликов:\n\n" + (e && e.message ? e.message : e));
        } catch (_) { /* alert недоступен — окей */ }
        setTimeout(() => {
            saveBtn.innerText = "Сохранить настройки откликов";
            saveBtn.style.background = "";
            saveBtn.disabled = false;
        }, 3000);
    }
}


function toggleCLFields(show) {
    const div = document.getElementById("clCustomFields");
    if (div) {
        div.style.display = show ? "block" : "none";
    }
}

// --- CONTACT DATA UI ---
function _applyContactDataUI() {
    const tgInput = document.getElementById("contactTgInput");
    const phoneInput = document.getElementById("contactPhoneInput");
    const hideCheckbox = document.getElementById("contactHideCheckbox");
    const sourceHint = document.getElementById("contactSourceHint");
    const notFoundHint = document.getElementById("contactNotFoundHint");
    const genderSelect = document.getElementById("contactGenderSelect");
    const genderHint = document.getElementById("contactGenderHint");

    if (!tgInput || !phoneInput) return;

    if (window.USER_CONTACT_TG) {
        tgInput.value = window.USER_CONTACT_TG;
    }
    if (window.USER_PHONE) {
        phoneInput.value = window.USER_PHONE;
    }

    // Hints
    if (sourceHint) {
        const hasData = window.USER_CONTACT_TG || window.USER_PHONE;
        sourceHint.classList.toggle("hidden", !hasData);
    }
    if (notFoundHint) {
        const showNotFound = window.USER_ENRICHMENT_DONE && !window.USER_CONTACT_TG;
        notFoundHint.classList.toggle("hidden", !showNotFound);
    }

    // --- Gender (Пол) ---
    // Логика селекта:
    //   • USER_GENDER = 'male' / 'female'  → выбираем эту опцию.
    //   • USER_GENDER = null                → показываем placeholder "Не указан"
    //                                          (его нельзя выбрать, выбрать можно только male/female).
    //   • Источник 'detected' (snapshot/эвристика) → показываем плашку
    //     "Аврора определила автоматически. Если ошиблась — поправьте здесь".
    //   • Источник 'manual' → плашку прячем (юзер уже знает что выбрал сам).
    if (genderSelect) {
        if (window.USER_GENDER === 'male' || window.USER_GENDER === 'female') {
            genderSelect.value = window.USER_GENDER;
        } else {
            // Показываем placeholder "Не указан" — disabled, чтобы юзер сам не мог его выбрать.
            genderSelect.value = "";
        }

        if (genderHint) {
            const showAutoHint = window.USER_GENDER && window.USER_GENDER_SOURCE === 'detected';
            genderHint.classList.toggle("hidden", !showAutoHint);
        }

        genderSelect.addEventListener("change", () => {
            // Когда юзер вручную меняет — это уже manual, прячем подсказку про auto-detect.
            window.USER_GENDER = genderSelect.value || null;
            window.USER_GENDER_SOURCE = 'manual';
            if (genderHint) genderHint.classList.add("hidden");
            updateCLPreview();
            // Подстраховка: общий dirty-listener из initDirtyStateTracking тоже
            // должен сработать, но если по какой-то причине его не успели навесить
            // (race condition при загрузке) — здесь всё равно обновим состояние.
            if (typeof updateAllDirtyStates === 'function') {
                updateAllDirtyStates();
            }
        });
    }

    // Toggle fields on hide checkbox
    if (hideCheckbox) {
        hideCheckbox.addEventListener("change", () => {
            const disabled = hideCheckbox.checked;
            tgInput.disabled = disabled;
            phoneInput.disabled = disabled;
            if (disabled) {
                tgInput.style.opacity = "0.4";
                phoneInput.style.opacity = "0.4";
            } else {
                tgInput.style.opacity = "1";
                phoneInput.style.opacity = "1";
            }
            updateCLPreview();
        });
    }

    // Live preview on input change
    tgInput.addEventListener("input", updateCLPreview);
    phoneInput.addEventListener("input", updateCLPreview);
}

// [NEW] Cover Letter Preview Update
function updateCLPreview() {
    const shouldUseDefault = document.getElementById("clUseDefaultCheckbox").checked;
    const customHeader = document.getElementById("clHeaderInput").value.trim();
    const customFooter = document.getElementById("clFooterInput").value.trim();

    const headerEl = document.getElementById("clPreviewHeader");
    const footerEl = document.getElementById("clPreviewFooter");
    const container = document.getElementById("clPreviewBox");
    // Body is the div between header and footer (2nd child)
    const bodyEl = container.children[1];

    if (!headerEl || !footerEl) return;

    // Update Body Preview based on Style + Gender
    const styleSelect = document.getElementById("clStyleSelect");
    const clStyle = styleSelect ? styleSelect.value : 'classic';

    // Текст превью отличается родом глаголов в зависимости от выбранного пола.
    // Если пол не указан — берём 'male' как дефолт (но реальная генерация в DeepSeek
    // в этом случае пойдёт по нейтральным конструкциям — см. промпты).
    const previewGender = (window.USER_GENDER === 'female') ? 'female' : 'male';

    const PREVIEW_BODIES = {
        classic: {
            male: `Увидел вашу вакансию QA Engineer. Мой опыт в тестировании финтех-продуктов хорошо ложится на ваши задачи, особенно в части автоматизации на Python и Selenium.<br><br>На прошлых проектах плотно работал с PostgreSQL, писал интеграционные тесты и настраивал CI/CD пайплайны. Знаю, как выстроить процесс регрессионного тестирования с нуля.<br><br>Буду рад пообщаться и обсудить детали.`,
            female: `Увидела вашу вакансию QA Engineer. Мой опыт в тестировании финтех-продуктов хорошо ложится на ваши задачи, особенно в части автоматизации на Python и Selenium.<br><br>На прошлых проектах плотно работала с PostgreSQL, писала интеграционные тесты и настраивала CI/CD пайплайны. Знаю, как выстроить процесс регрессионного тестирования с нуля.<br><br>Буду рада пообщаться и обсудить детали.`,
        },
        startup: {
            male: `Увидел вашу вакансию Frontend-разработчик и сразу зацепился за стек. React, TypeScript, работа с GraphQL — это то, чем я плотно занимаюсь последние два года на продуктовых проектах.<br><br>На прошлом месте поднял SPA с нуля, настроил SSR для SEO, оптимизировал бандл и добился Lighthouse 95+. Параллельно писал переиспользуемые компоненты на Storybook, чтобы дизайн-система жила отдельно от продукта. С CI/CD тоже на ты — пайплайны в GitLab настраивал сам.<br><br>Готов ворваться в задачи и приносить пользу. Буду рад пообщаться!`,
            female: `Увидела вашу вакансию Frontend-разработчик и сразу зацепилась за стек. React, TypeScript, работа с GraphQL — это то, чем я плотно занимаюсь последние два года на продуктовых проектах.<br><br>На прошлом месте подняла SPA с нуля, настроила SSR для SEO, оптимизировала бандл и добилась Lighthouse 95+. Параллельно писала переиспользуемые компоненты на Storybook, чтобы дизайн-система жила отдельно от продукта. С CI/CD тоже на ты — пайплайны в GitLab настраивала сама.<br><br>Готова ворваться в задачи и приносить пользу. Буду рада пообщаться!`,
        },
        formal: {
            male: `Обращаюсь к Вам по поводу позиции Backend-разработчик. Обладаю профильным опытом в области проектирования высоконагруженных систем.<br><br>В рамках предыдущих проектов реализовал систему мониторинга на базе Prometheus и Grafana, что позволило сократить время обнаружения инцидентов. Имею устойчивый опыт работы с PostgreSQL и проектирования REST API.<br><br>Буду рад обсудить, как моя экспертиза может быть полезна Вашей команде. Благодарю за уделенное время.`,
            female: `Обращаюсь к Вам по поводу позиции Backend-разработчик. Обладаю профильным опытом в области проектирования высоконагруженных систем.<br><br>В рамках предыдущих проектов реализовала систему мониторинга на базе Prometheus и Grafana, что позволило сократить время обнаружения инцидентов. Имею устойчивый опыт работы с PostgreSQL и проектирования REST API.<br><br>Буду рада обсудить, как моя экспертиза может быть полезна Вашей команде. Благодарю за уделенное время.`,
        },
        executive: {
            male: `Изучил вакансию Engineering Manager. Мой опыт управления командами до 15 человек и построения процессов позволит эффективно закрыть задачи вашего направления.<br><br>На позиции Team Lead с нуля выстроил CI/CD и внедрил Scrum, что сократило Time-to-market на 40%. Оптимизировал бюджет разработки и нанял ключевых специалистов.<br><br>Готов обсудить, как мой опыт поможет достичь KPI вашего департамента.`,
            female: `Изучила вакансию Engineering Manager. Мой опыт управления командами до 15 человек и построения процессов позволит эффективно закрыть задачи вашего направления.<br><br>На позиции Team Lead с нуля выстроила CI/CD и внедрила Scrum, что сократило Time-to-market на 40%. Оптимизировала бюджет разработки и наняла ключевых специалистов.<br><br>Готова обсудить, как мой опыт поможет достичь KPI вашего департамента.`,
        },
        direct: {
            male: `Откликаюсь на DevOps Engineer. Стек совпадает с требованиями.<br><br>Основной стек: Linux, Docker, K8s, Terraform, GitLab CI. Коммерческий опыт — 4 года. Поднимал инфраструктуру на AWS для проекта с нагрузкой 10k RPS. Настраивал мониторинг на Prometheus + Grafana.<br><br>Готов к техническому интервью.`,
            female: `Откликаюсь на DevOps Engineer. Стек совпадает с требованиями.<br><br>Основной стек: Linux, Docker, K8s, Terraform, GitLab CI. Коммерческий опыт — 4 года. Поднимала инфраструктуру на AWS для проекта с нагрузкой 10k RPS. Настраивала мониторинг на Prometheus + Grafana.<br><br>Готова к техническому интервью.`,
        },
    };

    const styleBodies = PREVIEW_BODIES[clStyle] || PREVIEW_BODIES.classic;
    bodyEl.innerHTML = styleBodies[previewGender] || styleBodies.male;

    // Build footer text from contact fields
    const hideContacts = document.getElementById("contactHideCheckbox")?.checked;
    const tgVal = hideContacts ? "" : (document.getElementById("contactTgInput")?.value.trim() || "");
    const phoneVal = hideContacts ? "" : (document.getElementById("contactPhoneInput")?.value.trim() || "");
    let contactFooterLines = [];
    if (tgVal) contactFooterLines.push(`ТГ: ${tgVal}`);
    if (phoneVal) contactFooterLines.push(`Номер: ${phoneVal}`);
    const contactFooterText = contactFooterLines.length > 0
        ? contactFooterLines.join("\n")
        : (hideContacts ? "(Контакты скрыты)" : "ТГ: @username\nНомер: +7 (999) 000-00-00");

    if (shouldUseDefault) {
        // Default Mode
        headerEl.innerText = `Здравствуйте, меня зовут ${window.USER_FIRST_NAME}.`;
        headerEl.style.fontStyle = "italic";
        headerEl.style.color = "#888";
        headerEl.style.fontWeight = "normal";

        footerEl.innerText = contactFooterText;
        footerEl.style.fontStyle = "italic";
        footerEl.style.color = "#888";
        footerEl.style.fontWeight = "normal";

        container.style.borderColor = "#444";
        container.style.borderStyle = "dashed";
    } else {
        // Custom Mode
        // Header
        if (customHeader) {
            headerEl.innerText = customHeader;
            headerEl.style.color = "#a962ff"; // Highlight
            headerEl.style.fontWeight = "600";
            headerEl.style.fontStyle = "normal";
        } else {
            headerEl.innerText = "(Здесь будет ваше приветствие...)";
            headerEl.style.color = "#555";
            headerEl.style.fontStyle = "italic";
            headerEl.style.fontWeight = "normal";
        }

        // Footer
        if (customFooter) {
            footerEl.innerText = customFooter;
            footerEl.style.color = "#a962ff"; // Highlight
            footerEl.style.fontWeight = "600";
            footerEl.style.fontStyle = "normal";
        } else {
            footerEl.innerText = "(Здесь будет ваша подпись...)";
            footerEl.style.color = "#555";
            footerEl.style.fontStyle = "italic";
            footerEl.style.fontWeight = "normal";
        }

        container.style.borderColor = "#a962ff"; // Highlight container
        container.style.borderStyle = "solid";
    }
}

// --- THEME TOGGLE LOGIC ---
function initializeTheme() {
    const savedTheme = localStorage.getItem("aurora_theme");
    const prefersDark = savedTheme === "dark" || (!savedTheme && true); // Default: dark
    
    if (!prefersDark) {
        document.body.classList.add("light-theme");
        updateThemeIcons(false);
    } else {
        updateThemeIcons(true);
    }

    // Attach toggle handler
    const toggleBtn = document.getElementById("themeToggle");
    if (toggleBtn) {
        toggleBtn.addEventListener("click", toggleTheme);
    }
}

function toggleTheme() {
    const isCurrentlyDark = !document.body.classList.contains("light-theme");
    
    if (isCurrentlyDark) {
        // Switch to light
        document.body.classList.add("light-theme");
        localStorage.setItem("aurora_theme", "light");
        updateThemeIcons(false);
    } else {
        // Switch to dark
        document.body.classList.remove("light-theme");
        localStorage.setItem("aurora_theme", "dark");
        updateThemeIcons(true);
    }
}

function updateThemeIcons(isDark) {
    const sunIcon = document.getElementById("sunIcon");
    const moonIcon = document.getElementById("moonIcon");
    
    if (isDark) {
        if (sunIcon) sunIcon.style.display = "block";
        if (moonIcon) moonIcon.style.display = "none";
    } else {
        if (sunIcon) sunIcon.style.display = "none";
        if (moonIcon) moonIcon.style.display = "block";
    }
}


// ============================================================================
// ACCOUNT: TELEGRAM LINK + SESSIONS
// ============================================================================

async function initAccountSection() {
    if (authMode !== 'jwt') {
        const section = document.getElementById('accountSection');
        if (section) section.classList.add('hidden');
        return;
    }

    try {
        const resp = await authFetch(`${API_BASE_URL}/api/auth/me`, {
            method: 'GET',
        });
        if (resp.ok) {
            const data = await resp.json();
            const statusEl = document.getElementById('tgLinkStatus');
            const btn = document.getElementById('tgLinkBtn');

            if (data.has_telegram) {
                statusEl.textContent = 'Привязан';
                statusEl.classList.add('text-green-400');
            } else {
                statusEl.textContent = 'Не привязан';
                btn.classList.remove('hidden');
                btn.addEventListener('click', handleLinkTelegram);
            }

            if (typeof checkRegModal === 'function') {
                checkRegModal(data);
            }
        }
    } catch (_) {}

    loadSessions();
}

async function handleLinkTelegram() {
    const btn = document.getElementById('tgLinkBtn');
    btn.disabled = true;
    btn.textContent = 'Генерация...';

    try {
        const resp = await authFetch(`${API_BASE_URL}/api/auth/link-telegram`, {
            method: 'POST',
        });
        const data = await resp.json();

        if (resp.ok && data.link) {
            const container = document.getElementById('tgDeepLink');
            const linkEl = document.getElementById('tgDeepLinkUrl');
            linkEl.href = data.link;
            linkEl.textContent = data.link;
            container.classList.remove('hidden');
            btn.classList.add('hidden');
        } else {
            btn.textContent = data.detail || 'Ошибка';
            setTimeout(() => { btn.textContent = 'Привязать'; btn.disabled = false; }, 3000);
        }
    } catch (_) {
        btn.textContent = 'Ошибка сети';
        setTimeout(() => { btn.textContent = 'Привязать'; btn.disabled = false; }, 3000);
    }
}

async function loadSessions() {
    const container = document.getElementById('sessionsList');
    const revokeAllBtn = document.getElementById('revokeAllBtn');

    try {
        const resp = await authFetch(`${API_BASE_URL}/api/auth/sessions`, {
            method: 'GET',
        });
        if (!resp.ok) { container.innerHTML = '<p class="text-on-surface-variant text-xs">Не удалось загрузить</p>'; return; }
        const data = await resp.json();
        const sessions = data.sessions || [];

        if (sessions.length === 0) {
            container.innerHTML = '<p class="text-on-surface-variant text-xs">Нет активных сессий</p>';
            return;
        }

        if (sessions.length > 1) revokeAllBtn.classList.remove('hidden');

        container.innerHTML = sessions.map(s => {
            const lastUsed = s.last_used_at ? new Date(s.last_used_at).toLocaleString('ru-RU') : 'Недавно';
            const currentBadge = s.is_current
                ? '<span class="text-[10px] bg-primary-container/30 text-primary px-2 py-0.5 rounded-full">Текущая</span>'
                : `<button onclick="revokeSession(${s.id})" class="text-error text-[10px] hover:underline">Завершить</button>`;

            return `
                <div class="flex items-center justify-between py-2.5 border-b border-outline-variant/10 last:border-0">
                    <div class="flex items-center gap-3">
                        <span class="material-symbols-outlined text-on-surface-variant text-lg">devices</span>
                        <div>
                            <p class="text-on-surface text-xs font-medium">${escapeHtml(s.device_name || 'Устройство')}</p>
                            <p class="text-outline text-[10px]">${escapeHtml(s.ip_address || '')} &middot; ${lastUsed}</p>
                        </div>
                    </div>
                    ${currentBadge}
                </div>`;
        }).join('');

    } catch (_) {
        container.innerHTML = '<p class="text-on-surface-variant text-xs">Ошибка загрузки</p>';
    }
}

async function revokeSession(sessionId) {
    try {
        const resp = await authFetch(`${API_BASE_URL}/api/auth/sessions/${sessionId}`, {
            method: 'DELETE',
        });
        if (resp.ok) loadSessions();
    } catch (_) {}
}

async function revokeAllSessions() {
    try {
        const resp = await authFetch(`${API_BASE_URL}/api/auth/sessions`, {
            method: 'DELETE',
        });
        if (resp.ok) loadSessions();
    } catch (_) {}
}

async function handleLogout() {
    try {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
            method: 'POST', credentials: 'include'
        });
    } catch (_) {}
    window.location.href = '/auth/';
}


// regModal logic moved to shared reg-modal.js

async function handleNavLogout() {
    try {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
            method: 'POST', credentials: 'include',
        });
    } catch (_) {}
    window.location.href = '/auth/';
}

/* ═══════════════════════════════════════════════════════════════
   ONBOARDING MODE & GUIDED TOUR
   ═══════════════════════════════════════════════════════════════ */

let _isOnboardingMode = false;
let _originalSaveFn = null;
let _onboardingCompleting = false;

function _lockNavForOnboarding() {
    const selectors = [
        'a[href="/cabinet/"]',
        'a[href="/responses/"]',
        'a[href="/resume/"]',
        '#nav-responses',
        '#nav-responses-mobile',
        '#nav-resume',
        '#nav-resume-mobile'
    ];
    selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(link => {
            if (link.dataset.originalHref) return; // already locked
            link.dataset.originalHref = link.href || link.getAttribute('href') || '#';
            link.removeAttribute('href');
            link.style.opacity = '0.35';
            link.style.cursor = 'not-allowed';
            link.style.pointerEvents = 'auto';
            link.addEventListener('click', _blockNavClick);
        });
    });
}

function _unlockNav() {
    document.querySelectorAll('[data-original-href]').forEach(link => {
        link.href = link.dataset.originalHref;
        delete link.dataset.originalHref;
        link.style.opacity = '';
        link.style.cursor = '';
        link.style.pointerEvents = '';
        link.removeEventListener('click', _blockNavClick);
    });
}

function _blockNavClick(e) {
    e.preventDefault();
    e.stopPropagation();
}

function _styleOnboardingSaveBtn() {
    const saveBtn = document.getElementById('saveBtn');
    if (!saveBtn) return;
    saveBtn.textContent = 'Сохранить и начать поиск';
    saveBtn.disabled = false;
    saveBtn.style.opacity = '1';
    saveBtn.style.background = 'linear-gradient(135deg, #5a30d0, #653edb)';
    saveBtn.style.color = '#fff';
    saveBtn.classList.remove('disabled:opacity-40');
    updateSaveBarFloatingState();
}

function activateOnboardingMode() {
    _isOnboardingMode = true;

    const stepper = document.getElementById('onboardingStepper');
    if (stepper) stepper.classList.remove('hidden');

    _styleOnboardingSaveBtn();
    _lockNavForOnboarding();
    updateSaveBarFloatingState();

    setTimeout(() => {
        if (window.SettingsTour && window.SETTINGS_TOUR_STEPS) {
            const tour = new SettingsTour(window.SETTINGS_TOUR_STEPS, {
                mode: 'onboarding',
                onComplete: async function () {
                    console.log('[Tour] Onboarding tour completed → onboarding_save_pending');
                    try {
                        await authFetch(`${API_BASE_URL}/api/onboarding/tour-done`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include'
                        });
                        window._currentStep = 'onboarding_save_pending';
                    } catch (e) {
                        console.error('[Tour] tour-done API error:', e);
                    }
                }
            });
            tour.start();
        }
    }, 600);
}

function activateOnboardingSavePending() {
    _isOnboardingMode = true;

    const stepper = document.getElementById('onboardingStepper');
    if (stepper) stepper.classList.remove('hidden');

    _styleOnboardingSaveBtn();
    _lockNavForOnboarding();
    updateSaveBarFloatingState();
}

async function handleOnboardingSave() {
    if (_onboardingCompleting) return;
    _onboardingCompleting = true;

    const saveBtn = document.getElementById('saveBtn');

    const saved = await saveSettings();
    if (!saved) {
        _onboardingCompleting = false;
        return;
    }

    try {
        const resp = await authFetch(`${API_BASE_URL}/api/onboarding/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });

        if (!resp.ok) {
            throw new Error('Не удалось завершить онбординг');
        }

        window._currentStep = null;
        _isOnboardingMode = false;
        _hasSearchChanges = false;
        _onboardingCompleting = false;

        _unlockNav();
        updateSaveBarFloatingState();
        showCongratsPopup();

    } catch (e) {
        _onboardingCompleting = false;
        console.error('[Onboarding] Complete error:', e);
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Сохранить и начать поиск';
            saveBtn.style.background = 'linear-gradient(135deg, #5a30d0, #653edb)';
        }
        showError(e.message || 'Не удалось завершить онбординг');
    }
}

function showCongratsPopup() {
    const existing = document.getElementById('congratsOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'congratsOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);animation:tourPopIn 0.3s ease-out';
    overlay.innerHTML = `
        <div style="
            max-width: 420px; width: calc(100% - 32px);
            background: rgba(33, 30, 41, 0.97);
            backdrop-filter: blur(24px);
            border: 1px solid rgba(204, 190, 255, 0.12);
            border-radius: 20px;
            padding: 36px 28px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            font-family: 'Inter', system-ui, sans-serif;
        ">
            <div style="font-size:48px;margin-bottom:16px">🎉</div>
            <h2 style="font-size:22px;font-weight:800;color:#e7e0ef;margin-bottom:10px;line-height:1.3">Поздравляем!</h2>
            <p style="font-size:14px;color:#cac3d7;line-height:1.6;margin-bottom:8px">
                Вы сделали все необходимые настройки.
            </p>
            <p style="font-size:12px;color:#938ea0;line-height:1.5;margin-bottom:24px">
                Если появятся вопросы — нажмите кнопку помощи внизу страницы.
            </p>
            <button id="congratsDismissBtn" style="
                background: linear-gradient(to right, #5a30d0, #58309f);
                color: #fff; border: none; border-radius: 12px;
                padding: 12px 36px; font-size: 15px; font-weight: 700;
                cursor: pointer; font-family: inherit;
                transition: filter 0.2s;
            ">Начать</button>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('congratsDismissBtn').addEventListener('click', () => {
        overlay.remove();
        const stepper = document.getElementById('onboardingStepper');
        if (stepper) stepper.classList.add('hidden');
        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn) {
            saveBtn.style.background = '';
            saveBtn.style.color = '';
        }
        initDirtyStateTracking();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const helpBtn = document.getElementById('helpBtn');
    if (helpBtn) {
        helpBtn.addEventListener('click', () => {
            if (window.SettingsTour && window.SETTINGS_TOUR_STEPS) {
                new SettingsTour(window.SETTINGS_TOUR_STEPS, { mode: 'help' }).start();
            }
        });
    }

    // ============================================================
    // ЗАЩИТА ОТ ПОТЕРИ ДАННЫХ
    // ============================================================
    // 1) beforeunload — браузерное предупреждение при закрытии вкладки/перезагрузке.
    //    Текст не контролируется браузером (chromium показывает стандартный alert).
    // 2) In-app navigation guard — клик по любой <a href="/..."> в шапке.
    //    Показываем КАСТОМНЫЙ модал #leaveConfirmModal с тремя кнопками:
    //      • "Сохранить и уйти" — вызывает saveSettings/saveResponseSettings,
    //         ждёт результат, потом продолжает навигацию.
    //      • "Уйти без сохранения" — пускаем дальше, изменения теряются.
    //      • "Остаться на странице" — отменяем переход.
    //
    // Срабатывает если есть unsaved-изменения В ЛЮБОЙ из вкладок (поиск/отклики).

    function _hasAnyUnsavedChanges() {
        return _hasSearchChanges || _hasResponseChanges;
    }

    function _dirtyTabsText() {
        const dirty = [];
        if (_hasSearchChanges)   dirty.push('«Настройки поиска»');
        if (_hasResponseChanges) dirty.push('«Настройки откликов»');
        return dirty.join(' и ');
    }

    window.addEventListener('beforeunload', (e) => {
        if (_hasAnyUnsavedChanges()) {
            // beforeunload показывает только generic browser alert (Chromium
            // игнорирует кастомный текст). preventDefault + returnValue нужны
            // чтобы вообще появилось.
            e.preventDefault();
            e.returnValue = 'У вас есть несохранённые изменения. Они будут потеряны.';
            return e.returnValue;
        }
    });

    // ---------- Кастомный модал (Promise-based) ----------
    // showLeaveConfirmModal() → resolves to: 'save' | 'discard' | 'stay'
    function showLeaveConfirmModal() {
        return new Promise((resolve) => {
            const modal      = document.getElementById('leaveConfirmModal');
            const bodyEl     = document.getElementById('leaveConfirmBody');
            const stayBtn    = document.getElementById('leaveConfirmStay');
            const discardBtn = document.getElementById('leaveConfirmDiscard');
            const saveBtn    = document.getElementById('leaveConfirmSave');

            if (!modal || !stayBtn || !discardBtn || !saveBtn) {
                // Fallback: модал не найден — старый browser confirm.
                const ok = window.confirm(
                    `У вас есть несохранённые изменения в ${_dirtyTabsText()}. ` +
                    `Уйти без сохранения?`
                );
                resolve(ok ? 'discard' : 'stay');
                return;
            }

            if (bodyEl) {
                bodyEl.innerHTML =
                    `У вас есть несохранённые изменения в <b>${_dirtyTabsText()}</b>.<br><br>` +
                    `Что сделать?`;
            }

            // Показываем
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            // Блокируем скролл фона
            const prevOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';

            const cleanup = (result) => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
                document.body.style.overflow = prevOverflow;
                stayBtn.removeEventListener('click', onStay);
                discardBtn.removeEventListener('click', onDiscard);
                saveBtn.removeEventListener('click', onSave);
                modal.removeEventListener('click', onBackdrop);
                document.removeEventListener('keydown', onKey);
                resolve(result);
            };

            const onStay     = () => cleanup('stay');
            const onDiscard  = () => cleanup('discard');
            const onSave     = () => cleanup('save');
            const onBackdrop = (e) => { if (e.target === modal) cleanup('stay'); };
            const onKey      = (e) => { if (e.key === 'Escape') cleanup('stay'); };

            stayBtn.addEventListener('click', onStay);
            discardBtn.addEventListener('click', onDiscard);
            saveBtn.addEventListener('click', onSave);
            modal.addEventListener('click', onBackdrop);
            document.addEventListener('keydown', onKey);
        });
    }

    // Сохраняет ту вкладку(и), которая dirty. Возвращает true при успехе.
    async function _saveDirtyTabs() {
        const tasks = [];
        if (_hasSearchChanges) {
            // Search-форма сохраняется через клик по реальной кнопке —
            // у неё своя обвязка (валидация, onboarding-состояние и т.п.)
            const sBtn = document.getElementById('saveBtn');
            if (sBtn && !sBtn.disabled) {
                tasks.push(new Promise((resolve) => {
                    // Хак: после клика отслеживаем кнопку до сброса dirty-state.
                    sBtn.click();
                    let elapsed = 0;
                    const poll = () => {
                        elapsed += 200;
                        if (!_hasSearchChanges) return resolve(true);
                        if (elapsed > 15000) return resolve(false); // 15s таймаут
                        setTimeout(poll, 200);
                    };
                    poll();
                }));
            }
        }
        if (_hasResponseChanges) {
            // Response — тоже через click по кнопке (там async saveResponseSettings).
            const rBtn = document.getElementById('saveResponseBtn');
            if (rBtn && !rBtn.disabled) {
                tasks.push(new Promise((resolve) => {
                    rBtn.click();
                    let elapsed = 0;
                    const poll = () => {
                        elapsed += 200;
                        if (!_hasResponseChanges) return resolve(true);
                        if (elapsed > 15000) return resolve(false);
                        setTimeout(poll, 200);
                    };
                    poll();
                }));
            }
        }
        if (tasks.length === 0) return true;
        const results = await Promise.all(tasks);
        return results.every(Boolean);
    }

    // ---------- In-app navigation guard ----------
    const NAV_SELECTOR = 'a[href^="/"]:not([target="_blank"]):not([data-allow-leave])';
    document.addEventListener('click', async (event) => {
        if (!_hasAnyUnsavedChanges()) return;

        const link = event.target && event.target.closest && event.target.closest(NAV_SELECTOR);
        if (!link) return;

        const href = link.getAttribute('href') || '';
        if (href.startsWith('#') || href.startsWith('javascript:')) return;

        // Игнорируем переходы на ту же URL
        try {
            const target = new URL(href, window.location.origin);
            if (target.pathname === window.location.pathname && !target.search && !target.hash) {
                return;
            }
        } catch (_) { /* invalid URL */ }

        // Перехватываем клик ДО browser-перехода.
        event.preventDefault();
        event.stopPropagation();

        const choice = await showLeaveConfirmModal();
        if (choice === 'stay') {
            return; // ничего не делаем
        }

        if (choice === 'save') {
            // Покажем индикатор "сохраняю и ухожу" на самом link'е (опционально)
            const ok = await _saveDirtyTabs();
            if (!ok) {
                alert('Не удалось сохранить настройки. Попробуйте ещё раз или уйдите без сохранения.');
                return;
            }
            // Сохранилось — продолжаем переход.
        }

        // discard или save → переходим. data-allow-leave чтобы уже не цеплять
        // повторно нашим же обработчиком.
        link.setAttribute('data-allow-leave', '1');
        // beforeunload может ещё раз спросить (если save не успел сбросить
        // dirty-state) — но это редкий race.
        window.location.href = href;
    }, true); // capture-phase, перехват ДО других обработчиков
});
