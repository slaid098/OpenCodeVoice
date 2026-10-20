---
module: assets
purpose: Статичные ассеты userscript (иконка @icon и обложка README)
key_files:
  - assets/icon.png — иконка скрипта 128×128 PNG RGBA, ссылается из vite.config.ts @icon
  - assets/cover.svg — исходник обложки 1024×1024 (чёрный фон, неоново-зелёный микрофон)
  - assets/cover.png — отрендеренная обложка 1024×1024 PNG для README
dependencies: []
last_updated: 2026-10-20
---

# assets/

## Structure
- `icon.png` — иконка userscript 128×128 PNG RGBA (~1.4 КБ). Подхватывается `@icon` в `vite.config.ts` (GitHub raw `main/assets/icon.png`), отображается в userscript-менеджерах (Tampermonkey/Violentmonkey). Даунскейл из обложки витрины slaid098.dev. **Не изменять вместе с обложкой 0.9.0.**
- `cover.svg` — векторная обложка 1024×1024: фон `#050607`, неоново-зелёный `#B6FF3C`, белый текст, микрофон в скобках, подписи «OpenCode» / «Voice» / «DICTATION FOR THE WEB».
- `cover.png` — растровая версия обложки 1024×1024 (рендер headless Chrome с `--force-device-scale-factor=2` и даунскейлом ffmpeg). Используется в `README.md`.

## Patterns
- Иконка 128×128 — ретина-запас для рендера 16×16/32×32 в менеджерах без оверсамплинга 1024×1024.
- Путь в `@icon` указывает на ветку `main` (GitHub raw-URL), файл должен существовать в `main` — не удалять без синхронной правки `vite.config.ts`.
- Обложку 0.9.0 можно перерендерить из `cover.svg` без внешних сервисов: headless Chrome/Edge + ffmpeg. Квадрат 1:1 обязателен; `icon.png` при этом не трогать.
