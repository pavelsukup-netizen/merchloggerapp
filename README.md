# Merch Visits – Mobile Logger (PWA)

Portable PWA logger pro merch návštěvy:
- Offline ukládání (IndexedDB)
- Import Mobile Pack (JSON)
- Drafty návštěv + checklist + fotky
- Export ZIP: visit.json + photos/

## Lokální běh (doporučeno)
Použij libovolný statický server:
- VS Code Live Server
- nebo `python -m http.server`

## GitHub Pages deploy
1) Pushni repo na GitHub
2) Settings → Pages
3) Source: Deploy from a branch
4) Branch: main / root
5) Otevři URL, nainstaluj jako appku (Chrome: Install, iOS: Add to Home Screen)

## Poznámka
Soubor `vendor/jszip.min.js` musí být lokálně v repu.
