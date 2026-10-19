# Calm like a Potato: a support app for Ellie

A phone app Ellie uses for a short daily check-in (Derek, 2026-10-17: "not a tool to be used in a crisis"). She talks to it by voice. It coaches her through skills from two proven talk therapies: cognitive behavioral therapy (spotting and testing unhelpful thoughts) and dialectical behavior therapy (skills for riding out strong emotions and urges).

**What it is not:** a therapist, a doctor, or a crisis tool. It sits beside her care team. It never gives medication advice.

## Decisions made (change any of them)

| Decision | Choice | Why |
|---|---|---|
| Platform | Web app she adds to her home screen (works on iPhone and Android) | One codebase, no app store review, can ship today |
| AI | Claude (Anthropic API), model `claude-opus-5-5` | Strongest model for careful, emotional conversation |
| Where data lives | Only on her phone (browser storage) | Most private option; nothing to breach on a server |
| Server | Tiny Node server that holds the API key and passes messages through. Stores and logs nothing | Keeps the key off her phone |
| Access | A passcode Derek sets on the server | Stops strangers who find the web address from running up the bill |

## How it works

1. **No check-in screen**: Chit Chat (the first tab) opens straight into the conversation, with an optional 1-10 mood scale at the top (1 very low, 5-6 okay, 10 very high). Claude works out her state from that, her words, and her voice, and asks about sleep.
2. **The check-in loop** (Derek, 2026-10-19): mood 1-10 at the top, then "How are you feeling?", then "Would you like to vent, or do an exercise to help?". After the vent or exercise Claude asks "How do you feel now?" and the app shows a 1-10 picker (Claude sends a hidden [[MOOD]] flag). Her tap is sent as her answer, then "Would you like to talk or do an exercise to help?" and the loop repeats. Safety overrides the loop.
3. **Voice chat (no typing)**: she taps the mic and talks. Her phone turns speech into words and measures 4 things on its own: speaking speed, pauses, pitch range, and loudness, compared to her usual. Claude gets the words, those numbers, her state, sleep, warning signs, and her favorite skills, and coaches to fit. Recordings are never saved or uploaded by the app; only the words and numbers leave the phone. The phone's own speech-to-text may send audio to Apple or Google.
4. No safety plan or emergency contacts (removed 2026-10-17).
5. No mood or sleep log is kept and there is no export (Skills, Plan, Log tabs and the check-in page removed 2026-10-17). Her usual voice is the median of recordings made at mood 5-6 (3 needed), otherwise of all recordings once there are 5.

## How the coaching changes by state

| State | What Claude does | Main skills |
|---|---|---|
| **Low (depressive)** | Warm, slow, very small steps. Does not argue with feelings. Checks safety gently. | Behavioral activation (one 5-minute action), thought record, self-soothe, opposite action |
| **High / racing (manic or hypomanic)** | Short, calm sentences. Does not match her energy. Does not cheer big plans or fight them. Focuses on sleep, cutting stimulation, and waiting before big decisions. Asks about spending, driving, substances, sex, and sleep. | 48-hour rule on big decisions, wind-down for sleep, STOP skill, check the facts, call prescriber if sleep is under 6 hours for 2+ nights |
| **Mixed** | Treated as the **highest risk** state. Checks safety early. Brings down body arousal first, talk later. Pushes to contact her care team today. | TIPP (cold water, intense exercise, paced breathing, muscle relaxation) |
| **Anxious** | Grounding first, then thought work | Paced breathing, 5-4-3-2-1 grounding, thought record |

## If risk comes up (minimal safety net)

Not a crisis tool, but two independent checks stay, so a mention of suicide or self-harm is never ignored:

1. **On the phone, before any AI**: each message is scanned for about 30 risk phrases ("kill myself", "better off dead", "take all my pills"). A match opens a small panel with Call 988 and Text 988 (US Suicide and Crisis Lifeline), even offline.
2. **Claude itself**: judges risk in context, replies with care, points her to 988 (911 if in immediate danger), and flags it, which opens the same panel.

She closes it with "Back to the conversation". No contacts, safety plan, or manual button (Derek's calls, 2026-10-17).

## Risks and weak spots

1. **AI can say the wrong thing.** Even a strong model can miss risk or phrase something badly at a fragile moment. Lowered by: the phone-side scan, strict instructions, short answers. Not removed. **Have her psychiatrist or therapist read the system prompt (`server/prompt.js`) and try the app before she relies on it.**
2. **During mania she may not open it, or may argue with it.** People in a high state often feel great and see no problem. The app cannot fix that. Sleep and voice tracking could help her team see a high coming earlier, but there is no longer a log screen or export to share it. A future step: daily reminder and an alert to Derek after 2 nights under 6 hours of sleep, only if Ellie agrees.
3. **Privacy is good, not perfect.** Chats are stored only on her phone. They do pass through Anthropic to get answers. Anthropic does not train on API data by default and keeps it for a limited time (check current terms: https://www.anthropic.com/legal/commercial-terms). This is **not** a medical-grade (HIPAA) setup. Anyone with her unlocked phone can read the history; there is a "delete all" button.
4. **Clearing browser data wipes everything.** There is no export.
5. **Cost.** Rough guess: a 20-message chat costs about $0.10 to $0.40 with Opus 5.5 ($4 per million input tokens and $20 per million output tokens; a token is about 3/4 of a word). Heavy daily use might be $5 to $20 a month. Set a monthly spend limit in the Anthropic console.
6. **Consent.** Build this *with* Ellie, not *for* her. If she does not want it, she will not use it.
7. **Word list false alarms.** "This traffic is killing me" can trigger the panel. That is a deliberate trade: a false alarm costs 2 seconds; a miss could cost much more.

8. **Voice limits.** Voice numbers are hints. In a 2016 study of 28 people with bipolar disorder, voice features scored 0.89 (manic or mixed) and 0.78 (depressed) on a 0.5 = coin-flip, 1.0 = perfect scale, measured against each person's own normal (Faurholt-Jepsen et al., Translational Psychiatry). Noise, a cold, or whispering skews them. Her baseline builds from recordings at mood 5-6 (3 needed) or any 5 recordings.
10. **Phone voice goes through OpenAI.** On phones, the browser's speech-to-text conflicts with the mic meter (and fails in iPhone home-screen apps), so the app records audio and the server sends it to OpenAI (`gpt-4o-mini-transcribe`, about $0.003 per minute) to get words. Audio is not saved by the app; it is one more company that sees it. No live words appear while she talks.
9. **Voice only means no fallback.** If she can't speak (other people around) or the mic fails, the check-in can't happen that day.

## What I'd do next (in order)

1. Her clinician reviews `server/prompt.js` and tests 3 to 5 scenarios.
2. Deploy (steps in `README.md`), add to her home screen.
3. After 2 weeks of use: decide on reminders and an opt-in alert to a trusted person.
4. Later, if it sticks: a native app for lock-screen access and voice input.
