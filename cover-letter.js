/*
   AURORA CAREER — Cover Letter Generator Tab
   (c) 2024-2026 Aurora Career. All rights reserved.
*/

(function () {
    "use strict";

    const API = window.AuroraSession
        ? window.AuroraSession.getApiBase()
        : ((window.location.hostname.includes("twc1.net") || window.location.hostname.includes("aurora-develop"))
            ? "https://api.aurora-develop.ru"
            : "https://api.aurora-career.ru");

    let _activeTab = "url";
    let _generating = false;
    let _lastResult = null;
    let _historyLoaded = false;

    // ── Helpers ──

    function _el(id) { return document.getElementById(id); }

    function _authParams() {
        const p = new URLSearchParams(window.location.search);
        const uid = p.get("user_id");
        const sign = p.get("sign");
        if (uid && sign) return { user_id: parseInt(uid, 10), sign, ts: parseInt(p.get("ts") || "0", 10) };
        return {};
    }

    function _escapeHtml(str) {
        const d = document.createElement("div");
        d.textContent = str;
        return d.innerHTML;
    }

    function _relativeTime(isoStr) {
        if (!isoStr) return "";
        const d = new Date(isoStr);
        const now = new Date();
        const diffMs = now - d;
        const mins = Math.floor(diffMs / 60000);
        if (mins < 1) return "только что";
        if (mins < 60) return `${mins} мин. назад`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours} ч. назад`;
        const days = Math.floor(hours / 24);
        if (days === 1) return "вчера";
        return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    }

    // ── Quota Ring ──

    function _updateQuotaRing(used, limit) {
        const circle = _el("clProgressCircle");
        const usedEl = _el("clUsedCount");
        const limitEl = _el("clLimitCount");
        if (!circle) return;

        const capped = Math.min(used, limit);
        const circumference = 364.4;
        const pct = limit > 0 ? capped / limit : 0;
        circle.style.strokeDashoffset = String(circumference * (1 - pct));

        if (usedEl) usedEl.textContent = String(used);
        if (limitEl) limitEl.textContent = String(limit);
    }

    // ── Input Tabs ──

    window.clSwitchInputTab = function (tab) {
        _activeTab = tab;
        const urlBlock = _el("clUrlInputBlock");
        const textBlock = _el("clTextInputBlock");
        const tabUrl = _el("clTabUrl");
        const tabText = _el("clTabText");

        if (tab === "url") {
            urlBlock.classList.remove("hidden");
            textBlock.classList.add("hidden");
            tabUrl.classList.add("active");
            tabText.classList.remove("active");
        } else {
            urlBlock.classList.add("hidden");
            textBlock.classList.remove("hidden");
            tabUrl.classList.remove("active");
            tabText.classList.add("active");
        }
        _hideError();
    };

    // ── Char counter ──

    function _initCharCounter() {
        const textarea = _el("clTextInput");
        const counter = _el("clCharCount");
        if (!textarea || !counter) return;
        textarea.addEventListener("input", function () {
            const len = textarea.value.length;
            counter.textContent = `${len.toLocaleString("ru-RU")} / 15 000`;
        });
    }

    // ── Error display ──

    function _showError(msg) {
        const el = _el("clError");
        if (!el) return;
        el.textContent = msg;
        el.classList.remove("hidden");
    }

    function _hideError() {
        const el = _el("clError");
        if (el) el.classList.add("hidden");
    }

    // ── Button state ──

    function _setGenerating(on) {
        _generating = on;
        const pairs = [
            ["clBtnText", "clBtnIcon", "clBtnSpinner", "clGenerateBtn"],
            ["clBtnText2", "clBtnIcon2", "clBtnSpinner2", "clGenerateBtnText"],
        ];
        pairs.forEach(([txtId, iconId, spinnerId, btnId]) => {
            const txt = _el(txtId);
            const icon = _el(iconId);
            const spinner = _el(spinnerId);
            const btn = _el(btnId);
            if (on) {
                if (txt) txt.textContent = "Генерация...";
                if (icon) icon.classList.add("hidden");
                if (spinner) spinner.classList.remove("hidden");
                if (btn) btn.disabled = true;
            } else {
                if (txt) txt.textContent = "Сгенерировать";
                if (icon) icon.classList.remove("hidden");
                if (spinner) spinner.classList.add("hidden");
                if (btn) btn.disabled = false;
            }
        });
    }

    // ── Generate ──

    window.generateCoverLetter = async function () {
        if (_generating) return;
        _hideError();

        const body = _authParams();

        if (_activeTab === "url") {
            const url = (_el("clUrlInput")?.value || "").trim();
            if (!url) { _showError("Вставьте ссылку на вакансию"); return; }
            if (!/hh\.ru\/vacancy\/\d+/.test(url)) { _showError("Ссылка должна быть вида hh.ru/vacancy/<id>"); return; }
            body.vacancy_url = url;
        } else {
            const text = (_el("clTextInput")?.value || "").trim();
            if (!text || text.length < 20) { _showError("Введите текст вакансии (минимум 20 символов)"); return; }
            body.vacancy_text = text;
        }

        _setGenerating(true);

        try {
            const resp = await fetch(`${API}/api/cover-letter/generate`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (resp.status === 429) {
                const data = await resp.json().catch(() => ({}));
                _showError(data.detail || "Лимит генераций исчерпан на сегодня");
                return;
            }
            if (resp.status === 401) {
                _showError("Сессия истекла. Перезайдите в аккаунт.");
                return;
            }
            if (!resp.ok) {
                const data = await resp.json().catch(() => ({}));
                _showError(data.detail || "Ошибка генерации");
                return;
            }

            const data = await resp.json();
            _lastResult = data;

            _renderResult(data);

            if (data.quota) _updateQuotaRing(data.quota.used, data.quota.limit);

            _loadHistory();

        } catch (e) {
            _showError("Сетевая ошибка. Проверьте подключение.");
        } finally {
            _setGenerating(false);
        }
    };

    // ── Render result ──

    function _renderResult(data) {
        const section = _el("clResultSection");
        if (!section) return;

        const employerEl = _el("clResultEmployer");
        const vacancyEl = _el("clResultVacancy");
        const textEl = _el("clResultText");
        const metaRow = _el("clResultMetaRow");

        const emp = (data.employer_name && String(data.employer_name).trim()) || "";
        const vac = (data.vacancy_title && String(data.vacancy_title).trim()) || "";

        if (employerEl) employerEl.textContent = emp;
        if (vacancyEl) vacancyEl.textContent = vac;
        if (textEl) textEl.textContent = data.cover_text || "";

        if (metaRow) {
            if (emp || vac) metaRow.classList.remove("hidden");
            else metaRow.classList.add("hidden");
        }

        section.classList.remove("hidden");
        section.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // ── Copy ──

    window.clCopyResult = async function () {
        const text = _el("clResultText")?.textContent;
        if (!text) return;

        try {
            await navigator.clipboard.writeText(text);
            const icon = _el("clCopyFloatingIcon");
            if (icon) icon.textContent = "check";
            setTimeout(() => {
                if (icon) icon.textContent = "content_copy";
            }, 2000);
        } catch {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
        }
    };

    // ── History ──

    async function _loadHistory() {
        try {
            const params = new URLSearchParams(window.location.search);
            let url = `${API}/api/cover-letter/history`;
            const uid = params.get("user_id");
            const sign = params.get("sign");
            if (uid && sign) {
                url += `?user_id=${uid}&sign=${sign}`;
                const ts = params.get("ts");
                if (ts) url += `&ts=${ts}`;
            }

            const resp = await fetch(url, { credentials: "include" });
            if (!resp.ok) return;
            const data = await resp.json();

            if (data.quota) _updateQuotaRing(data.quota.used, data.quota.limit);

            _renderHistory(data.items || []);
            _historyLoaded = true;
        } catch {
            // silently fail
        }
    }

    function _renderHistory(items) {
        const section = _el("clHistorySection");
        const list = _el("clHistoryList");
        const empty = _el("clHistoryEmpty");
        const badge = _el("clHistoryBadge");

        if (!section || !list) return;

        if (badge) badge.textContent = String(items.length);

        if (items.length === 0) {
            section.classList.remove("hidden");
            list.innerHTML = "";
            if (empty) empty.classList.remove("hidden");
            return;
        }

        if (empty) empty.classList.add("hidden");
        section.classList.remove("hidden");

        list.innerHTML = "";
        items.forEach((item, idx) => {
            const card = _createHistoryCard(item, idx);
            list.appendChild(card);
        });
    }

    function _createHistoryCard(item, idx) {
        const card = document.createElement("div");
        card.className = "glass-panel rounded-[12px] overflow-hidden transition-all duration-200 group";

        const header = document.createElement("button");
        header.type = "button";
        header.className = "w-full flex items-center justify-between p-4 md:p-5 text-left cursor-pointer hover:bg-surface-container-highest/40 transition-colors";
        header.setAttribute("aria-expanded", "false");

        const left = document.createElement("div");
        left.className = "flex items-center gap-3 min-w-0 flex-1";

        const iconWrap = document.createElement("div");
        iconWrap.className = "w-9 h-9 rounded-full bg-primary-container/20 flex items-center justify-center shrink-0";
        const icon = document.createElement("span");
        icon.className = "material-symbols-outlined text-primary text-base";
        icon.style.fontVariationSettings = "'FILL' 1";
        icon.textContent = item.input_type === "url" ? "link" : "article";
        iconWrap.appendChild(icon);
        left.appendChild(iconWrap);

        const info = document.createElement("div");
        info.className = "min-w-0";
        const title = document.createElement("p");
        title.className = "text-sm font-semibold text-on-surface truncate";
        title.textContent = item.vacancy_title || item.employer_name || "Сопроводительное письмо";
        info.appendChild(title);

        const meta = document.createElement("p");
        meta.className = "text-xs text-on-surface-variant/60 mt-0.5";
        const parts = [];
        if (item.employer_name && item.vacancy_title) parts.push(item.employer_name);
        parts.push(_relativeTime(item.created_at));
        meta.textContent = parts.join(" · ");
        info.appendChild(meta);
        left.appendChild(info);

        const right = document.createElement("div");
        right.className = "flex items-center gap-2 shrink-0 ml-3";

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "p-2 rounded-lg hover:bg-surface-variant text-on-surface-variant transition-colors cursor-pointer";
        copyBtn.title = "Копировать";
        copyBtn.innerHTML = '<span class="material-symbols-outlined text-base">content_copy</span>';
        copyBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            _copyHistoryItem(item.cover_text, copyBtn);
        });
        right.appendChild(copyBtn);

        const chevron = document.createElement("span");
        chevron.className = "material-symbols-outlined text-on-surface-variant/40 text-xl transition-transform duration-200 cl-chevron";
        chevron.textContent = "expand_more";
        right.appendChild(chevron);

        header.appendChild(left);
        header.appendChild(right);
        card.appendChild(header);

        const body = document.createElement("div");
        body.className = "hidden px-5 pb-5 md:px-6 md:pb-6";

        if (item.vacancy_url) {
            const link = document.createElement("a");
            link.href = item.vacancy_url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.className =
                "cl-vacancy-link inline-flex items-center gap-1.5 text-xs font-semibold text-primary mb-3 " +
                "border-b border-transparent hover:border-primary pb-0.5 transition-colors cursor-pointer " +
                "no-underline decoration-0";
            const ic = document.createElement("span");
            ic.className = "material-symbols-outlined text-sm shrink-0 leading-none";
            ic.textContent = "open_in_new";
            const tx = document.createElement("span");
            tx.className = "leading-snug";
            tx.textContent = "Открыть вакансию";
            link.appendChild(ic);
            link.appendChild(tx);
            body.appendChild(link);
        }

        const textWrap = document.createElement("div");
        textWrap.className = "bg-surface-container-lowest rounded-lg p-4 text-sm text-on-surface leading-relaxed whitespace-pre-wrap select-all border border-outline-variant/10";
        textWrap.textContent = item.cover_text;
        body.appendChild(textWrap);

        card.appendChild(body);

        header.addEventListener("click", function () {
            const expanded = body.classList.toggle("hidden");
            header.setAttribute("aria-expanded", String(!expanded));
            chevron.style.transform = expanded ? "" : "rotate(180deg)";
        });

        card.style.animation = `card-in 0.3s ease-out ${idx * 0.05}s both`;

        return card;
    }

    async function _copyHistoryItem(text, btn) {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
        }
        const iconEl = btn.querySelector(".material-symbols-outlined");
        if (iconEl) {
            iconEl.textContent = "check";
            setTimeout(() => { iconEl.textContent = "content_copy"; }, 1500);
        }
    }

    // ── Public: load data when tab becomes visible ──

    window.clLoadData = function () {
        if (!_historyLoaded) _loadHistory();
    };

    // ── Init ──

    _initCharCounter();

})();
