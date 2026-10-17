# Steady

Phone web app for Ellie: check in on mood, talk to Claude using CBT and DBT skills, offline skill cards, safety plan with one-tap crisis contacts, and a mood log to export for her care team. The plan and risks are in `PLAN.md`.

## What you need
- An Anthropic API key: https://console.anthropic.com → API Keys. Set a monthly spend limit there (for example $25).
- Node.js 20 or newer.
- A host that gives you an `https://` address (needed to add the app to a phone home screen). Render, Railway, and Fly.io all work.

## Run it on your computer
```
npm install
ANTHROPIC_API_KEY=sk-ant-... APP_PASSCODE=pick-a-long-passcode npm start
```
Open http://localhost:3000. Run the safety tests with `npm test`.

## Put it online (Render example)
1. Push this folder to a private GitHub repository.
2. On https://render.com: New → Web Service → pick the repository.
3. Build command `npm install`, start command `npm start`.
4. Add environment variables: `ANTHROPIC_API_KEY` and `APP_PASSCODE`.
5. Deploy, then open the `https://...onrender.com` address on Ellie's phone.
6. Add to home screen: iPhone Safari → Share → Add to Home Screen. Android Chrome → menu → Add to Home screen.
7. First launch opens Settings: enter her name and the passcode.

Note: Render's free tier sleeps after about 15 minutes idle, so the first reply can take 30 to 60 seconds. Use a paid instance (about $7 a month) so it answers fast in a bad moment. The skills, safety plan, and crisis numbers work even when the server is asleep or offline.

## Settings (environment variables)
| Name | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Required |
| `APP_PASSCODE` | none | Strongly recommended; without it anyone with the URL can use your key |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used for chat |
| `CLAUDE_EFFORT` | `medium` | `low` is faster and cheaper; `high` thinks harder |
| `PORT` | `3000` | |

## Files
- `server/prompt.js`: how Claude is told to behave. **Have her clinician read this.**
- `server/server.js`: passes messages to Claude. Stores and logs nothing.
- `public/crisis.js`: phone-side risk phrase check (runs before any AI call, works offline).
- `public/skills.js`: the 13 skill cards.
- `public/app.js`: the app screens. All her data stays in her phone's browser storage.
