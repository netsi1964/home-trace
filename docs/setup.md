# Running and hosting HomeTrace

## Local development

```sh
nvm use          # Node 24
npm install
npm run dev      # http://localhost:5173
```

Without any environment variables the app works fully in **Demo** and manual mode.

For live AI locally, put these in `.env` (git-ignored; see `.env.example`):

| Variable | Required | Meaning |
| --- | --- | --- |
| `OPEN_ROUTER_API_KEY` | yes | OpenRouter key for JEV and the vision model |
| `HOMETRACE_ACCESS_CODE` | yes | Invite code, at least 8 characters, typed once in **Data & settings** |
| `HOMETRACE_SESSION_SECRET` | yes | At least 32 random characters for signing the access cookie: `openssl rand -hex 32` |
| `HOMETRACE_PROVIDER` | no | `jev`, `vision` or `vision-jev` (default) |
| `HOMETRACE_DAILY_REQUEST_LIMIT` | no | Provider requests per UTC day across everyone (default 200) |
| `VISION_MODEL` | no | `qwen/qwen3-vl-*` (default `qwen/qwen3-vl-235b-a22b-instruct`) or `google/gemini-*` |

Live AI stays off (the API answers 503) until all three required values are set.

The camera needs HTTPS on phones. To test on a phone, use the Netlify deploy, or an HTTPS tunnel to your dev server.

## Netlify (production)

The site is the Netlify project `home-trace` at https://home-trace.netlify.app. To set it up:

1. In Netlify, open **Project configuration → Environment variables** and add the three required variables, plus any optional ones. Mark the key and the secret as **secret**.
2. Optional: under **Build & deploy → Link repository**, connect `netsi1964/home-trace` so every push to `main` deploys. Until then, deploys are made by hand from a clean clone of `main`, never from a folder that contains `.env` or `private-fixtures/`.
3. Redeploy, open the site, go to **Data & settings**, enter the access code and switch to **Live AI**.

What the server does with photos:
- Analysis images are processed in memory and sent to OpenRouter, which routes them to TypeSafe (JEV) and the vision model's provider.
- Nothing is stored on the server. Logs contain status, duration and usage only.
- The daily budget is an append-only request log in Netlify Blobs (`hometrace-request-log`). Under heavy concurrency it can be exceeded by a few requests.

## Tested devices

To be filled in after real-device testing (PRD-SEC-004 Mobile constraints):

| Device | OS | Browser | Camera | Overlay | Export/import | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| iPhone | | Safari | | | | |
| Android phone | | Chrome | | | | |
