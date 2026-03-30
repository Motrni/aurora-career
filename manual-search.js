/* manual-search.js v3.0 — Ручной режим поиска вакансий */
(function () {
    "use strict";

    let _hasMore = false;
    let _loading = false;
    let _observer = null;
    let _searchActive = false;
    let _heartbeatTimer = null;
    let _totalRendered = 0;

    const HEARTBEAT_INTERVAL = 5 * 60 * 1000;
    const EMPTY_RETRY_DELAY = 500;
    const MAX_EMPTY_RETRIES = 5;
    let _emptyRetries = 0;

    const _vacancyCache = {};

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
            _vacancyCache[v.id] = v;
            const card = _createCard(v);
            card.style.animationDelay = `${i * 50}ms`;
            card.classList.add("vacancy-card-animate");
            r.grid.appendChild(card);
        });
    }

    function _createCard(v) {
        const card = document.createElement("div");
        card.className = "vacancy-card glass-panel p-5 md:p-6 rounded-xl flex flex-col gap-3 cursor-pointer";
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
                    <span class="text-base font-semibold text-on-surface line-clamp-2 leading-snug">${esc(v.name)}</span>
                </div>
            </div>
            ${tags.length ? `<div class="flex flex-wrap gap-1.5">${tags.join("")}</div>` : ""}
            ${v.description_short ? `<p class="text-xs text-on-surface-variant/70 line-clamp-3 leading-relaxed">${esc(v.description_short)}</p>` : ""}
            ${skills ? `<div class="flex flex-wrap gap-1">${skills}</div>` : ""}
            <div class="flex gap-2 mt-auto pt-2 border-t border-outline-variant/10" data-actions>
                <button class="ms-apply-btn flex-1 px-4 py-2.5 rounded-lg bg-primary-container text-white font-bold text-sm hover:brightness-110 active:scale-[0.97] transition-all cursor-pointer" onclick="applyToVacancy('${esc(v.id)}', this.closest('.vacancy-card'))">Откликнуться</button>
                <button class="px-4 py-2.5 rounded-lg bg-surface-container text-on-surface-variant font-semibold text-sm hover:bg-surface-container-high transition-colors cursor-pointer" onclick="skipVacancy('${esc(v.id)}', this.closest('.vacancy-card'))">Пропустить</button>
                <a href="${esc(v.url)}" target="_blank" rel="noopener" class="px-3 py-2.5 rounded-lg bg-surface-container text-on-surface-variant hover:text-primary transition-colors flex items-center cursor-pointer" title="Открыть на hh.ru">
                    <span class="material-symbols-outlined text-lg">open_in_new</span>
                </a>
            </div>
        `;

        card.addEventListener("click", (e) => {
            if (e.target.closest("[data-actions]")) return;
            openVacancyModal(v.id);
        });

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
    // VACANCY DETAIL MODAL
    // ==================================================================

    let _currentModalId = null;
    const _detailCache = {};

    window.openVacancyModal = function openVacancyModal(vacancyId) {
        const v = _vacancyCache[vacancyId];
        if (!v) return;
        _currentModalId = vacancyId;

        const modal = $("vacancyModal");
        const card = $("vacancyModalCard");
        if (!modal || !card) return;

        const logo = $("vmLogo");
        const logoFallback = logo.nextElementSibling;
        if (v.employer_logo) {
            logo.src = v.employer_logo;
            logo.classList.remove("hidden");
            logoFallback.classList.add("hidden");
        } else {
            logo.classList.add("hidden");
            logoFallback.classList.remove("hidden");
        }

        const empLink = $("vmEmployerLink");
        empLink.textContent = v.employer_name || "";
        empLink.href = v.employer_url || "#";

        $("vmTitle").textContent = v.name || "";

        const tagsEl = $("vmTags");
        tagsEl.innerHTML = "";
        const tagData = [];
        if (v.salary_text) tagData.push({ text: v.salary_text, icon: "payments" });
        if (v.area) tagData.push({ text: v.area, icon: "location_on" });
        if (v.experience) tagData.push({ text: v.experience, icon: "work_history" });
        if (v.schedule) tagData.push({ text: v.schedule, icon: "schedule" });
        if (v.employment) tagData.push({ text: v.employment, icon: "work" });
        tagData.forEach((t) => {
            tagsEl.insertAdjacentHTML("beforeend", _tag(t.text, t.icon));
        });

        _populateDetailsGrid(v);

        $("vmOpenHH").href = v.url || "#";

        const applyBtn = $("vmApplyBtn");
        applyBtn.disabled = false;
        applyBtn.textContent = "Откликнуться";
        applyBtn.onclick = () => _modalApply(vacancyId);
        $("vmSkipBtn").onclick = () => _modalSkip(vacancyId);

        _showDescriptionState("loading");

        modal.classList.remove("pointer-events-none");
        modal.classList.remove("opacity-0");
        modal.setAttribute("aria-hidden", "false");
        requestAnimationFrame(() => {
            card.style.transform = "scale(1)";
            card.style.opacity = "1";
        });
        document.body.style.overflow = "hidden";

        _loadFullDescription(vacancyId);
    };

    function _populateDetailsGrid(v) {
        const grid = $("vmDetailsGrid");
        grid.innerHTML = "";
        const details = [];
        if (v.address) details.push(["Адрес", v.address]);
        if (v.work_format && v.work_format.length) details.push(["Формат", v.work_format.join(", ")]);
        if (v.working_hours && v.working_hours.length) details.push(["Часы", v.working_hours.join(", ")]);
        if (v.schedule_days && v.schedule_days.length) details.push(["График", v.schedule_days.join(", ")]);
        if (v.professional_roles && v.professional_roles.length) details.push(["Роль", v.professional_roles.join(", ")]);
        if (v.published_at) {
            const d = new Date(v.published_at);
            if (!isNaN(d)) details.push(["Опубликовано", d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })]);
        }
        if (v.has_test) details.push(["Тестовое", "Есть"]);
        if (v.response_letter_required) details.push(["Сопр. письмо", "Обязательно"]);

        details.forEach(([label, value]) => {
            grid.insertAdjacentHTML("beforeend",
                `<div class="vm-detail-cell"><div class="vm-detail-label">${esc(label)}</div><div class="vm-detail-value">${esc(value)}</div></div>`
            );
        });
    }

    function _showDescriptionState(state, data) {
        const descBlock = $("vmDescriptionBlock");
        const skillsBlock = $("vmSkillsBlock");

        if (state === "loading") {
            descBlock.innerHTML =
                '<div class="space-y-3">' +
                    '<div class="skeleton skeleton-block" style="height:14px;width:90%"></div>' +
                    '<div class="skeleton skeleton-block" style="height:14px;width:100%"></div>' +
                    '<div class="skeleton skeleton-block" style="height:14px;width:75%"></div>' +
                    '<div class="skeleton skeleton-block" style="height:14px;width:85%"></div>' +
                    '<div class="skeleton skeleton-block" style="height:14px;width:60%"></div>' +
                '</div>';
            descBlock.classList.remove("hidden");
            skillsBlock.innerHTML = "";
            skillsBlock.classList.add("hidden");
        } else if (state === "loaded") {
            if (data.description) {
                descBlock.innerHTML =
                    '<h4 class="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60 mb-3">Описание вакансии</h4>' +
                    '<div class="vm-description text-sm text-on-surface/90 leading-relaxed">' + _sanitizeHH(data.description) + '</div>';
                descBlock.classList.remove("hidden");
            } else {
                descBlock.classList.add("hidden");
            }

            if (data.key_skills && data.key_skills.length) {
                skillsBlock.innerHTML =
                    '<h4 class="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60 mb-2">Ключевые навыки</h4>' +
                    '<div class="flex flex-wrap gap-1.5">' +
                    data.key_skills.map((s) => `<span class="vacancy-tag">${esc(s)}</span>`).join("") +
                    '</div>';
                skillsBlock.classList.remove("hidden");
            } else {
                skillsBlock.classList.add("hidden");
            }
        } else if (state === "error") {
            const v = _vacancyCache[_currentModalId];
            let fallback = "";
            if (v && (v.requirement || v.responsibility)) {
                if (v.requirement) fallback += '<div class="mb-3"><h4 class="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60 mb-2">Требования</h4><p class="text-sm text-on-surface/90 leading-relaxed">' + v.requirement + '</p></div>';
                if (v.responsibility) fallback += '<div><h4 class="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60 mb-2">Обязанности</h4><p class="text-sm text-on-surface/90 leading-relaxed">' + v.responsibility + '</p></div>';
            }
            descBlock.innerHTML = fallback || '<p class="text-sm text-on-surface-variant/50">Не удалось загрузить описание</p>';
            descBlock.classList.remove("hidden");
            skillsBlock.innerHTML = "";
            skillsBlock.classList.add("hidden");
        }
    }

    async function _loadFullDescription(vacancyId) {
        if (_detailCache[vacancyId]) {
            if (_currentModalId === vacancyId) {
                _showDescriptionState("loaded", _detailCache[vacancyId]);
            }
            return;
        }

        try {
            const qs = buildAuthParams();
            const resp = await apiFetch(`/api/manual-search/detail?vacancy_id=${vacancyId}&${qs}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            _detailCache[vacancyId] = data;

            if (_currentModalId === vacancyId) {
                _showDescriptionState("loaded", data);
            }
        } catch (e) {
            console.error("[ManualSearch] detail fetch error:", e);
            if (_currentModalId === vacancyId) {
                _showDescriptionState("error");
            }
        }
    }

    function _sanitizeHH(html) {
        const allowed = ['p','br','ul','ol','li','b','strong','i','em','u','h1','h2','h3','h4','h5','h6','div','span','a'];
        const tmp = document.createElement("div");
        tmp.innerHTML = html;

        function walk(node) {
            const children = Array.from(node.childNodes);
            children.forEach((child) => {
                if (child.nodeType === 3) return;
                if (child.nodeType !== 1) { child.remove(); return; }
                const tag = child.tagName.toLowerCase();
                if (!allowed.includes(tag)) {
                    while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
                    child.remove();
                    return;
                }
                const attrs = Array.from(child.attributes);
                attrs.forEach((a) => {
                    if (tag === "a" && (a.name === "href" || a.name === "target" || a.name === "rel")) return;
                    child.removeAttribute(a.name);
                });
                if (tag === "a") {
                    child.setAttribute("target", "_blank");
                    child.setAttribute("rel", "noopener");
                    child.classList.add("text-primary", "hover:underline");
                }
                walk(child);
            });
        }

        walk(tmp);
        return tmp.innerHTML;
    }

    window.closeVacancyModal = function closeVacancyModal() {
        const modal = $("vacancyModal");
        const card = $("vacancyModalCard");
        if (!modal) return;

        card.style.transform = "scale(0.95)";
        card.style.opacity = "0";
        modal.classList.add("opacity-0");

        setTimeout(() => {
            modal.classList.add("pointer-events-none");
            modal.setAttribute("aria-hidden", "true");
            document.body.style.overflow = "";
            _currentModalId = null;
        }, 300);
    };

    async function _modalApply(vacancyId) {
        const cardEl = document.querySelector(`.vacancy-card[data-vacancy-id="${vacancyId}"]`);
        if (cardEl) {
            await window.applyToVacancy(vacancyId, cardEl);
        }
        closeVacancyModal();
    }

    function _modalSkip(vacancyId) {
        const cardEl = document.querySelector(`.vacancy-card[data-vacancy-id="${vacancyId}"]`);
        if (cardEl) {
            window.skipVacancy(vacancyId, cardEl);
        }
        closeVacancyModal();
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && _currentModalId) {
            closeVacancyModal();
        }
    });

    document.addEventListener("click", (e) => {
        if (_currentModalId && e.target.id === "vacancyModalBackdrop") {
            closeVacancyModal();
        }
    });

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
