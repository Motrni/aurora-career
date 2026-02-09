/* 
   AURORA CAREER SETTINGS - PROPRIETARY CODE 
   (c) 2024-2025 Aurora Career. All rights reserved.
*/

const API_BASE_URL = "https://api.aurora-career.ru";

// State
let initialSettings = {};
let allIndustries = [];
let currentSelectedIds = new Set();
let messageId = null;
window.BOT_USERNAME = "Aurora_Career_Bot"; // Default

// Loading Flags
let isIndustriesLoaded = false;
let isSettingsLoaded = false;

document.addEventListener("DOMContentLoaded", async () => {
    // Show Skeleton immediately
    toggleGlobalLoading(true);

    // 1. URL Params
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('user_id');
    const sign = urlParams.get('sign');
    messageId = urlParams.get('message_id'); // Optional

    if (!userId || !sign) {
        showError("Ошибка доступа. Ссылка не содержит необходимых параметров.");
        toggleGlobalLoading(false); // Show content (with error)
        return;
    }

    // 2. Salary Logic
    const salaryInput = document.getElementById("salaryInput");
    const noSalaryCheckbox = document.getElementById("noSalaryCheckbox");

    noSalaryCheckbox.addEventListener("change", (e) => {
        if (e.target.checked) {
            salaryInput.value = "";
            salaryInput.disabled = true;
            salaryInput.placeholder = "Не указана";
            salaryInput.style.borderColor = "#333";
        } else {
            salaryInput.disabled = false;
            salaryInput.placeholder = "Например: 100000";
            salaryInput.focus();
        }
    });

    // 3. Search Logic
    const searchInput = document.getElementById("industrySearch");
    searchInput.addEventListener("input", (e) => {
        const text = e.target.value.trim().toLowerCase();
        filterIndustryTree(text);
    });

    // 4. Return Button
    document.getElementById("returnBtn").addEventListener("click", () => {
        // Try to close webview if possible, otherwise redirect
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.close();
        }
        // Fallback redirection
        window.location.href = `https://t.me/${window.BOT_USERNAME}`;
    });

    // 5. Load Data (Parallel)
    loadIndustriesDict();
    loadSettings(userId, sign);

    // 6. Save Logic
    document.getElementById("saveBtn").addEventListener("click", async () => {
        try {
            await saveSettings(userId, sign);
        } catch (e) {
            showError("Ошибка при сохранении. " + e.message);
        }
    });

    // 7. Query Mode Toggle Logic
    const queryToggle = document.getElementById("queryModeToggle");
    const simpleEditor = document.getElementById("simpleQueryEditor");
    const advancedEditor = document.getElementById("advancedQueryEditor");
    const modeLabel = document.getElementById("modeLabel");

    queryToggle.addEventListener("change", (e) => {
        const isAdvanced = e.target.checked;

        if (isAdvanced) {
            // Simple -> Advanced
            modeLabel.innerText = "Расширенный режим (Boolean Query)";
            simpleEditor.style.display = "none";
            advancedEditor.style.display = "block";

            // Convert Keywords -> Boolean String
            const inc = document.getElementById("keywordsInclude").value;
            const exc = document.getElementById("keywordsExclude").value;

            // Only overwrite if boolean input is empty or we want to sync
            // For now: always sync from keywords if they exist
            const boolStr = buildBooleanQuery(inc, exc);
            if (boolStr) {
                document.getElementById("booleanQueryInput").value = boolStr;
            }

        } else {
            // Advanced -> Simple
            modeLabel.innerText = "Простой режим (Ключевые слова)";
            simpleEditor.style.display = "block";
            advancedEditor.style.display = "none";

            // Try parse Boolean -> Keywords
            const boolVal = document.getElementById("booleanQueryInput").value;
            const parsed = parseBooleanQuery(boolVal);

            if (parsed) {
                document.getElementById("keywordsInclude").value = parsed.included.join(", ");
                document.getElementById("keywordsExclude").value = parsed.excluded.join(", ");
            } else {
                // If too complex, maybe warn? Or just leave as is.
                // console.log("Complex query, cannot revert fully");
            }
        }
    });
});

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

