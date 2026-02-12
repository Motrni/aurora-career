/* 
   AURORA CAREER SETTINGS - PROPRIETARY CODE 
   (c) 2024-2025 Aurora Career. All rights reserved.
*/

const API_BASE_URL = "https://api.aurora-career.ru";

// State
let initialSettings = {};
let allIndustries = [];
let allAreas = []; // [NEW]
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

function sortAreas(areas) {
    return [...areas].sort((a, b) => {
        const idA = String(a.id);
        const idB = String(b.id);
        const selA = currentSelectedAreaIds.has(idA);
        const selB = currentSelectedAreaIds.has(idB);

        if (selA && !selB) return -1;
        if (!selA && selB) return 1;
        return a.name.localeCompare(b.name);
    });
}

function initAreaTree() {
    const container = document.getElementById("regionTree");
    if (!container) return;
    container.innerHTML = "";

    if (!allAreas || allAreas.length === 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">Нет данных</div>';
        return;
    }

    // Render only top-level nodes initially for performance
    const list = document.createElement("div");
    list.className = "area-list-root";

    sortAreas(allAreas).forEach(area => {
        list.appendChild(createAreaNode(area));
    });

    container.appendChild(list);
    updateSelectedRegionsSummary();
}

function createAreaNode(area, forceExpand = false) {
    const idStr = String(area.id);
    const hasChildren = area.areas && area.areas.length > 0;

    const nodeDiv = document.createElement("div");
    nodeDiv.className = "area-node";
    nodeDiv.dataset.id = idStr;
    nodeDiv.style.marginLeft = "12px";

    // Header (Icon + Checkbox + Label)
    const headerDiv = document.createElement("div");
    headerDiv.className = "area-header";
    headerDiv.style.display = "flex";
    headerDiv.style.alignItems = "center";
    headerDiv.style.padding = "4px 0";

    // Icons
    const expandIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; color: #888;"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
    const collapseIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; color: #a962ff;"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

    // Toggle Icon Container
    const toggleIcon = document.createElement("div");
    toggleIcon.className = "toggle-icon";
    toggleIcon.style.width = "20px";
    toggleIcon.style.height = "20px";
    toggleIcon.style.display = "flex";
    toggleIcon.style.alignItems = "center";
    toggleIcon.style.justifyContent = "center";
    toggleIcon.style.cursor = "pointer";
    toggleIcon.innerHTML = hasChildren ? expandIcon : "";

    // Checkbox
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "custom-checkbox"; // Uses existing CSS
    checkbox.value = idStr;
    if (currentSelectedAreaIds.has(idStr)) {
        checkbox.checked = true;
    }

    // Label
    const label = document.createElement("span");
    label.className = "area-label";
    label.innerText = area.name;
    label.style.marginLeft = "8px";
    label.style.cursor = "pointer";
    label.style.color = "#ececec";
    label.style.fontSize = "0.95rem";
    label.style.userSelect = "none";

    // Hover effect
    label.onmouseover = () => label.style.color = "#fff";
    label.onmouseout = () => label.style.color = "#ececec";

    headerDiv.appendChild(toggleIcon);
    headerDiv.appendChild(checkbox);
    headerDiv.appendChild(label);
    nodeDiv.appendChild(headerDiv);

    // Children Container (Lazy Loaded)
    let childrenContainer = null;
    let areChildrenRendered = false;

    if (hasChildren) {
        childrenContainer = document.createElement("div");
        childrenContainer.className = "area-children";
        childrenContainer.style.display = forceExpand ? "block" : "none";
        childrenContainer.style.borderLeft = "1px solid #333";
        childrenContainer.style.marginLeft = "9px"; // Align with icon center

        nodeDiv.appendChild(childrenContainer);

        if (forceExpand) {
            toggleIcon.innerHTML = collapseIcon;
            renderChildren();
        }

        function renderChildren() {
            if (areChildrenRendered) return;
            // Sort children too
            const sortedChildren = sortAreas(area.areas);
            sortedChildren.forEach(child => {
                childrenContainer.appendChild(createAreaNode(child, false));
            });
            areChildrenRendered = true;
        }

        const toggle = (e) => {
            e.stopPropagation();
            const isClosed = childrenContainer.style.display === "none";
            if (isClosed) {
                childrenContainer.style.display = "block";
                toggleIcon.innerHTML = collapseIcon;
                renderChildren();
            } else {
                childrenContainer.style.display = "none";
                toggleIcon.innerHTML = expandIcon;
            }
        };

        toggleIcon.onclick = toggle;
        // Clicking label toggles expand for parents, toggles checkbox for leaves?
        // User wants: "Select Russia OR Moscow". 
        // Let's make label toggle checkbox for better UX, expand only on icon?
        // Or label expands? Standard UI: Label selects, Icon expands.
        // But if label selects, it's easier.
        // Let's make label click toggle selection to avoid confusion.
        label.onclick = () => checkbox.click();
    } else {
        label.onclick = () => checkbox.click();
    }

    // Checkbox Logic (Independent)
    checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
            currentSelectedAreaIds.add(idStr);
        } else {
            currentSelectedAreaIds.delete(idStr);
        }
        updateSelectedRegionsSummary();
    });

    return nodeDiv;
}

