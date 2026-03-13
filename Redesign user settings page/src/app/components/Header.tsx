import { Menu, Moon, Sun } from "lucide-react";
import { useState, useEffect } from "react";

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    // Проверяем сохраненную тему или используем темную по умолчанию
    const savedTheme = localStorage.getItem("theme");
    const prefersDark = savedTheme === "dark" || (!savedTheme && true);
    setIsDark(prefersDark);
    
    if (prefersDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = !isDark;
    setIsDark(newTheme);
    
    if (newTheme) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Левая часть - лого и навигация */}
          <div className="flex items-center gap-8">
            {/* Бургер меню только на мобилке */}
            <button
              onClick={onMenuClick}
              className="lg:hidden p-2 rounded-lg hover:bg-accent transition-colors"
              aria-label="Открыть меню"
            >
              <Menu className="w-6 h-6" />
            </button>

            {/* Логотип */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
                <span className="text-white font-bold text-lg">А</span>
              </div>
              <span className="text-xl font-semibold bg-gradient-to-r from-purple-600 to-purple-400 bg-clip-text text-transparent">
                Аврора
              </span>
            </div>

            {/* Навигация - скрыта на мобилке */}
            <nav className="hidden lg:flex items-center gap-6">
              <a
                href="/settings"
                className="text-foreground hover:text-purple-500 transition-colors font-medium px-3 py-2 rounded-lg hover:bg-accent"
              >
                Настройки
              </a>
              <a
                href="/search"
                className="text-muted-foreground hover:text-purple-500 transition-colors font-medium px-3 py-2 rounded-lg hover:bg-accent"
              >
                Ручной поиск
              </a>
            </nav>
          </div>

          {/* Правая часть - переключатель темы */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            aria-label={isDark ? "Переключить на светлую тему" : "Переключить на тёмную тему"}
          >
            {isDark ? (
              <Sun className="w-5 h-5 text-yellow-500" />
            ) : (
              <Moon className="w-5 h-5 text-purple-600" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