async function loadSettings(userId, sign) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/get?user_id=${userId}&sign=${sign}`, {
            method: "GET",
            headers: { "Content-Type": "application/json" }
        });

        const data = await response.json();
        if (data.status !== "ok") {
            throw new Error(data.error || "Неизвестная ошибка");
        }

        if (data.bot_username) {
            window.BOT_USERNAME = data.bot_username;
        }

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
        }

        // Experience
        if (settings.experience) {
            document.getElementById("experienceSelect").value = settings.experience;
        }

        // Region
        if (settings.search_area) {
            document.getElementById("cityStatus").innerText = `Текущий регион ID: ${settings.search_area}`;
        } else {
            document.getElementById("cityStatus").innerText = "Регион не выбран";
        }

        // Schedule
        if (settings.search_schedule) {
            let sched = [];
            try { sched = JSON.parse(settings.search_schedule); } catch (e) { sched = []; }
            // If string comes as ['remote'], it might be parsed or not. 
            // Assume backend sends JSON string or list. 
            // If it's pure string from DB "['remote']", we need to parse.
            if (typeof settings.search_schedule === 'string') {
                try { sched = JSON.parse(settings.search_schedule); } catch (e) { }
            } else if (Array.isArray(settings.search_schedule)) {
                sched = settings.search_schedule;
            }

            sched.forEach(val => {
                const cb = document.querySelector(`#scheduleContainer input[value="${val}"]`);
                if (cb) cb.checked = true;
            });
        }

        // Query Mode & Boolean Logic
        const mode = settings.query_mode || 'simple';
        const isAdvanced = (mode === 'advanced');
        document.getElementById("queryModeToggle").checked = isAdvanced;

        // Load Keywords
        const keys = settings.keywords_data || { included: [], excluded: [] };
        document.getElementById("keywordsInclude").value = (keys.included || []).join(", ");
        document.getElementById("keywordsExclude").value = (keys.excluded || []).join(", ");

        // Load Boolean Draft or Custom Query
        // If we represent the custom_query as the boolean input
        let boolVal = settings.boolean_draft || settings.custom_query || "";
        document.getElementById("booleanQueryInput").value = boolVal;

        // Trigger Switch UI
        const queryToggle = document.getElementById("queryModeToggle");
        queryToggle.dispatchEvent(new Event('change')); // Update UI visibility

        // Industries
        let inds = settings.industry || [];
        if (typeof inds === 'string') {
            try { inds = JSON.parse(inds); } catch (e) { inds = []; }
        }

        currentSelectedIds = new Set(inds.map(String));

    } catch (e) {
        showError("Не удалось загрузить настройки. " + e.message);
    } finally {
        isSettingsLoaded = true;
        tryInitTree();
    }
}

