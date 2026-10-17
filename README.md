# Training HQ

A personal training tracker and coach for one person. Two parts:

- `app/`: the phone and browser app (plain HTML, CSS and JavaScript, no build step). Installs to the iPhone Home Screen, works offline, and is served by GitHub Pages.
- `server/`: a small Node server that runs on the owner's Mac. It holds the data, syncs with the phone over Tailscale, and later runs the coach.

This repository holds code only. No personal data, no keys.

## Run locally

Requires Node 24.14 or later (26 recommended).

```bash
npm test
npm start
```

## Licences

Fonts in `app/fonts/` are Inter and JetBrains Mono, both under the SIL Open Font License 1.1 (licence files alongside).
