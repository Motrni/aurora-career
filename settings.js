
// settings.js

// КОНФИГУРАЦИЯ
// Замените на реальный адрес вашего бота (API)
const API_BASE_URL = "https://hh-bot-api.aurora-career.ru"; // ВАЖНО: Это должен быть HTTPS адрес вашего бота (или ngrok для тестов)
// Для локальной разработки можно использовать: "http://localhost:5000"

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Получаем параметры из URL
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('user_id');
    const sign = urlParams.get('sign');

    if (!userId || !sign) {
        showError("Ошибка доступа. Ссылка не содержит необходимых параметров.");
        return;
    }

    // 2. Загружаем текущие настройки
    try {
        await loadSettings(userId, sign);
    } catch (e) {
        showError("Не удалось загрузить настройки. " + e.message);
    }

    // 3. Вешаем обработчик сохранения
    document.getElementById("saveBtn").addEventListener("click", async () => {
        try {
            await saveSettings(userId, sign);
        } catch (e) {
            showError("Ошибка при сохранении. " + e.message);
        }
    });
});

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
    
    // Заполняем форму
    if (settings.salary) document.getElementById("salaryInput").value = settings.salary;
    if (settings.experience) document.getElementById("experienceSelect").value = settings.experience;
    
    // Город пока показываем как ID или текст (если это ID, можно маппить на клиенте или сервере)
    if (settings.search_area) {
        document.getElementById("cityStatus").innerText = `Текущий регион ID: ${settings.search_area}`;
    }
}

async function saveSettings(userId, sign) {
    const salary = parseInt(document.getElementById("salaryInput").value);
    const experience = document.getElementById("experienceSelect").value;

    const payload = {
        user_id: parseInt(userId),
        sign: sign,
        salary: salary,
        experience: experience
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

    alert("Настройки успешно сохранены! ✅");
}

function showError(msg) {
    const errDiv = document.getElementById("errorMsg");
    errDiv.innerText = msg;
    errDiv.style.display = "block";
}