function tryInitTree() {
    // Render only when BOTH sources are ready to avoid overwriting or empty renders
    if (isIndustriesLoaded && isSettingsLoaded) {
        initIndustryTree();
        toggleGlobalLoading(false);
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

            // Check if selected (Directly OR via Parent)
            // Fix: If API returns parent ID (e.g. "36"), all children should be checked.
            if (currentSelectedIds.has(subIdStr) || currentSelectedIds.has(catIdStr)) {
                subCheckbox.checked = true;
            }

            const subLabel = document.createElement("span");
            subLabel.className = "ind-sub-label";
            subLabel.innerText = sub.name;

            subLabel.onclick = () => { subCheckbox.checked = !subCheckbox.checked; updateState(); };
            subDiv.appendChild(subCheckbox);
            subDiv.appendChild(subLabel);
            childrenContainer.appendChild(subDiv);

            // Change event for child
            subCheckbox.addEventListener("change", () => {
                updateState(true); // pass true to indicate manual interaction
            });
        });

        catDiv.appendChild(childrenContainer);
        container.appendChild(catDiv);

        // Initial State Update (without moving)
        updateParentCheckboxState(catCheckbox, childrenContainer);
        // Also ensure parent ID is in set if checked
        if (catCheckbox.checked && !catCheckbox.indeterminate) currentSelectedIds.add(catIdStr);


        const toggle = () => {
            childrenContainer.classList.toggle("open");
            toggleIcon.classList.toggle("expanded");
        };

        toggleIcon.onclick = (e) => { e.stopPropagation(); toggle(); };
        catLabel.onclick = toggle;

        // Change event for parent
        catCheckbox.addEventListener("change", () => {
            const childrenInputs = childrenContainer.querySelectorAll("input[data-type='child']");
            childrenInputs.forEach(ch => ch.checked = catCheckbox.checked);
            updateState(true); // pass true to indicate manual interaction
        });

        function updateState(isInteraction = false) {
            updateParentCheckboxState(catCheckbox, childrenContainer);

            // Sync Set
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

            // --- DYNAMIC SORTING (On Interaction) ---
            if (isInteraction) {
                const isSelected = catCheckbox.checked || catCheckbox.indeterminate;
                if (isSelected) {
                    // Move to top
                    container.prepend(catDiv);
                    // Scroll container to top
                    // Use standard block scrolling (or smooth depends on UX)
                    // User said "scroll the list to the top"
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

async function saveSettings(userId, sign) {
    const salaryInput = document.getElementById("salaryInput");
    const noSalaryCheckbox = document.getElementById("noSalaryCheckbox");

    let salary = null;

    if (!noSalaryCheckbox.checked) {
        let val = salaryInput.value.trim();
        if (val === "") {
            showError("Введите сумму или поставьте галочку 'Не указывать'");
            return;
        }
        salary = parseInt(val);
        if (isNaN(salary) || salary < 0) {
            showError("Зарплата должна быть положительным числом!");
            return;
        }
        if (salary > 100000000) {
            showError("Зарплата не может превышать 100 млн ₽");
            return;
        }
    }

    const experience = document.getElementById("experienceSelect").value;
    const selectedIndustries = finalizeIdsFromSet();

    // Schedule
    const scheduleInputs = document.querySelectorAll("#scheduleContainer input:checked");
    const selectedSchedule = Array.from(scheduleInputs).map(cb => cb.value);

    // Query Data
    const isAdvanced = document.getElementById("queryModeToggle").checked;
    const queryMode = isAdvanced ? 'advanced' : 'simple';

    const incStr = document.getElementById("keywordsInclude").value;
    const excStr = document.getElementById("keywordsExclude").value;
    const keywordsData = {
        included: incStr.split(',').map(s => s.trim()).filter(s => s),
        excluded: excStr.split(',').map(s => s.trim()).filter(s => s)
    };

    const booleanDraft = document.getElementById("booleanQueryInput").value;

    // Logic: What is the final custom_query?
    let finalQuery = "";
    if (isAdvanced) {
        finalQuery = booleanDraft; // Whatever is in textarea
    } else {
        finalQuery = buildBooleanQuery(incStr, excStr);
    }

    const payload = {
        user_id: parseInt(userId),
        sign: sign,
        salary: salary,
        experience: experience,
        industry: selectedIndustries,
        work_formats: selectedSchedule, // [NEW]
        query_mode: queryMode,          // [NEW]
        keywords: keywordsData,         // [NEW]
        boolean_draft: booleanDraft,    // [NEW]
        custom_query: finalQuery,       // [NEW]
        message_id: messageId ? parseInt(messageId) : null
    };

    const response = await fetch(`${API_BASE_URL}/api/settings/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (data.status !== "ok") {
        throw new Error(data.error || "Ошибка сервера");
    }

    const saveBtn = document.getElementById("saveBtn");
    const originalText = saveBtn.innerText;
    saveBtn.innerText = "Сохранено! ✅";
    saveBtn.style.background = "#4caf50";
    setTimeout(() => {
        saveBtn.innerText = originalText;
        saveBtn.style.background = "linear-gradient(45deg, #a962ff, #6247aa)";
    }, 2000);

    initialSettings = {
        salary: salary,
        experience: experience,
        industry: selectedIndustries,
        // Update other init states if needed for dirty checking
    };

    document.getElementById("errorMsg").style.display = "none";
}

function showError(msg) {
    const errDiv = document.getElementById("errorMsg");
    errDiv.innerText = msg;
    errDiv.style.display = "block";
}
