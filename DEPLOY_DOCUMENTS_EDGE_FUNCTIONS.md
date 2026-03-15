# Деплой Edge Functions для модуля Documents

## ⚠️ Требуется ручной деплой через Supabase Dashboard

Supabase Personal Access Token (PAT) не найден в окружении. CLI деплой невозможен.

## Функции для деплоя

### 1. generate-document-number
**Файл:** `supabase/functions/generate-document-number/index.ts`

**Что делает:** Генерирует автоинкрементный номер документа по настройкам компании.

**Параметры:**
- `template_type` (string): тип документа (contract, protocol, annex, other)
- `project_id` (string, optional): ID проекта для включения кода объекта

**Примеры номеров:**
- Базовый: `CON/2026/001`
- + месяц: `CON/2026/03/001`
- + код объекта: `CON/ZD-II/001`
- + оба: `CON/ZD-II/03/001`

---

### 2. generate-document-pdf
**Файл:** `supabase/functions/generate-document-pdf/index.ts`

**Что делает:** Генерирует PDF из документа + шаблона, сохраняет в Storage.

**Параметры:**
- `document_id` (string): ID документа

**Возвращает:**
- `url` (string): signed URL для скачивания PDF (30 мин TTL)
- `pdf_path` (string): путь к файлу в Storage

**Зависимости:** jsPDF (загружается через esm.sh)

---

### 3. log-document-event
**Файл:** `supabase/functions/log-document-event/index.ts`

**Что делает:** Логирует события документа (просмотр, скачивание, подписание и т.д.)

**Параметры:**
- `document_id` (string): ID документа
- `action` (string): тип действия
- `metadata` (object, optional): дополнительные данные

**Требует:** RPC функцию `log_document_event` в БД (SECURITY DEFINER)

---

### 4. analyze-document
**Файл:** `supabase/functions/analyze-document/index.ts`

**Что делает:** AI-анализ документа через Gemini API.

**Параметры:**
- `document_id` (string): ID документа
- `company_id` (string): ID компании
- `analysis_type` (string): тип анализа (review, risk, summary, suggestion, clause_check)
- `document_content` (string): содержимое документа
- `template_name` (string, optional): название шаблона

**Требует:** GEMINI_API_KEY в secrets (уже добавлен)

**Типы анализа:**
- `review` — общий обзор документа
- `risk` — анализ рисков
- `summary` — краткое резюме
- `suggestion` — предложения по улучшению
- `clause_check` — проверка клауз

---

### 5. _shared/cors.ts
**Файл:** `supabase/functions/_shared/cors.ts`

**Что делает:** Shared CORS headers для всех функций.

**Содержимое:**
```typescript
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
```

---

## Инструкция по деплою через Dashboard

### Шаг 1: Открыть Supabase Dashboard
```
https://supabase.com/dashboard/project/diytvuczpciikzdhldny
```

### Шаг 2: Перейти в Edge Functions
- Левое меню → **Edge Functions**

### Шаг 3: Создать/обновить функции

Для каждой функции:

1. Нажать **New Function** (или выбрать существующую)
2. Ввести имя функции (например: `generate-document-number`)
3. Скопировать код из соответствующего файла
4. Нажать **Deploy**

### Шаг 4: Проверить Environment Variables

В Dashboard → Settings → Edge Functions → Environment Variables должны быть:

```
SUPABASE_URL=https://diytvuczpciikzdhldny.supabase.co
SUPABASE_ANON_KEY=sb_publishable_x3wgOI9daLXg2edcIGgCLQ_8mHHLHll
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
GEMINI_API_KEY=AIzaSyAOf39tObnLuG1gkMytaA3X9Kf3BWsubts
```

### Шаг 5: Проверить CORS файл

Файл `_shared/cors.ts` должен быть размещён в структуре функций. Supabase автоматически резолвит импорты вида `../_shared/cors.ts`.

---

## Проверка после деплоя

### Test каждой функции через curl:

```bash
# 1. generate-document-number
curl -X POST \
  https://diytvuczpciikzdhldny.supabase.co/functions/v1/generate-document-number \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"template_type":"contract"}'

# 2. generate-document-pdf
curl -X POST \
  https://diytvuczpciikzdhldny.supabase.co/functions/v1/generate-document-pdf \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"document_id":"test-id"}'

# 3. log-document-event
curl -X POST \
  https://diytvuczpciikzdhldny.supabase.co/functions/v1/log-document-event \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"document_id":"test-id","action":"view"}'

# 4. analyze-document
curl -X POST \
  https://diytvuczpciikzdhldny.supabase.co/functions/v1/analyze-document \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"document_id":"test-id","analysis_type":"summary","document_content":"test"}'
```

---

## Файлы для деплоя

```
supabase/functions/
├── _shared/
│   └── cors.ts
├── generate-document-number/
│   └── index.ts
├── generate-document-pdf/
│   └── index.ts
├── log-document-event/
│   └── index.ts
└── analyze-document/
    └── index.ts
```

---

## ⚠️ Важно

1. **GEMINI_API_KEY** уже добавлен в Supabase secrets
2. Все функции используют CORS из `_shared/cors.ts`
3. Функции требуют авторизации (Authorization header)
4. `generate-document-pdf` использует jsPDF из esm.sh
5. `log-document-event` вызывает RPC `log_document_event` в БД

---

## Альтернатива: Получение PAT для CLI деплоя

Если нужен автоматический деплой через CLI:

1. Зайти в Supabase Dashboard → Account Settings → Access Tokens
2. Создать новый Personal Access Token (начинается с `sbp_`)
3. Добавить в окружение: `export SUPABASE_ACCESS_TOKEN=sbp_xxx`
4. Запустить: `supabase functions deploy <function-name>`
