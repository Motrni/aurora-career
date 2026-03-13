import { useState } from "react";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Separator } from "./ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Search, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export function SettingsPageNew() {
  const [salary, setSalary] = useState("");
  const [noSalary, setNoSalary] = useState(false);
  const [experience, setExperience] = useState("doesNotMatter");
  const [keywordsInclude, setKeywordsInclude] = useState<string[]>([]);
  const [keywordsExclude, setKeywordsExclude] = useState<string[]>([]);
  const [includeInput, setIncludeInput] = useState("");
  const [excludeInput, setExcludeInput] = useState("");
  const [queryMode, setQueryMode] = useState<"simple" | "advanced">("simple");
  const [booleanQuery, setBooleanQuery] = useState("");
  const [schedule, setSchedule] = useState({
    remote: false,
    office: false,
    hybrid: false,
    field: false,
  });
  const [regionSearch, setRegionSearch] = useState("");
  const [industrySearch, setIndustrySearch] = useState("");
  
  // Cover Letter Settings
  const [clUseDefault, setClUseDefault] = useState(true);
  const [clStyle, setClStyle] = useState("classic");
  const [clHeader, setClHeader] = useState("");
  const [clFooter, setClFooter] = useState("");

  const addKeyword = (type: "include" | "exclude") => {
    const input = type === "include" ? includeInput : excludeInput;
    const setter = type === "include" ? setKeywordsInclude : setKeywordsExclude;
    const current = type === "include" ? keywordsInclude : keywordsExclude;
    
    if (input.trim() && !current.includes(input.trim())) {
      setter([...current, input.trim()]);
      type === "include" ? setIncludeInput("") : setExcludeInput("");
    }
  };

  const removeKeyword = (type: "include" | "exclude", index: number) => {
    const setter = type === "include" ? setKeywordsInclude : setKeywordsExclude;
    const current = type === "include" ? keywordsInclude : keywordsExclude;
    setter(current.filter((_, i) => i !== index));
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pt-24 pb-16">
      <Tabs defaultValue="search" className="w-full">
        {/* Вкладки */}
        <TabsList className="grid w-full grid-cols-2 mb-8 bg-muted/30 backdrop-blur">
          <TabsTrigger value="search" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-500">
            Настройки поиска
          </TabsTrigger>
          <TabsTrigger value="response" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-500">
            Настройки откликов
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: НАСТРОЙКИ ПОИСКА */}
        <TabsContent value="search" className="space-y-6">
          <div className="text-center mb-6">
            <h1 className="mb-2 bg-gradient-to-r from-purple-600 to-purple-400 bg-clip-text text-transparent">
              Настройки поиска
            </h1>
          </div>

          {/* Счетчик вакансий */}
          <Card className="p-4 border-purple-500/30 bg-purple-500/10 backdrop-blur">
            <div className="text-center">
              <div className="text-sm text-muted-foreground mb-2">
                Найдено вакансий: <span className="text-foreground font-bold">...</span>
              </div>
              <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white">
                Посмотреть на hh.ru
              </Button>
            </div>
          </Card>

          {/* Зарплата */}
          <Card className="p-6 border-border/50 backdrop-blur bg-card/50">
            <h3 className="mb-4">Желаемая зарплата (₽)</h3>
            <div className="flex gap-4 items-center">
              <Input
                type="number"
                placeholder="Например: 100000"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                disabled={noSalary}
                className="flex-1 bg-input-background dark:bg-input"
              />
              <div className="flex items-center gap-2">
                <Switch
                  id="no-salary"
                  checked={noSalary}
                  onCheckedChange={(checked) => {
                    setNoSalary(checked);
                    if (checked) setSalary("");
                  }}
                />
                <Label htmlFor="no-salary" className="cursor-pointer">Не указана</Label>
              </div>
            </div>
          </Card>

          {/* Опыт работы */}
          <Card className="p-6 border-border/50 backdrop-blur bg-card/50">
            <h3 className="mb-4">Опыт работы</h3>
            <Select value={experience} onValueChange={setExperience}>
              <SelectTrigger className="bg-input-background dark:bg-input">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="noExperience">Нет опыта</SelectItem>
                <SelectItem value="between1And3">От 1 года до 3 лет</SelectItem>
                <SelectItem value="between3And6">От 3 до 6 лет</SelectItem>
                <SelectItem value="moreThan6">Более 6 лет</SelectItem>
                <SelectItem value="doesNotMatter">Не важно</SelectItem>
              </SelectContent>
            </Select>
          </Card>

          {/* График работы */}
          <Card className="p-6 border-border/50 backdrop-blur bg-card/50">
            <h3 className="mb-4">График работы</h3>
            <div className="space-y-3">
              {[
                { id: "remote", label: "Удаленная работа", value: "REMOTE" },
                { id: "office", label: "В офисе/На территории", value: "ON_SITE" },
                { id: "hybrid", label: "Гибридный график", value: "HYBRID" },
                { id: "field", label: "Разъездная работа", value: "FIELD_WORK" },
              ].map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <Switch
                    id={item.id}
                    checked={schedule[item.id as keyof typeof schedule]}
                    onCheckedChange={(checked) =>
                      setSchedule({ ...schedule, [item.id]: checked })
                    }
                  />
                  <Label htmlFor={item.id} className="cursor-pointer">{item.label}</Label>
                </div>
              ))}
            </div>
          </Card>

          {/* Регион поиска */}
          <Card className="p-6 border-border/50 backdrop-blur bg-card/50">
            <h3 className="mb-4">Регион поиска</h3>
            <div className="border border-border rounded-lg overflow-hidden bg-muted/30" style={{ height: "420px" }}>
              {/* Selected Regions Header */}
              <div className="bg-muted/50 p-3 border-b border-border">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">Выбрано: 0</span>
                  <button className="text-xs text-muted-foreground hover:text-foreground">
                    Очистить
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 max-h-20 overflow-y-auto">
                  {/* Selected region chips will go here */}
                </div>
              </div>

              {/* Search */}
              <div className="p-3 border-b border-border bg-muted/30">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Поиск региона..."
                    value={regionSearch}
                    onChange={(e) => setRegionSearch(e.target.value)}
                    className="pl-9 bg-input-background dark:bg-input"
                  />
                </div>
              </div>

              {/* Region Tree */}
              <div className="p-3 overflow-y-auto" style={{ height: "calc(420px - 140px)" }}>
                <div className="text-center text-muted-foreground py-8">
                  Загрузка регионов...
                </div>
              </div>
            </div>
          </Card>

          {/* Отрасли компаний */}
          <Card className="p-6 border-border/50 backdrop-blur bg-card/50">
            <h3 className="mb-4">Отрасли компаний</h3>
            <div className="border border-border rounded-lg overflow-hidden bg-muted/30" style={{ height: "400px" }}>
              {/* Search */}
              <div className="p-3 border-b border-border bg-muted/30">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Поиск отрасли..."
                    value={industrySearch}
                    onChange={(e) => setIndustrySearch(e.target.value)}
                    className="pl-9 bg-input-background dark:bg-input"
                  />
                </div>
              </div>

              {/* Industry Tree */}
              <div className="p-3 overflow-y-auto" style={{ height: "calc(400px - 60px)" }}>
                <div className="text-center text-muted-foreground py-8">
                  Загрузка отраслей...
                </div>
              </div>
            </div>
          </Card>

          {/* Настройка Поиска */}
          <Card className="p-6 border-border/50 backdrop-blur bg-card/50">
            <h3 className="mb-4">Настройка Поиска</h3>
            
            {/* Mode Switcher */}
            <div className="flex bg-muted/30 rounded-lg p-1 mb-6">
              <button
                onClick={() => setQueryMode("simple")}
                className={`flex-1 py-2 px-4 rounded-md transition-all ${
                  queryMode === "simple"
                    ? "bg-purple-500/20 text-purple-500 font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Простой (Keywords)
              </button>
              <button
                onClick={() => setQueryMode("advanced")}
                className={`flex-1 py-2 px-4 rounded-md transition-all ${
                  queryMode === "advanced"
                    ? "bg-purple-500/20 text-purple-500 font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Advanced (AI/Boolean)
              </button>
            </div>

            {/* Simple Mode */}
            {queryMode === "simple" && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-muted/30 border border-border/50 text-sm">
                  Введите ключевое слово и нажмите <strong>Enter</strong> или кнопку <strong>✓</strong>, чтобы добавить его в список.
                  <br />
                  Бот будет искать вакансии, содержащие <strong>ВСЕ</strong> слова из "Включить" и <strong>НИ ОДНОГО</strong> из "Исключить".
                </div>

                {/* Include */}
                <div>
                  <Label className="mb-2 block text-muted-foreground">Искать (Include)</Label>
                  <div className="flex flex-wrap gap-2 p-3 border border-border rounded-lg bg-input-background dark:bg-input min-h-[50px]">
                    {keywordsInclude.map((keyword, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center gap-1 bg-purple-500/20 text-purple-500 border border-purple-500/40 px-3 py-1 rounded-md text-sm"
                      >
                        {keyword}
                        <button
                          onClick={() => removeKeyword("include", index)}
                          className="hover:text-purple-300"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      placeholder="Введите слово и Enter..."
                      value={includeInput}
                      onChange={(e) => setIncludeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addKeyword("include");
                        }
                      }}
                      className="flex-1 min-w-[200px] bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
                    />
                    {includeInput && (
                      <button
                        onClick={() => addKeyword("include")}
                        className="text-purple-500 hover:text-purple-400 font-bold"
                      >
                        ✓
                      </button>
                    )}
                  </div>
                </div>

                {/* Exclude */}
                <div>
                  <Label className="mb-2 block text-muted-foreground">Исключить (Exclude)</Label>
                  <div className="flex flex-wrap gap-2 p-3 border border-border rounded-lg bg-input-background dark:bg-input min-h-[50px]">
                    {keywordsExclude.map((keyword, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center gap-1 bg-purple-500/20 text-purple-500 border border-purple-500/40 px-3 py-1 rounded-md text-sm"
                      >
                        {keyword}
                        <button
                          onClick={() => removeKeyword("exclude", index)}
                          className="hover:text-purple-300"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      placeholder="Введите слово и Enter..."
                      value={excludeInput}
                      onChange={(e) => setExcludeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addKeyword("exclude");
                        }
                      }}
                      className="flex-1 min-w-[200px] bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
                    />
                    {excludeInput && (
                      <button
                        onClick={() => addKeyword("exclude")}
                        className="text-purple-500 hover:text-purple-400 font-bold"
                      >
                        ✓
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Advanced Mode */}
            {queryMode === "advanced" && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-muted/30 border border-border/50 text-sm">
                  Полный контроль над запросом используя язык запросов hh.ru (Boolean Search).
                  Рекомендуется для сложных выборок.
                </div>
                <textarea
                  placeholder="NAME:(Python OR Django) AND NOT NAME:(Senior)"
                  value={booleanQuery}
                  onChange={(e) => setBooleanQuery(e.target.value)}
                  className="w-full min-h-[120px] p-3 rounded-lg border border-border bg-input-background dark:bg-input text-foreground font-mono text-sm resize-y"
                />
                <div className="text-xs text-muted-foreground">
                  Доступные операторы: <code className="bg-muted px-1 py-0.5 rounded">OR</code>,{" "}
                  <code className="bg-muted px-1 py-0.5 rounded">AND</code>,{" "}
                  <code className="bg-muted px-1 py-0.5 rounded">NOT</code>,{" "}
                  <code className="bg-muted px-1 py-0.5 rounded">()</code>,{" "}
                  <code className="bg-muted px-1 py-0.5 rounded">NAME:()</code>.
                </div>
              </div>
            )}
          </Card>

          {/* Кнопки */}
          <div className="space-y-3">
            <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white" size="lg">
              Сохранить изменения
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Изменения применятся в боте мгновенно
            </p>
          </div>
        </TabsContent>

        {/* TAB 2: НАСТРОЙКИ ОТКЛИКОВ */}
        <TabsContent value="response" className="space-y-6">
          <div className="text-center mb-6">
            <h1 className="mb-2 bg-gradient-to-r from-purple-600 to-purple-400 bg-clip-text text-transparent">
              Настройки откликов
            </h1>
          </div>

          <Card className="p-6 border-border/50 backdrop-blur bg-card/50">
            <h3 className="mb-4">Шаблон Сопроводительного Письма</h3>
            
            <div className="p-4 rounded-lg bg-muted/30 border border-border/50 text-sm text-center mb-4">
              Выберите стиль и настройте фиксированные начало/конец.
            </div>

            <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/30 text-sm text-center mb-6 text-orange-400 font-bold uppercase">
              ⚠️ Стиль и настройки привязаны к текущему выбранному резюме
            </div>

            {/* Стиль письма */}
            <div className="mb-6">
              <Label className="mb-2 block">Стиль письма</Label>
              <Select value={clStyle} onValueChange={setClStyle}>
                <SelectTrigger className="bg-input-background dark:bg-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="classic">Классический (Сдержанный)</SelectItem>
                  <SelectItem value="startup">Стартап (Бодрый / Без официоза)</SelectItem>
                  <SelectItem value="formal">Официально-деловой (На «Вы»)</SelectItem>
                  <SelectItem value="executive">Руководитель / Executive (Управление и цифры)</SelectItem>
                  <SelectItem value="direct">Только факты (Сухо и кратко)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Использовать стандартные */}
            <div className="mb-6">
              <div className="flex items-center gap-3">
                <Switch
                  id="cl-use-default"
                  checked={clUseDefault}
                  onCheckedChange={setClUseDefault}
                />
                <Label htmlFor="cl-use-default" className="cursor-pointer">
                  Использовать стандартные (AI) начало и конец
                </Label>
              </div>
            </div>

            {/* Кастомные поля */}
            {!clUseDefault && (
              <div className="space-y-4">
                <div>
                  <Label className="mb-2 block text-muted-foreground">Приветствие (Header)</Label>
                  <textarea
                    placeholder="Здравствуйте! Меня зовут [Имя], и я..."
                    value={clHeader}
                    onChange={(e) => setClHeader(e.target.value)}
                    rows={3}
                    className="w-full p-3 rounded-lg border border-border bg-input-background dark:bg-input text-foreground resize-y"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Будет вставлено в самом начале письма.
                  </p>
                </div>

                <div>
                  <Label className="mb-2 block text-muted-foreground">Подпись (Footer)</Label>
                  <textarea
                    placeholder="С уважением, [Имя]. Телеграм: @..."
                    value={clFooter}
                    onChange={(e) => setClFooter(e.target.value)}
                    rows={3}
                    className="w-full p-3 rounded-lg border border-border bg-input-background dark:bg-input text-foreground resize-y"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Будет вставлено в самом конце письма.
                  </p>
                </div>
              </div>
            )}

            {/* Предпросмотр */}
            <div className="mt-6">
              <h4 className="mb-3">Предпросмотр (Как это видит HR)</h4>
              <div className="relative p-4 rounded-lg border border-dashed border-border bg-muted/30">
                <div className="absolute top-2 right-2 text-xs text-muted-foreground border border-border px-2 py-0.5 rounded uppercase">
                  Preview
                </div>
                
                {/* Header */}
                <div className="mb-3 italic text-muted-foreground whitespace-pre-wrap">
                  {clUseDefault ? "..." : (clHeader || "...")}
                </div>

                {/* Body (static) */}
                <div className="mb-3 text-muted-foreground opacity-60">
                  Увидел вашу вакансию <strong>Manual QA Engineer</strong>. Мой опыт в финтех-проектах, а также крепкое понимание API-тестирования...
                  <br /><br />
                  (Здесь будет сгенерированный AI текст под вакансию)
                </div>

                {/* Footer */}
                <div className="italic text-muted-foreground whitespace-pre-wrap">
                  {clUseDefault ? "..." : (clFooter || "...")}
                </div>
              </div>
            </div>
          </Card>

          {/* Кнопка сохранения */}
          <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white" size="lg">
            Сохранить настройки откликов
          </Button>
        </TabsContent>
      </Tabs>

      {/* Кнопка возврата */}
      <Button
        variant="outline"
        className="w-full mt-6 border-border/50 hover:bg-accent"
        size="lg"
      >
        Вернуться в Аврору
      </Button>
    </div>
  );
}