function updateSelectedRegionsSummary() {
    // We removed the summary element per user request? 
    // "remove 'World' text between search and regions"
    // But we might want to update some counter if it exists.
    const el = document.getElementById("selectedRegionsSummary");
    if (!el) return;

    const count = currentSelectedAreaIds.size;
    if (count === 0) {
        el.innerText = "🌍 Весь мир"; // Or hidden
        el.style.display = "none"; // Hide if empty per request? Or show "World"
    } else {
        el.style.display = "block";
        el.innerText = `Выбрано: ${count}`;
        el.style.color = "#a962ff";
    }
}

function filterAreaTree(text) {
    if (areaSearchTimeout) clearTimeout(areaSearchTimeout);

    areaSearchTimeout = setTimeout(() => {
        performAreaSearch(text);
    }, 300); // 300ms debounce
}

function performAreaSearch(text) {
    const container = document.getElementById("regionTree");
    if (!container) return;

    if (!text) {
        // Restore full tree (top level)
        initAreaTree();
        return;
    }

    // Flat search for performance
    // We need to find all matching nodes and render them as a flat list
    // OR render a filtered tree. A flat list with path (Country > Region > City) is often better for search.

    container.innerHTML = "";
    const list = document.createElement("div");
    list.style.padding = "4px";

    let count = 0;
    const maxResults = 50;

    function searchRecursive(node, pathName) {
        if (count >= maxResults) return;

        // Check match
        if (node.name.toLowerCase().includes(text)) {
            const item = createSearchResultItem(node, pathName);
            list.appendChild(item);
            count++;
        }

        // Recurse
        if (node.areas) {
            node.areas.forEach(child => {
                const childPath = pathName ? `${pathName} > ${node.name}` : node.name;
                searchRecursive(child, childPath);
            });
        }
    }

    allAreas.forEach(area => searchRecursive(area, ""));

    if (count === 0) {
        list.innerHTML = '<div style="color:#666; padding:10px; text-align:center;">Ничего не найдено</div>';
    } else if (count >= maxResults) {
        const more = document.createElement("div");
        more.innerText = "...и еще результаты (уточните запрос)";
        more.style.color = "#666";
        more.style.padding = "8px";
        more.style.fontSize = "0.85rem";
        more.style.textAlign = "center";
        list.appendChild(more);
    }

    container.appendChild(list);
}

function createSearchResultItem(area, pathContext) {
    const div = document.createElement("div");
    div.className = "area-search-result";
    div.style.padding = "6px 8px";
    div.style.borderBottom = "1px solid #222";
    div.style.display = "flex";
    div.style.alignItems = "center";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "custom-checkbox";
    checkbox.value = String(area.id);
    if (currentSelectedAreaIds.has(String(area.id))) checkbox.checked = true;

    checkbox.onchange = () => {
        if (checkbox.checked) currentSelectedAreaIds.add(String(area.id));
        else currentSelectedAreaIds.delete(String(area.id));
        updateSelectedRegionsSummary();
    };

    const textDiv = document.createElement("div");
    textDiv.style.marginLeft = "10px";

    const nameDiv = document.createElement("div");
    nameDiv.innerText = area.name;
    nameDiv.style.color = "#fff";

    const pathDiv = document.createElement("div");
    pathDiv.innerText = pathContext || "Страна";
    pathDiv.style.color = "#666";
    pathDiv.style.fontSize = "0.8rem";

    textDiv.appendChild(nameDiv);
    textDiv.appendChild(pathDiv);

    div.appendChild(checkbox);
    div.appendChild(textDiv);

    // Allow clicking row to toggle
    div.onclick = (e) => {
        if (e.target !== checkbox) checkbox.click();
    };
    div.style.cursor = "pointer";
    div.onmouseover = () => div.style.background = "rgba(255,255,255,0.05)";
    div.onmouseout = () => div.style.background = "transparent";

    return div;
}
