
// settings.js

// КОНФИГУРАЦИЯ
const API_BASE_URL = "https://api.aurora-career.ru";

// Храним состояние
let initialSettings = {};
let allIndustries = []; // Кэш индустрий
let currentSelectedIds = new Set(); // Текущие выбранные ID

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Параметры URL
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('user_id');
    const sign = urlParams.get('sign');

    if (!userId || !sign) {
        showError("Ошибка доступа. Ссылка не содержит необходимых параметров.");
        return;
    }

    // 2. Логика зарплаты
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

    // 3. Поиск индустрии
    const searchInput = document.getElementById("industrySearch");
    searchInput.addEventListener("input", (e) => {
        const text = e.target.value.trim().toLowerCase();
        filterIndustryTree(text);
    });

    // 4. Загрузка данных
    try {
        await loadIndustriesDict();
        await loadSettings(userId, sign);
    } catch (e) {
        showError("Не удалось загрузить настройки. " + e.message);
    }

    // 5. Сохранение
    document.getElementById("saveBtn").addEventListener("click", async () => {
        try {
            await saveSettings(userId, sign);
        } catch (e) {
            showError("Ошибка при сохранении. " + e.message);
        }
    });
});

async function loadIndustriesDict() {
    try {
        const resp = await fetch('industries.json');
        if (!resp.ok) throw new Error("Industries failed");
        allIndustries = await resp.json();
    } catch (e) {
        console.error(e);
        document.getElementById("loadingIndustries").innerText = "Ошибка загрузки справочника индустрий.";
    }
}

