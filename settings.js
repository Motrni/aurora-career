/* 
   AURORA CAREER SETTINGS - PROPRIETARY CODE 
   (c) 2024-2025 Aurora Career. All rights reserved.
*/

const API_BASE_URL = "https://api.aurora-career.ru";

// State
let initialSettings = {};
let allIndustries = [];
let allAreas = []; // [NEW]
let flatAreaMap = {}; // [NEW] ID -> Name lookup
let currentSelectedIds = new Set();
let currentSelectedAreaIds = new Set(); // [NEW]
let messageId = null;
window.BOT_USERNAME = "Aurora_Career_Bot"; // Default

// Loading Flags
let isIndustriesLoaded = false;
let isAreasLoaded = false; // [NEW]
let isSettingsLoaded = false;

document.addEventListener("DOMContentLoaded", async () => {
    // Show Skeleton immediately
    toggleGlobalLoading(true);

    // 0. Initialize UI Components (Tag Inputs)
    window.tagsInclude = new TagInput("tagsIncludeContainer", "keywordsIncludeInput");
    window.tagsExclude = new TagInput("tagsExcludeContainer", "keywordsExcludeInput");

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

    // 3.1 Region Search
    const regionSearch = document.getElementById("regionSearch");
    if (regionSearch) {
        regionSearch.addEventListener("input", (e) => {
            const text = e.target.value.trim().toLowerCase();
            filterAreaTree(text);
        });
    }

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
    loadAreasDict(); // [NEW]
    loadSettings(userId, sign);

    // 6. Save Logic
    document.getElementById("saveBtn").addEventListener("click", async () => {
        try {
            await saveSettings(userId, sign);
        } catch (e) {
            showError("Ошибка при сохранении. " + e.message);
        }
    });

    // 7. Query Mode Logic (RESTORED & IMPROVED)
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
            // No Sync: independent modes
        } else {
            simpleBtn.classList.remove('active');
            advancedBtn.classList.add('active');
            simpleEditor.style.display = 'none';
            advancedEditor.style.display = 'block';
            // No Sync: independent modes
        }
    };

}); // End of DOMContentLoaded

// --- TAG INPUT CLASS ---
class TagInput {
    constructor(containerId, inputId) {
        this.container = document.getElementById(containerId);
        this.input = document.getElementById(inputId);
        this.tags = [];

        if (!this.container || !this.input) return;

        this.input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                const val = this.input.value.trim();
                if (val) {
                    this.addTag(val);
                    this.input.value = "";
                }
            }
            if (e.key === "Backspace" && this.input.value === "" && this.tags.length > 0) {
                this.removeTag(this.tags.length - 1);
            }
        });

        this.container.addEventListener("click", () => {
            this.input.focus();
        });
    }

    addTag(text) {
        // Prevent duplicates
        if (this.tags.includes(text)) return;
        this.tags.push(text);
        this.render();
    }

    removeTag(index) {
        this.tags.splice(index, 1);
        this.render();
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
                <span>${tagText}</span>
                <div class="tag-remove" onclick="this.parentNode.remove(); window.${this === window.tagsInclude ? 'tagsInclude' : 'tagsExclude'}.removeTag(${index})">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </div>
            `;
            // Insert before input
            this.container.insertBefore(tag, this.input);
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
        // Region
        // Old: search_area (int) -> New: search_areas (list[int])
        currentSelectedAreaIds.clear();

        let areaIds = [];
        if (settings.search_areas && Array.isArray(settings.search_areas)) {
            // New format
            areaIds = settings.search_areas;
        } else if (settings.search_area && settings.search_area !== 113) {
            // Legacy fallback
            areaIds = [settings.search_area];
        }

        areaIds.forEach(id => currentSelectedAreaIds.add(String(id)));
        updateSelectedRegionsSummary();

        // Schedule (Work Formats)
        // [FIX] Priority: work_formats (new) > search_schedule (old)
        let scheduleData = settings.work_formats || settings.search_schedule;

        if (scheduleData) {
            let sched = [];
            if (typeof scheduleData === 'string') {
                try { sched = JSON.parse(scheduleData); } catch (e) { sched = []; }
            } else if (Array.isArray(scheduleData)) {
                sched = scheduleData;
            }

            sched.forEach(val => {
                // Try uppercase, then original
                let cb = document.querySelector(`#scheduleContainer input[value="${val.toUpperCase()}"]`);
                if (!cb) cb = document.querySelector(`#scheduleContainer input[value="${val}"]`);
                if (cb) cb.checked = true;
            });
        }

        // Query Mode & Boolean Logic
        const mode = settings.query_mode || 'simple';

        // Load Keywords -> Tags
        const keys = settings.keywords_data || { included: [], excluded: [] };
        if (window.tagsInclude) window.tagsInclude.setTags(keys.included || []);
        if (window.tagsExclude) window.tagsExclude.setTags(keys.excluded || []);

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
    // Render only when ALL sources are ready
    if (isIndustriesLoaded && isSettingsLoaded && isAreasLoaded) {
        initIndustryTree();
        initAreaTree(); // [NEW]
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

            subCheckbox.addEventListener("change", () => {
                updateState(true);
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
        search_areas: Array.from(currentSelectedAreaIds).map(Number), // [NEW]
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
        work_formats: selectedSchedule
    };

    document.getElementById("errorMsg").style.display = "none";
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
        const name = flatAreaMap[idStr] || `ID: ${idStr}`; // Fallback if name not found

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
            // Remove logic
            currentSelectedAreaIds.delete(idStr);
            // Re-render this list
            renderSelectedRegions();
            // Update checkbox in tree (if visible)
            const checkbox = document.querySelector(`#regionTree input[value="${idStr}"]`);
            if (checkbox) checkbox.checked = false;
        };

        chip.appendChild(text);
        chip.appendChild(close);
        listContainer.appendChild(chip);
    });
}

function clearAllRegions() {
    currentSelectedAreaIds.clear();
    renderSelectedRegions();
    // Uncheck visible checkboxes
    const checkboxes = document.querySelectorAll("#regionTree input:checked");
    checkboxes.forEach(cb => cb.checked = false);
}

function updateSelectedRegionsSummary() {
    // Replaced by renderSelectedRegions, but kept for compatibility if called elsewhere
    renderSelectedRegions();
}
}
