# Calm like a Potato

Web app for daily mood check-ins for people who live with bipolar disorder (anyone may use it), on a laptop or PC only for now: you talk (voice only) to Claude, which uses CBT and DBT skills and in-browser voice measurements (speed, pauses, pitch range, loudness) compared to your usual. It is not a crisis tool; if risk is detected it shows the 988 Lifeline. The plan and risks are in `PLAN.md`.

## What you need
- An Anthropic API key: https://console.anthropic.com → API Keys. Set a monthly spend limit there (for example $25).
- Node.js 20 or newer.
- A host that gives you an `https://` address (browsers only allow the microphone on https). This repo is set up for Cloudflare Workers; `npm start` also runs it as a plain Node server on any Node host.

## Run it on your computer
```
npm install
ANTHROPIC_API_KEY=sk-ant-... APP_PASSCODE=pick-a-long-passcode npm start
```
Open http://localhost:3000. Voice uses the browser's free speech-to-text: Chrome, Edge, or Safari on a laptop or PC. Phones, Firefox, Brave, and Opera don't work; phones show a "use a computer" note. On a PC, click the mic or press Space to start and send. Run the safety tests with `npm test`.

## Put it online (Cloudflare Workers)
`wrangler.jsonc` holds the setup. Cloudflare serves `public/` as plain files and runs `worker/index.js` only for `/api/*`.
1. Cloudflare dashboard → Workers & Pages → Create → Import a repository → pick this repo (or open the existing `bb-therapist` Worker → Settings → Build and connect it).
2. Build settings: Build command empty, Deploy command `npm run deploy` (the plain `npx wrangler deploy` also works, but Settings then shows a Cloudflare version id instead of the commit).
3. Worker → Settings → Variables and Secrets → add two **Secrets**: `ANTHROPIC_API_KEY` and `APP_PASSCODE`. Then deploy again.
4. Open the `https://bb-therapist.<your-subdomain>.workers.dev` address in Chrome, Edge, or Safari on your computer.
5. The first screen asks for the passcode; the browser remembers it after one correct entry. Shortcut: open `https://<your-address>/#key=<APP_PASSCODE>` to skip the screen.

The wrong-passcode lockout, per-address limit and daily cap are kept in one Cloudflare Durable Object (free plan is enough). To try the Worker on your computer: put the two secrets in a `.dev.vars` file (`NAME=value` lines) and run `npm run dev`.

## Settings (environment variables)
| Name | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Required |
| `APP_PASSCODE` | none | Strongly recommended. Asked for on the first screen (or via `/#key=<APP_PASSCODE>`). Without it anyone with the URL can use your key |
| `DAILY_LIMIT` | `300` (in `wrangler.jsonc` on Cloudflare) | Max chat replies per day, all users together |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used for chat |
| `CLAUDE_EFFORT` | `medium` | `low` is faster and cheaper; `high` thinks harder |
| `PORT` | `3000` | |

## Files
- `server/prompt.js`: how Claude is told to behave. **Have a clinician read this.**
- `worker/index.js`: the Cloudflare version of the server. Stores no messages and logs no content.
- `server/server.js`: the plain Node version (for `npm start`). Stores and logs nothing.
- `public/crisis.js`: in-browser risk phrase check (runs before any AI call, works offline).
- `public/voice.js`: microphone, speech-to-text, and the voice measurements. Raw audio never leaves this file.
- `public/app.js`: the app screens. All of a person's data stays in their own browser's storage.
