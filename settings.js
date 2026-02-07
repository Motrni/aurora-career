
// settings.js

// КОНФИГУРАЦИЯ
const API_BASE_URL = "https://api.aurora-career.ru";

// Храним начальное состояние
let initialSettings = {};
let allIndustries = []; // Кэш индустрий

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

    // 3. Загрузка данных
    try {
        // Сначала грузим справочник индустрий
        await loadIndustriesDict();
        // Потом настройки юзера
        await loadSettings(userId, sign);
    } catch (e) {
        showError("Не удалось загрузить настройки. " + e.message);
    }

    // 4. Сохранение
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
    // settings.industry это массив строк ["7", "7.540"] или null
    renderIndustryTree(settings.industry || []);

    // Сохраняем начальное состояние
    initialSettings = {
        salary: settings.salary || null,
        experience: settings.experience || "noExperience",
        industry: settings.industry || [] // Для сравнения массивов придется заморочиться, но пока так
    };
    if (initialSettings.salary === 0) initialSettings.salary = null;
}

// Рендер дерева с чекбоксами
function renderIndustryTree(selectedIds) {
    const container = document.getElementById("industryTree");
    container.innerHTML = ""; // Очищаем

    // selectedIds - это Set для быстрого поиска
    const selectedSet = new Set(selectedIds);

    allIndustries.forEach(category => {
        // Контейнер категории
        const catDiv = document.createElement("div");
        catDiv.style.marginBottom = "8px";

        // --- Заголовок Категории (Чекбокс + Имя) ---
        const catHeader = document.createElement("div");
        catHeader.style.display = "flex";
        catHeader.style.alignItems = "center";

        const catCheckbox = document.createElement("input");
        catCheckbox.type = "checkbox";
        catCheckbox.value = category.id;
        catCheckbox.dataset.type = "parent";
        catCheckbox.style.marginRight = "8px";
        catCheckbox.style.width = "16px";
        catCheckbox.style.height = "16px";
        catCheckbox.style.accentColor = "#a962ff";
        catCheckbox.style.cursor = "pointer";

        const catLabel = document.createElement("label");
        catLabel.innerText = category.name;
        catLabel.style.cursor = "pointer";
        catLabel.style.fontSize = "0.95rem";
        catLabel.style.fontWeight = "600";
        catLabel.style.color = "#eee";
        catLabel.onclick = () => catCheckbox.click(); // Клик по тексту -> чек

        catHeader.appendChild(catCheckbox);
        catHeader.appendChild(catLabel);
        catDiv.appendChild(catHeader);

        // --- Подкатегории (Скрытый/Открытый список) ---
        const childrenDiv = document.createElement("div");
        childrenDiv.style.marginLeft = "24px";
        childrenDiv.style.marginTop = "4px";
        // По умолчанию можно показать, если что-то выбрано, или свернуть.
        // Для простоты покажем всё. Если слишком длинно - можно свернуть.
        // Давайте сделаем аккордеон.
        const children = category.industries || [];

        // Переменные состояния
        let checkedChildrenCount = 0;

        children.forEach(sub => {
            const subDiv = document.createElement("div");
            subDiv.style.marginBottom = "4px";
            subDiv.style.display = "flex";
            subDiv.style.alignItems = "center";

            const subCheckbox = document.createElement("input");
            subCheckbox.type = "checkbox";
            subCheckbox.value = sub.id;
            subCheckbox.dataset.parentId = category.id;
            subCheckbox.dataset.type = "child";
            subCheckbox.style.marginRight = "8px";
            subCheckbox.style.width = "14px";
            subCheckbox.style.height = "14px";
            subCheckbox.style.accentColor = "#a962ff";
            subCheckbox.style.cursor = "pointer";

            // Проверяем, выбран ли ребенок ИЛИ выбран ли родитель (если родитель выбран, то и дети визуально выбраны)
            if (selectedSet.has(sub.id) || selectedSet.has(category.id)) {
                subCheckbox.checked = true;
                checkedChildrenCount++;
            }

            const subLabel = document.createElement("span");
            subLabel.innerText = sub.name;
            subLabel.style.color = "#ccc";
            subLabel.style.fontSize = "0.85rem";
            subLabel.style.cursor = "pointer";
            subLabel.onclick = () => subCheckbox.click();

            subDiv.appendChild(subCheckbox);
            subDiv.appendChild(subLabel);
            childrenDiv.appendChild(subDiv);

            // --- Логика клика по ребенку ---
            subCheckbox.addEventListener("change", () => {
                updateParentState(catCheckbox, childrenDiv);
            });
        });

        catDiv.appendChild(childrenDiv);
        container.appendChild(catDiv);

        // --- Состояние Родителя при загрузке ---
        // Если выбран ID родителя -> он checked
        if (selectedSet.has(category.id)) {
            catCheckbox.checked = true;
            // И все дети должны быть checked (мы это уже сделали в цикле выше, но на всякий случай)
            Array.from(childrenDiv.querySelectorAll("input")).forEach(ch => ch.checked = true);
        } else {
            // Если родитель не выбран явно, но выбраны ВСЕ дети -> ставим галочку родителю?
            // Или если выбраны ЧАСТЬ детей -> indeterminate
            if (checkedChildrenCount > 0 && checkedChildrenCount === children.length) {
                catCheckbox.checked = true;
            } else if (checkedChildrenCount > 0) {
                catCheckbox.indeterminate = true;
            }
        }

        // --- Логика клика по Родителю ---
        catCheckbox.addEventListener("change", () => {
            const childrenInputs = childrenDiv.querySelectorAll("input");
            childrenInputs.forEach(ch => {
                ch.checked = catCheckbox.checked;
            });
        });
    });
}

function updateParentState(parentCheckbox, childrenContainer) {
    const children = Array.from(childrenContainer.querySelectorAll("input"));
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

// Сбор выбранных ID
function getSelectedIndustryIds() {
    const container = document.getElementById("industryTree");
    const allCheckboxes = container.querySelectorAll("input[type='checkbox']");
    const ids = [];

    // Стратегия:
    // 1. Если Parent Checked -> Берем Parent ID (игнорируем детей, т.к. API HH понимает ParentID = All subindustries).
    // 2. Если Parent Indeterminate -> Берем только Checked Children.
    // 3. Если Parent Unchecked -> Ничего (дети тоже unchecked).

    // Но мы должны быть аккуратны. Если Parent ID = "7", а дети "7.540".

    // Проходим по родителям
    const parents = container.querySelectorAll("input[data-type='parent']");
    parents.forEach(p => {
        if (p.checked && !p.indeterminate) {
            ids.push(p.value); // Добавляем категорию целиком
        } else if (p.indeterminate || (!p.checked && !p.indeterminate)) {
            // Если частично выбрано или вообще не выбрано (но вдруг дети выбраны багом?), проверяем детей
            // Находим контейнер детей (он следующий сосед)
            const childrenDiv = p.parentElement.nextElementSibling;
            const children = childrenDiv.querySelectorAll("input[data-type='child']:checked");
            children.forEach(c => ids.push(c.value));
        }
    });

    return ids;
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
    const selectedIndustries = getSelectedIndustryIds();

    // ПРОВЕРКА НА ИЗМЕНЕНИЯ
    let initialSal = initialSettings.salary;
    if (initialSal === 0) initialSal = null;

    // Сравнение массивов индустрий
    const initInd = initialSettings.industry || [];
    // Простая проверка (сортировка + stringify) - для UI пойдет
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
