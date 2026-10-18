# Calm like a Potato

Phone web app for Ellie's daily check-ins: she talks (voice only) to Claude, which uses CBT and DBT skills and on-phone voice measurements (speed, pauses, pitch range, loudness) compared to her usual. It is not a crisis tool; if risk is detected it shows the 988 Lifeline. The plan and risks are in `PLAN.md`.

## What you need
- An Anthropic API key: https://console.anthropic.com → API Keys. Set a monthly spend limit there (for example $25).
- Node.js 20 or newer.
- A host that gives you an `https://` address (needed to add the app to a phone home screen). Render, Railway, and Fly.io all work.

## Run it on your computer
```
npm install
ANTHROPIC_API_KEY=sk-ant-... APP_PASSCODE=pick-a-long-passcode npm start
```
Open http://localhost:3000. Voice: Chrome or Edge on a PC uses the browser's free speech-to-text. Phones (iPhone, iPad, Android, in the browser or as a home-screen app) and Firefox record audio and the server sends it to OpenAI to turn into words, which needs `OPENAI_API_KEY` (about $0.003 per minute of speech). Brave and Opera don't work. On a PC, click the mic or press Space to start and send. Run the safety tests with `npm test`.

## Put it online (Render example)
Easiest: on https://render.com choose New → Blueprint, pick this repository, and enter `ANTHROPIC_API_KEY` and `APP_PASSCODE` when asked. `render.yaml` fills in everything else.

Or set up a Web Service by hand:
1. New → Web Service → pick this repository.
2. Build Command: `npm install` (not `start`). Start Command: `npm start`.
3. Add environment variables: `ANTHROPIC_API_KEY`, `APP_PASSCODE`, and `OPENAI_API_KEY` (for voice on phones).
4. Deploy, then open the `https://...onrender.com` address on Ellie's phone.
5. Add to home screen: iPhone Safari → Share → Add to Home Screen. Android Chrome → menu → Add to Home screen.
6. Enter the passcode once in Settings → App passcode. Shortcut: open `https://<your-app>.onrender.com/#key=<APP_PASSCODE>` and it fills it in for you.

Note: Render's free tier sleeps after about 15 minutes idle, so the first reply can take 30 to 60 seconds. A paid instance (about $7 a month) answers fast every time.

## Settings (environment variables)
| Name | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Required |
| `APP_PASSCODE` | none | Strongly recommended. Entered once in Settings (or via `/#key=<APP_PASSCODE>`). Without it anyone with the URL can use your key |
| `DAILY_LIMIT` | `300` | Max chat replies per day, all users together |
| `OPENAI_API_KEY` | none | Needed for voice on phones. Get one at https://platform.openai.com/api-keys |
| `TRANSCRIBE_MODEL` | `gpt-4o-mini-transcribe` | OpenAI speech-to-text model |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used for chat |
| `CLAUDE_EFFORT` | `medium` | `low` is faster and cheaper; `high` thinks harder |
| `PORT` | `3000` | |

## Files
- `server/prompt.js`: how Claude is told to behave. **Have her clinician read this.**
- `server/server.js`: passes messages to Claude. Stores and logs nothing.
- `public/crisis.js`: phone-side risk phrase check (runs before any AI call, works offline).
- `public/voice.js`: microphone, speech-to-text, and the voice measurements. Raw audio never leaves this file.
- `public/app.js`: the app screens. All her data stays in her phone's browser storage.
