/* manual-search.js v2.0 — Ручной режим поиска вакансий */
(function () {
    "use strict";

    let _hasMore = false;
    let _loading = false;
    let _observer = null;
    let _searchActive = false;
    let _heartbeatTimer = null;
    let _totalRendered = 0;

    const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 минут
    const EMPTY_RETRY_DELAY = 500;
    const MAX_EMPTY_RETRIES = 5;
    let _emptyRetries = 0;

    const $ = (id) => document.getElementById(id);

    function refs() {
        return {
            autopilot: $("autopilotContent"),
            manual: $("manualContent"),
            btnAutopilot: $("modeAutopilot"),
            btnManual: $("modeManual"),
            startBtn: $("startManualSearchBtn"),
            startBtnText: $("manualSearchBtnText"),
            stats: $("manualSearchStats"),
            statTotal: $("msStatTotal"),
            statFiltered: $("msStatFiltered"),
            statTime: $("msStatTime"),
            skeleton: $("manualSearchSkeleton"),
            empty: $("manualSearchEmpty"),
            error: $("manualSearchError"),
            errorText: $("manualSearchErrorText"),
            grid: $("manualVacancyGrid"),
            sentinel: $("manualLoadMoreSentinel"),
            endOfResults: $("manualEndOfResults"),
            sessionExpired: $("manualSessionExpired"),
        };
    }

    // ==================================================================
    // MODE SWITCH
    // ==================================================================

    window.switchMode = function switchMode(mode) {
        const r = refs();
        if (!r.autopilot || !r.manual) return;

        if (mode === "autopilot") {
            r.autopilot.style.display = "";
            r.manual.style.display = "none";
            r.btnAutopilot.classList.add("active");
            r.btnManual.classList.remove("active");
            _stopHeartbeat();
        } else {
            r.autopilot.style.display = "none";
            r.manual.style.display = "";
            r.btnAutopilot.classList.remove("active");
            r.btnManual.classList.add("active");
            if (_searchActive) _startHeartbeat();
        }
    };

    // ==================================================================
    // HEARTBEAT (keep-alive TTL refresh)
    // ==================================================================

    function _startHeartbeat() {
        _stopHeartbeat();
        _heartbeatTimer = setInterval(async () => {
            try {
                const qs = buildAuthParams();
                const resp = await apiFetch(`/api/manual-search/touch?${qs}`, {
                    method: "POST",
                });
                if (resp.ok) {
                    const data = await resp.json();
                    if (!data.alive) {
                        _handleSessionExpired();
                    }
                }
            } catch (e) {
                console.warn("[ManualSearch] heartbeat error:", e);
            }
        }, HEARTBEAT_INTERVAL);
    }

    function _stopHeartbeat() {
        if (_heartbeatTimer) {
            clearInterval(_heartbeatTimer);
            _heartbeatTimer = null;
        }
    }

    function _handleSessionExpired() {
        _stopHeartbeat();
        _searchActive = false;
        _hasMore = false;
        _destroyObserver();
        const r = refs();
        r.sentinel.classList.add("hidden");
        if (r.sessionExpired) r.sessionExpired.classList.remove("hidden");
    }

    // ==================================================================
    // START SEARCH
    // ==================================================================

    window.startManualSearch = async function startManualSearch() {
        if (_loading) return;
        const r = refs();

        _setLoading(true, r);
        _hideAll(r);
        r.skeleton.classList.remove("hidden");
        r.grid.innerHTML = "";
        _searchActive = false;
        _totalRendered = 0;
        _emptyRetries = 0;

        try {
            const qs = buildAuthParams();
            const resp = await apiFetch(`/api/manual-search/start?${qs}`, {
                method: "POST",
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${resp.status}`);
            }

            const data = await resp.json();
            _hideAll(r);

            if (!data.vacancies || data.vacancies.length === 0) {
                r.empty.classList.remove("hidden");
                _setLoading(false, r);
                return;
            }

            _renderBatch(data.vacancies, r, true);
            _totalRendered = data.vacancies.length;
            _hasMore = !!data.has_more;
            _searchActive = true;

            _updateStats(data, r);
            _startHeartbeat();

            if (_hasMore) {
                _initObserver(r);
                r.sentinel.classList.remove("hidden");
            } else {
                _showEndOfResults(r);
            }
        } catch (e) {
            _hideAll(r);
            r.error.classList.remove("hidden");
            r.errorText.textContent = e.message || "Неизвестная ошибка";
        } finally {
            _setLoading(false, r);
        }
    };

    // ==================================================================
    // LOAD MORE (infinite scroll)
    // ==================================================================

    async function loadMoreVacancies() {
        if (_loading || !_hasMore) return;
        const r = refs();
        _loading = true;
        r.sentinel.classList.remove("hidden");

        try {
            const qs = buildAuthParams();
            const resp = await apiFetch(`/api/manual-search/next?${qs}`);

            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            if (data.session_expired) {
                _handleSessionExpired();
                return;
            }

            if (data.vacancies && data.vacancies.length > 0) {
                _renderBatch(data.vacancies, r, false);
                _totalRendered += data.vacancies.length;
                _emptyRetries = 0;

                if (data.stats) _updateStats(data, r);
            } else {
                _emptyRetries++;
                if (_emptyRetries < MAX_EMPTY_RETRIES && data.has_more) {
                    console.log(`[ManualSearch] Empty response, retry ${_emptyRetries}/${MAX_EMPTY_RETRIES}`);
                    _loading = false;
                    setTimeout(() => loadMoreVacancies(), EMPTY_RETRY_DELAY);
                    return;
                }
            }

            _hasMore = !!data.has_more;

            if (!_hasMore) {
                r.sentinel.classList.add("hidden");
                _destroyObserver();
                _showEndOfResults(r);
            }
        } catch (e) {
            console.error("[ManualSearch] loadMore error:", e);
        } finally {
            _loading = false;
            if (!_hasMore) r.sentinel.classList.add("hidden");
        }
    }

    // ==================================================================
    // APPLY / SKIP
    // ==================================================================

    window.applyToVacancy = async function applyToVacancy(vacancyId, cardEl) {
        const btn = cardEl.querySelector(".ms-apply-btn");
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<svg class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>';
        }

        try {
            const qs = buildAuthParams();
            const resp = await apiFetch(`/api/manual-search/apply?${qs}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ vacancy_id: vacancyId }),
            });

            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            cardEl.style.transition = "opacity 0.3s, transform 0.3s";
            cardEl.style.opacity = "0";
            cardEl.style.transform = "scale(0.95)";
            setTimeout(() => {
                cardEl.remove();
                _checkEmptyGrid();
            }, 300);

            if (data.limit_reached) {
                _showToast("Дневной лимит исчерпан");
            }
        } catch (e) {
            if (btn) {
                btn.disabled = false;
                btn.textContent = "Откликнуться";
            }
            console.error("[ManualSearch] apply error:", e);
        }
    };

    window.skipVacancy = async function skipVacancy(vacancyId, cardEl) {
        try {
            const qs = buildAuthParams();
            apiFetch(`/api/manual-search/skip?${qs}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ vacancy_id: vacancyId }),
            });

            cardEl.style.transition = "opacity 0.3s, transform 0.3s";
            cardEl.style.opacity = "0";
            cardEl.style.transform = "translateX(-20px)";
            setTimeout(() => {
                cardEl.remove();
                _checkEmptyGrid();
            }, 300);
        } catch (e) {
            console.error("[ManualSearch] skip error:", e);
        }
    };

    // ==================================================================
    // RENDER
    // ==================================================================

    function _renderBatch(vacancies, r, clear) {
        if (clear) r.grid.innerHTML = "";

        vacancies.forEach((v, i) => {
            const card = _createCard(v);
            card.style.animationDelay = `${i * 50}ms`;
            card.classList.add("vacancy-card-animate");
            r.grid.appendChild(card);
        });
    }

    function _createCard(v) {
        const card = document.createElement("div");
        card.className = "vacancy-card glass-panel p-5 md:p-6 rounded-xl flex flex-col gap-3";
        card.dataset.vacancyId = v.id;

        const tags = [];
        if (v.salary_text) tags.push(_tag(v.salary_text, "payments"));
        if (v.area) tags.push(_tag(v.area, "location_on"));
        if (v.experience) tags.push(_tag(v.experience, "work_history"));
        if (v.schedule) tags.push(_tag(v.schedule, "schedule"));

        const skills = (v.key_skills || [])
            .map((s) => `<span class="vacancy-tag">${esc(s)}</span>`)
            .join("");

        card.innerHTML = `
            <div class="flex items-start gap-4">
                ${v.employer_logo
                    ? `<img src="${esc(v.employer_logo)}" alt="" class="w-10 h-10 rounded-lg bg-surface-container object-contain shrink-0" onerror="this.style.display='none'">`
                    : `<div class="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-on-surface-variant/40 text-lg">apartment</span></div>`
                }
                <div class="min-w-0 flex-1">
                    <p class="text-xs text-on-surface-variant truncate">${esc(v.employer_name)}</p>
                    <a href="${esc(v.url)}" target="_blank" rel="noopener" class="text-base font-semibold text-on-surface hover:text-primary transition-colors line-clamp-2 leading-snug">${esc(v.name)}</a>
                </div>
            </div>
            ${tags.length ? `<div class="flex flex-wrap gap-1.5">${tags.join("")}</div>` : ""}
            ${v.description_short ? `<p class="text-xs text-on-surface-variant/70 line-clamp-3 leading-relaxed">${esc(v.description_short)}</p>` : ""}
            ${skills ? `<div class="flex flex-wrap gap-1">${skills}</div>` : ""}
            <div class="flex gap-2 mt-auto pt-2 border-t border-outline-variant/10">
                <button class="ms-apply-btn flex-1 px-4 py-2.5 rounded-lg bg-primary-container text-white font-bold text-sm hover:brightness-110 active:scale-[0.97] transition-all" onclick="applyToVacancy('${esc(v.id)}', this.closest('.vacancy-card'))">Откликнуться</button>
                <button class="px-4 py-2.5 rounded-lg bg-surface-container text-on-surface-variant font-semibold text-sm hover:bg-surface-container-high transition-colors" onclick="skipVacancy('${esc(v.id)}', this.closest('.vacancy-card'))">Пропустить</button>
                <a href="${esc(v.url)}" target="_blank" rel="noopener" class="px-3 py-2.5 rounded-lg bg-surface-container text-on-surface-variant hover:text-primary transition-colors flex items-center" title="Открыть на hh.ru">
                    <span class="material-symbols-outlined text-lg">open_in_new</span>
                </a>
            </div>
        `;
        return card;
    }

    function _tag(text, icon) {
        return `<span class="vacancy-tag"><span class="material-symbols-outlined" style="font-size:13px;font-variation-settings:'FILL' 1">${icon}</span>${esc(text)}</span>`;
    }

    // ==================================================================
    // UI HELPERS
    // ==================================================================

    function _setLoading(on, r) {
        _loading = on;
        if (r.startBtn) r.startBtn.disabled = on;
        if (r.startBtnText) {
            r.startBtnText.textContent = on ? "Загрузка..." : "Показать вакансии";
        }
    }

    function _hideAll(r) {
        r.skeleton.classList.add("hidden");
        r.empty.classList.add("hidden");
        r.error.classList.add("hidden");
        r.sentinel.classList.add("hidden");
        if (r.endOfResults) r.endOfResults.classList.add("hidden");
        if (r.sessionExpired) r.sessionExpired.classList.add("hidden");
    }

    function _updateStats(data, r) {
        r.stats.classList.remove("hidden");
        const s = data.stats;
        if (!s) return;

        const pagesLoaded = parseInt(s.api_pages_loaded) || 0;
        const pagesTotal = parseInt(s.api_pages_total) || 0;
        const apiTotal = pagesLoaded * 100;

        r.statTotal.textContent = `${apiTotal} (стр. ${pagesLoaded}/${pagesTotal})`;
        r.statFiltered.textContent = _totalRendered;

        if (data.timings && data.timings.total) {
            r.statTime.textContent = data.timings.total.toFixed(2) + "с";
        }
    }

    function _showEndOfResults(r) {
        if (r.endOfResults) {
            r.endOfResults.classList.remove("hidden");
        }
    }

    function _checkEmptyGrid() {
        const r = refs();
        if (r.grid.children.length === 0 && !_hasMore) {
            r.empty.classList.remove("hidden");
        } else if (r.grid.children.length < 5 && _hasMore && !_loading) {
            loadMoreVacancies();
        }
    }

    function _showToast(msg) {
        const toast = document.createElement("div");
        toast.className = "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl bg-surface-container text-on-surface text-sm font-semibold shadow-2xl border border-outline-variant/10";
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.transition = "opacity 0.3s";
            toast.style.opacity = "0";
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ==================================================================
    // INTERSECTION OBSERVER (infinite scroll)
    // ==================================================================

    function _initObserver(r) {
        _destroyObserver();
        _observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && _hasMore && !_loading) {
                    loadMoreVacancies();
                }
            },
            { rootMargin: "400px" }
        );
        if (r.sentinel) _observer.observe(r.sentinel);
    }

    function _destroyObserver() {
        if (_observer) {
            _observer.disconnect();
            _observer = null;
        }
    }
})();
