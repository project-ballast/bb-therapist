# Steady: a support app for Ellie

A phone app Ellie opens when she feels a mood episode coming on or is in one. She says how she feels, picks a state, and talks to it. It coaches her through skills from two proven talk therapies: cognitive behavioral therapy (spotting and testing unhelpful thoughts) and dialectical behavior therapy (skills for riding out strong emotions and urges).

**What it is not:** a therapist, a doctor, or a crisis service. It sits beside her care team. It never gives medication advice.

## Decisions made (change any of them)

| Decision | Choice | Why |
|---|---|---|
| Platform | Web app she adds to her home screen (works on iPhone and Android) | One codebase, no app store review, can ship today |
| AI | Claude (Anthropic API), model `claude-opus-5-5` | Strongest model for careful, emotional conversation |
| Where data lives | Only on her phone (browser storage) | Most private option; nothing to breach on a server |
| Server | Tiny Node server that holds the API key and passes messages through. Stores and logs nothing | Keeps the key off her phone |
| Access | A passcode Derek sets on the server | Stops strangers who find the web address from running up the bill |

## How it works

1. **Check-in** (10 seconds): mood slider from -5 (very low) to +5 (very high), hours slept last night, and a state: Low, High/racing, Mixed (low mood + high energy), Anxious, or Not sure.
2. **Chat**: Claude gets her state, sleep, warning signs, and the skills she likes, and coaches to fit.
3. **Skills library**: 13 step-by-step skill cards that work with no internet.
4. **Safety plan**: her own warning signs, coping steps, people, and professionals, with one-tap call and text.
5. **Mood log**: every check-in saved, last 14 days shown, export to a file she can bring to her psychiatrist.

## How the coaching changes by state

| State | What Claude does | Main skills |
|---|---|---|
| **Low (depressive)** | Warm, slow, very small steps. Does not argue with feelings. Checks safety gently. | Behavioral activation (one 5-minute action), thought record, self-soothe, opposite action |
| **High / racing (manic or hypomanic)** | Short, calm sentences. Does not match her energy. Does not cheer big plans or fight them. Focuses on sleep, cutting stimulation, and waiting before big decisions. Asks about spending, driving, substances, sex, and sleep. | 48-hour rule on big decisions, wind-down for sleep, STOP skill, check the facts, call prescriber if sleep is under 6 hours for 2+ nights |
| **Mixed** | Treated as the **highest risk** state. Checks safety early. Brings down body arousal first, talk later. Pushes to contact her care team today. | TIPP (cold water, intense exercise, paced breathing, muscle relaxation), safety plan |
| **Anxious** | Grounding first, then thought work | Paced breathing, 5-4-3-2-1 grounding, thought record |

## Crisis handling (core requirement)

Two independent layers, so one failure does not hide risk:

1. **On the phone, before any AI is involved**: every message she types is scanned for about 30 risk phrases ("kill myself", "better off dead", "take all my pills", etc.). A match opens the crisis panel instantly, even with no internet.
2. **Claude itself**: told to judge risk in context (it catches things word lists miss, like "I've been giving my stuff away") and to flag it. The flag opens the same panel.

The crisis panel shows: call or text **988** (US Suicide and Crisis Lifeline), **911**, a one-tap text to her chosen person ("I'm having a really hard time. Can you call me?"), her safety-plan steps, and her care team. She can close it with "I'm safe right now". The chat keeps going; it does not lock her out.

If the API fails or refuses a message, the app shows the crisis options and skills instead of a blank error.

## Risks and weak spots

1. **AI can say the wrong thing.** Even a strong model can miss risk or phrase something badly at a fragile moment. Lowered by: the phone-side scan, strict instructions, short answers. Not removed. **Have her psychiatrist or therapist read the system prompt (`server/prompt.js`) and try the app before she relies on it.**
2. **During mania she may not open it, or may argue with it.** People in a high state often feel great and see no problem. The app cannot fix that. The mood log and sleep tracking help her and her team see a high coming earlier. A future step: daily reminder and an alert to Derek after 2 nights under 6 hours of sleep, only if Ellie agrees.
3. **Privacy is good, not perfect.** Chats are stored only on her phone. They do pass through Anthropic to get answers. Anthropic does not train on API data by default and keeps it for a limited time (check current terms: https://www.anthropic.com/legal/commercial-terms). This is **not** a medical-grade (HIPAA) setup. Anyone with her unlocked phone can read the history; there is a "delete all" button.
4. **Clearing browser data wipes everything.** Use the export button now and then.
5. **Cost.** Rough guess: a 20-message chat costs about $0.10 to $0.40 with Opus 5.5 ($4 per million input tokens and $20 per million output tokens; a token is about 3/4 of a word). Heavy daily use might be $5 to $20 a month. Set a monthly spend limit in the Anthropic console.
6. **Consent.** Build this *with* Ellie, not *for* her. If she does not want it, she will not use it in an episode. Let her write her own safety plan and pick her own skills.
7. **Word list false alarms.** "This traffic is killing me" can trigger the panel. That is a deliberate trade: a false alarm costs 2 seconds; a miss could cost much more.

## What I'd do next (in order)

1. Ellie fills in her safety plan with her therapist (paper version: Stanley-Brown Safety Plan).
2. Her clinician reviews `server/prompt.js` and tests 3 to 5 scenarios.
3. Deploy (steps in `README.md`), add to her home screen.
4. After 2 weeks of use: decide on reminders and an opt-in alert to a trusted person.
5. Later, if it sticks: a native app for lock-screen access and voice input.
