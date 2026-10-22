# Calm like a Potato: a daily mood check-in app

A web app for people who live with bipolar disorder (anyone may use it), on a laptop or PC, for a short daily check-in (Derek, 2026-10-17: "not a tool to be used in a crisis"; 2026-10-19: for anyone, not one person, with gender-neutral wording). The user talks to it by voice. It coaches them through skills from two proven talk therapies: cognitive behavioral therapy (spotting and testing unhelpful thoughts) and dialectical behavior therapy (skills for riding out strong emotions and urges).

**What it is not:** a therapist, a doctor, or a crisis tool. It sits beside the person's care team. It never gives medication advice.

## Decisions made (change any of them)

| Decision | Choice | Why |
|---|---|---|
| Platform | Web app in Chrome, Edge, or Safari on a laptop or PC only (Derek, 2026-10-19: MVP proof of concept; phones may come later) | Keeps it simple; the browser's free speech-to-text works there |
| AI | Claude (Anthropic API), model `claude-opus-5-5` | Strongest model for careful, emotional conversation |
| Where data lives | Only in each user's own browser | Most private option; nothing to breach on a server |
| Server | Tiny Node server that holds the API key and passes messages through. Stores and logs nothing | Keeps the key off users' computers |
| Access | A passcode Derek sets on the server | Stops strangers who find the web address from running up the bill |

## How it works

1. **No check-in screen**: Chit Chat (the first tab) opens straight into the conversation, with an optional 1-10 mood scale at the top (1 very sad, 5-6 okay, 10 very happy). Claude works out their state from that, their words, and their voice.
2. **The check-in loop** (Derek, 2026-10-19): mood 1-10 at the top, then "How are you feeling?", then "Would you like to vent, or do an exercise to help?". After the vent or exercise Claude asks "How do you feel now?" and the app shows a 1-10 picker (Claude sends a hidden [[MOOD]] flag). Their tap is sent as their answer, then "Would you like to talk or do an exercise to help?" and the loop repeats. This loop is the only conversation structure. Safety overrides the loop.
3. **Voice chat (no typing)**: they click the mic (or presses Space) and talks. The browser turns speech into words, and the app measures 4 things on its own: speaking speed, pauses, pitch range, and loudness, compared to their usual. Claude gets the words, those numbers, their state, and their mood number, and coaches to fit. Recordings are never saved or uploaded by the app; only the words and numbers leave the computer. The browser's own speech-to-text sends audio to Google (Chrome, Edge) or Apple (Safari).
4. No safety plan or emergency contacts (removed 2026-10-17).
5. No mood or sleep log is kept and there is no export (Skills, Plan, Log tabs and the check-in page removed 2026-10-17). Their usual voice is the median of recordings made at mood 5-6 (3 needed), otherwise of all recordings once there are 5.

## How the coaching changes by state

| State | What Claude does | Main skills |
|---|---|---|
| **Low (depressive)** | Warm, slow, very small steps. Does not argue with feelings. Checks safety gently. | Behavioral activation (one 5-minute action), thought record, self-soothe, opposite action |
| **High / racing (manic or hypomanic)** | Short, calm sentences. Does not match their energy. Does not cheer big plans or fight them. Focuses on sleep, cutting stimulation, and waiting before big decisions. Asks about spending, driving, substances, sex, and sleep. | 48-hour rule on big decisions, wind-down for sleep, STOP skill, check the facts, call prescriber if sleep is under 6 hours for 2+ nights |
| **Mixed** | Treated as the **highest risk** state. Checks safety early. Brings down body arousal first, talk later. Pushes to contact their care team today. | TIPP (cold water, intense exercise, paced breathing, muscle relaxation) |
| **Anxious** | Grounding first, then thought work | Paced breathing, 5-4-3-2-1 grounding, thought record |

## If risk comes up (minimal safety net)

Not a crisis tool, but two independent checks stay, so a mention of suicide or self-harm is never ignored:

1. **In the browser, before any AI**: each message is scanned for about 30 risk phrases ("kill myself", "better off dead", "take all my pills"). A match opens a small panel with Call 988 and Text 988 (US Suicide and Crisis Lifeline), even offline.
2. **Claude itself**: judges risk in context, replies with care, points them to 988 (911 if in immediate danger), and flags it, which opens the same panel.

They close it with "Back to the conversation". No contacts, safety plan, or manual button (Derek's calls, 2026-10-17).

## Risks and weak spots

1. **AI can say the wrong thing.** Even a strong model can miss risk or phrase something badly at a fragile moment. Lowered by: the in-browser scan, strict instructions, short answers. Not removed. **Have a clinician read the system prompt (`server/prompt.js`) and try the app before anyone relies on it.**
2. **In a high or very low state, people may not open it, or may argue with it.** The app cannot fix that. There is no log screen or export to share trends with a care team.
3. **Privacy is good, not perfect.** Chats are stored only in the user's browser. They do pass through Anthropic to get answers. Anthropic does not train on API data by default and keeps it for a limited time (check current terms: https://www.anthropic.com/legal/commercial-terms). This is **not** a medical-grade (HIPAA) setup. Anyone with their unlocked computer can read the history; there is a "delete all" button.
4. **Clearing browser data wipes everything.** There is no export.
5. **Cost.** Rough guess: a 20-message chat costs about $0.10 to $0.40 with Opus 5.5 ($4 per million input tokens and $20 per million output tokens; a token is about 3/4 of a word). Heavy daily use might be $5 to $20 a month. Set a monthly spend limit in the Anthropic console.
6. **Open audience (2026-10-19).** Anyone with the link and passcode can use it. Everyone shares one passcode, one daily cap (300 replies), and Derek's API bill. 988 is US-only; Claude is told to point people outside the US to local help, but the panel still shows 988.
7. **Word list false alarms.** "This traffic is killing me" can trigger the panel. That is a deliberate trade: a false alarm costs 2 seconds; a miss could cost much more.

8. **Voice limits.** Voice numbers are hints. In a 2016 study of 28 people with bipolar disorder, voice features scored 0.89 (manic or mixed) and 0.78 (depressed) on a 0.5 = coin-flip, 1.0 = perfect scale, measured against each person's own normal (Faurholt-Jepsen et al., Translational Psychiatry). Noise, a cold, or whispering skews them. The baseline builds from recordings at mood 5-6 (3 needed) or any 5 recordings.
10. **Computer only.** Phones show a "use a computer" note (on phones the browser's speech-to-text fights the mic meter and fails in iPhone home-screen apps). OpenAI speech-to-text was removed 2026-10-19. A check-in needs a computer.
9. **Voice only means no fallback.** If they can't speak (other people around) or the mic fails, the check-in can't happen that day.

## What I'd do next (in order)

1. A clinician reviews `server/prompt.js` and tests 3 to 5 scenarios.
2. Deploy (steps in `README.md`) and open it on a computer.
3. After 2 weeks of use: decide on reminders and an opt-in alert to a trusted person.
4. Later, if it sticks: a native app for lock-screen access and voice input.
