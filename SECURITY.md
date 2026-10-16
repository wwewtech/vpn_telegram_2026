# Security Policy / Политика безопасности

## Supported Versions / Поддерживаемые версии

| Version | Supported |
| ------- | --------- |
| main    | ✅        |

## Reporting a Vulnerability / Как сообщить об уязвимости

- **На русском:** если вы нашли уязвимость (в скриптах, CI-конфигурации или данных),
  напишите об этом через [GitHub Security Advisories](https://github.com/wwewtech/vpn_telegram_2026/security/advisories/new)
  — приватно, не создавая публичный Issue.
- **English:** please report vulnerabilities privately via
  [GitHub Security Advisories](https://github.com/wwewtech/vpn_telegram_2026/security/advisories/new)
  instead of opening a public issue.

Ожидайте ответ в течение 7 дней. Мы не наказываем за добросовестные отчёты.
Expect a reply within 7 days. Good-faith reports will not be penalized.

## Scope / Что в рамках политики

- Скрипты `scripts/*.mjs` и CI-конфигурация `.github/workflows/*`.
- Валидация данных `data/bots.json` (обходы проверок, инъекции в README).

## Out of scope / Что вне рамок

- Самостоятельные Telegram-боты из каталога: репозиторий носит информационный
  характер и не контролирует перечисленные сервисы. Проблемы конкретных ботов
  (доступность, качество услуг) — не темы безопасности этого репозитория.