async function loadSettings(userId, sign) {
    const response = await fetch(`${API_BASE_URL}/api/settings/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: parseInt(userId), sign: sign })
    });

    const data = await response.json();
    if (data.status !== "ok") {
        throw new Error(data.error || "Неизвестная ошибка");
    }

    const settings = data.settings;

    // --- Зарплата ---
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

    // --- Опыт ---
    if (settings.experience) document.getElementById("experienceSelect").value = settings.experience;

    // --- Регион ---
    if (settings.search_area) {
        document.getElementById("cityStatus").innerText = `Текущий регион ID: ${settings.search_area}`;
    }

    // --- Индустрии ---
    currentSelectedIds = new Set(settings.industry || []);
    // Рендерим один раз полное дерево
    initIndustryTree();

    // Сохраняем начальное состояние
    initialSettings = {
        salary: settings.salary || null,
        experience: settings.experience || "noExperience",
        industry: settings.industry || []
    };
    if (initialSettings.salary === 0) initialSettings.salary = null;
}

// Инициализация дерева (один раз)
function initIndustryTree() {
    const container = document.getElementById("industryTree");
    container.innerHTML = ""; // Очищаем

    if (!allIndustries || allIndustries.length === 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">Нет данных</div>';
        return;
    }

    const chevronSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

    allIndustries.forEach(category => {
        // --- Создание DOM ---
        const catDiv = document.createElement("div");
        catDiv.className = "ind-category";
        catDiv.dataset.name = category.name.toLowerCase(); // Для поиска

        const headerDiv = document.createElement("div");
        headerDiv.className = "ind-header";

        // 1. Иконка
        const toggleIcon = document.createElement("div");
        toggleIcon.className = "toggle-icon";
        toggleIcon.innerHTML = chevronSvg;

        // 2. Чекбокс родителя
        const catCheckbox = document.createElement("input");
        catCheckbox.type = "checkbox";
        catCheckbox.className = "custom-checkbox";
        catCheckbox.value = category.id;
        catCheckbox.dataset.type = "parent";

        // 3. Текст родителя
        const catLabel = document.createElement("span");
        catLabel.className = "ind-label";
        catLabel.innerText = category.name;

        headerDiv.appendChild(toggleIcon);
        headerDiv.appendChild(catCheckbox);
        headerDiv.appendChild(catLabel);
        catDiv.appendChild(headerDiv);

        // --- Контейнер детей ---
        const childrenContainer = document.createElement("div");
        childrenContainer.className = "ind-children";

        // Рендерим детей
        const children = category.industries || [];
        children.forEach(sub => {
            const subDiv = document.createElement("div");
            subDiv.className = "ind-sub";
            subDiv.dataset.name = sub.name.toLowerCase(); // Для поиска

            const subCheckbox = document.createElement("input");
            subCheckbox.type = "checkbox";
            subCheckbox.className = "custom-checkbox";
            subCheckbox.value = sub.id;
            subCheckbox.dataset.type = "child";
            subCheckbox.dataset.parentId = category.id;

            // Восстанавливаем состояние selection
            if (currentSelectedIds.has(sub.id) || currentSelectedIds.has(category.id)) {
                subCheckbox.checked = true;
            }

            const subLabel = document.createElement("span");
            subLabel.className = "ind-sub-label";
            subLabel.innerText = sub.name;

            subLabel.onclick = () => { subCheckbox.checked = !subCheckbox.checked; updateState(); };

            subDiv.appendChild(subCheckbox);
            subDiv.appendChild(subLabel);
            childrenContainer.appendChild(subDiv);

            subCheckbox.addEventListener("change", updateState);
        });

        catDiv.appendChild(childrenContainer);
        container.appendChild(catDiv);

        // --- ЛОГИКА ---
        updateParentCheckboxState(catCheckbox, childrenContainer);

        const toggle = () => {
            childrenContainer.classList.toggle("open");
            toggleIcon.classList.toggle("expanded");
        };

        toggleIcon.onclick = (e) => { e.stopPropagation(); toggle(); };
        catLabel.onclick = toggle;

        catCheckbox.addEventListener("change", () => {
            const childrenInputs = childrenContainer.querySelectorAll("input[data-type='child']");
            // Если родитель чекнут - чекаем видимых детей (или всех? Логичнее всех)
            childrenInputs.forEach(ch => ch.checked = catCheckbox.checked);
            updateState();
        });

        function updateState() {
            updateParentCheckboxState(catCheckbox, childrenContainer);

            // Обновляем глобальный сет
            // (Немного неоптимально бегать по всем, но надежно)
            const childrenInputs = childrenContainer.querySelectorAll("input[data-type='child']");
            childrenInputs.forEach(ch => {
                if (ch.checked) currentSelectedIds.add(ch.value);
                else currentSelectedIds.delete(ch.value);
            });

            if (catCheckbox.checked && !catCheckbox.indeterminate) {
                currentSelectedIds.add(category.id);
            } else {
                currentSelectedIds.delete(category.id);
            }
        }
    });
}

// Фильтрация (скрытие/показ) без перерисовки
function filterIndustryTree(text) {
    const container = document.getElementById("industryTree");
    const categories = container.querySelectorAll(".ind-category");

    categories.forEach(catDiv => {
        const catName = catDiv.dataset.name;
        const childrenContainer = catDiv.querySelector(".ind-children");
        const childrenDivs = childrenContainer.querySelectorAll(".ind-sub");
        const toggleIcon = catDiv.querySelector(".toggle-icon");

        // Используем 'includes', но можно усложнить
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
            // Если есть поиск, раскрываем
            if (text.length > 0) {
                childrenContainer.classList.add("open");
                toggleIcon.classList.add("expanded");
            } else {
                // Если поиск сброшен, можно не сворачивать (или сворачивать).
                // Оставим открытым, если было открыто.
            }
        } else {
            catDiv.style.display = "none";
        }
    });
}

function updateParentCheckboxState(parentCheckbox, childrenContainer) {
    const children = Array.from(childrenContainer.querySelectorAll("input"));
    if (children.length === 0) return; // Нет детей

    const checkedCount = children.filter(c => c.checked).length;

    if (checkedCount === 0) {
        parentCheckbox.checked = false;
        parentCheckbox.indeterminate = false;
    } else if (checkedCount === children.length) {
        // Все выбраны - значит родитель выбран полностью
        parentCheckbox.checked = true;
        parentCheckbox.indeterminate = false;
    } else {
        // Частично
        parentCheckbox.checked = false;
        parentCheckbox.indeterminate = true;
    }
}

// Сбор финальный (перед отправкой)
function finalizeIdsFromSet() {
    // Превращаем Set в "умный список" (Родитель заменяет Детей)
    const result = [];
    const set = currentSelectedIds;

    allIndustries.forEach(cat => {
        const children = cat.industries || [];
        if (children.length === 0) return;

        const allChildrenIds = children.map(c => c.id);
        const selectedChildrenIds = allChildrenIds.filter(id => set.has(id));

        if (selectedChildrenIds.length === allChildrenIds.length) {
            result.push(cat.id);
        } else {
            // Если родитель в сете?
            if (set.has(cat.id)) {
                result.push(cat.id);
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

    // ПРОВЕРКА НА ИЗМЕНЕНИЯ
    let initialSal = initialSettings.salary;
    if (initialSal === 0) initialSal = null;
    const initInd = initialSettings.industry || [];
    const isIndChanged = JSON.stringify(selectedIndustries.sort()) !== JSON.stringify(initInd.sort());

    if (salary === initialSal && experience === initialSettings.experience && !isIndChanged) {
        alert("Данные не изменились 🤷‍♂️");
        return;
    }

    const payload = {
        user_id: parseInt(userId),
        sign: sign,
        salary: salary,
        experience: experience,
        industry: selectedIndustries
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

    // Показываем уведомление
    const saveBtn = document.getElementById("saveBtn");
    const originalText = saveBtn.innerText;
    saveBtn.innerText = "Сохранено! ✅";
    saveBtn.style.background = "#4caf50";
    setTimeout(() => {
        saveBtn.innerText = originalText;
        saveBtn.style.background = "linear-gradient(45deg, #a962ff, #6247aa)";
    }, 2000);

    // Обновляем "начальное" состояние
    initialSettings = {
        salary: salary,
        experience: experience,
        industry: selectedIndustries
    };

    document.getElementById("errorMsg").style.display = "none";
}


function showError(msg) {
    const errDiv = document.getElementById("errorMsg");
    errDiv.innerText = msg;
    errDiv.style.display = "block";
}
