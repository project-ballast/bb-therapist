import { detectRisk, stripToken, CRISIS_TOKEN, MOOD_TOKEN } from "./crisis.js";
import { VoiceSession, voiceProblem, baseline, describeVoice } from "./voice.js";

// ---------- storage (this computer only) ----------
const KEYS = { profile: "steady.profile", plan: "steady.plan", log: "steady.log", chat: "steady.chat", voice: "steady.voice" };
function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked; the app still works for this session */
  }
}

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const opener = () =>
  `${profile.name ? `Hi ${profile.name}. ` : "Hi. "}How are you feeling?`;

let profile = load(KEYS.profile, { name: "", passcode: "" });
// One-time setup link: https://<app>/#key=<APP_PASSCODE> saves the key on this device, then hides it.
const linkKey = new URLSearchParams(location.hash.slice(1)).get("key");
if (linkKey) {
  profile.passcode = linkKey;
  save(KEYS.profile, profile);
  history.replaceState(null, "", location.pathname);
}
let chat = load(KEYS.chat, null); // {started, messages:[{role,content,voice?}]}
let voiceHistory = load(KEYS.voice, []); // numbers only, newest first: {at, wordsPerMinute, ...}
let sending = false;

// ---------- navigation ----------
function show(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(`view-${view}`).classList.remove("hidden");
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  if (view === "settings") renderSettings();
  window.scrollTo(0, view === "chat" ? document.body.scrollHeight : 0);
}
document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => (b.dataset.view === "chat" ? openChat() : show(b.dataset.view)))
);
// A chat counts as current until 3 hours after their last message (Derek, 2026-10-19).
const CHAT_GAP_MS = 3 * 3600 * 1000;
const recent = (c) => Date.now() - new Date(c.lastAt || c.started).getTime() < CHAT_GAP_MS;

// ---------- conversation start ----------
// Chit Chat resumes the conversation if they talked in the last 3 hours, otherwise starts a new one.
function openChat() {
  if (!chat?.messages?.length || !recent(chat)) newChat();
  else renderChat();
  show("chat");
}
function newChat() {
  if (session) return; // don't drop a recording in progress
  chat = { started: new Date().toISOString(), messages: [{ role: "assistant", content: opener() }] };
  save(KEYS.chat, chat);
  renderChat();
}
$("newChatBtn").addEventListener("click", () => {
  if (sending) return;
  newChat();
  show("chat");
});

// ---------- chat ----------
// ---------- mood scale (1 very low, 5-6 okay, 10 very high / wired) ----------
const moodScale = $("moodScale");
// chat.mood is their latest number (sent to Claude); chat.startMood is the one tapped in the top bar,
// which stays put so a later "How do you feel now?" pick doesn't rewrite it.
function setMood(n, { top = false } = {}) {
  chat.mood = n;
  if (top) chat.startMood = n;
  chat.moodAt = new Date().toISOString();
  save(KEYS.chat, chat);
  renderMood();
}
function moodButtons(box, onPick) {
  for (let n = 1; n <= 10; n++) {
    const b = el("button", "mood-btn", String(n));
    b.type = "button";
    b.dataset.mood = n;
    b.setAttribute("aria-label", `Mood ${n} of 10`);
    b.addEventListener("click", () => onPick(n));
    box.append(b);
  }
}
moodButtons(moodScale, (n) => chat && setMood(n, { top: true }));
function renderMood() {
  const shown = chat?.startMood ?? chat?.mood;
  moodScale.querySelectorAll(".mood-btn").forEach((b) => b.classList.toggle("on", Number(b.dataset.mood) === shown));
}

// "How do you feel now?" after a vent or an exercise: Claude ends its reply with [[MOOD]].
// Tapping a number updates their mood and sends it as their answer, which restarts the loop.
function moodCheck() {
  const box = el("div", "moodcheck");
  box.append(el("div", "moodbar-head", "How do you feel now? 1 very low · 5-6 okay · 10 very high"));
  const row = el("div", "mood-scale");
  moodButtons(row, (n) => {
    if (sending) return;
    box.remove();
    setMood(n);
    sendMessage(`My mood now: ${n} out of 10.`, null);
  });
  box.append(row);
  return box;
}

function renderChat() {
  renderMood();
  const box = $("messages");
  box.replaceChildren();
  const msgs = chat?.messages || [];
  msgs.forEach((m, i) => {
    if (m.role === "assistant" && i > 0 && debugOn()) box.append(debugPanel(msgs[i - 1], m.analysis));
    box.append(bubble(m.role, m.role === "assistant" ? stripToken(m.content) : m.content));
  });
  const last = msgs[msgs.length - 1];
  if (last?.role === "assistant" && last.content.includes(MOOD_TOKEN)) box.append(moodCheck());
}
function bubble(role, text) {
  return el("div", `msg ${role}`, text);
}

// ---------- debug: voice analysis panel (Settings switch) ----------
const debugOn = () => profile.debugVoice !== false;
const ANALYSIS_PREFIX = "[[ANALYSIS]]";
function parseAnalysis(line) {
  const out = {};
  for (const part of line.replace(ANALYSIS_PREFIX, "").split(";")) {
    const [k, ...v] = part.split("=");
    if (k && v.length) out[k.trim()] = v.join("=").trim();
  }
  return out;
}
// Splits a streamed reply into the hidden analysis line (debug mode) and the text they see.
function splitReply(full) {
  if (!full.startsWith(ANALYSIS_PREFIX.slice(0, Math.min(full.length, ANALYSIS_PREFIX.length)))) return { analysis: null, text: full, pending: false };
  const nl = full.indexOf("\n");
  if (nl < 0) return { analysis: null, text: "", pending: true };
  return { analysis: parseAnalysis(full.slice(0, nl)), text: full.slice(nl + 1).replace(/^\s+/, ""), pending: false };
}
function debugPanel(userMsg, analysis) {
  const box = el("details", "debug");
  box.open = true;
  box.append(el("summary", null, "Voice analysis (debug)"));
  const f = userMsg?.voice;
  if (!f) {
    box.append(el("p", "muted", userMsg?.role === "user" ? "No voice measurements for this message (too short, or the mic meter was blocked)." : "No message to analyze."));
  } else {
    const history = voiceHistory.filter((h) => h.at !== f.at && h.at < f.at);
    const d = describeVoice(f, baseline(history));
    box.append(el("h4", null, "Measured on this computer (real numbers)"));
    const table = el("dl");
    d.rows.forEach(([k, v]) => table.append(el("dt", null, k), el("dd", null, v)));
    box.append(table, el("p", null, `Reading of those numbers (rule of thumb): ${d.summary}.`), el("p", "muted", d.baselineNote));
  }
  const emo = el("div", "emotion");
  fillEmotion(emo, analysis);
  box.append(emo);
  return box;
}
function fillEmotion(node, a) {
  node.replaceChildren(el("h4", null, "Emotion guess (from Claude, not measured)"));
  if (a === undefined) node.append(el("p", "muted", "Waiting for Claude..."));
  else if (!a) node.append(el("p", "muted", "Claude didn't return a guess for this message."));
  else {
    node.append(el("p", null, `${a.emotion || "?"} (confidence: ${a.confidence || "?"}; based on: ${a.based_on || "?"})`));
    if (a.why) node.append(el("p", "muted", a.why));
  }
}
function scrollDown() {
  window.scrollTo(0, document.body.scrollHeight);
}

function context() {
  return {
    name: profile.name || undefined,
    mood10: typeof chat.mood === "number" ? chat.mood : undefined,
    voice: voiceContext(),
    localTime: new Date().toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" }),
  };
}

function voiceContext() {
  const last = chat.messages[chat.messages.length - 1];
  if (!last?.voice) return undefined;
  const history = voiceHistory.filter((h) => h.at !== last.voice.at); // their usual, not counting this message
  return { latest: last.voice, baseline: baseline(history), feedback: profile.voiceFeedback !== false };
}

// ---------- voice input ----------
let session = null;
const micBtn = $("micBtn");
function setMic(state) {
  micBtn.classList.toggle("on", state === "listening");
  micBtn.disabled = state === "busy";
  $("micHint").textContent = { idle: IDLE_HINT, listening: isDesktop ? "Listening... click or press Space to send" : "Listening... tap again to send", busy: "..." }[state];
  $("cancelVoice").classList.toggle("hidden", state !== "listening");
  $("liveText").classList.toggle("hidden", state !== "listening");
}
const isDesktop = matchMedia("(hover: hover) and (pointer: fine)").matches;
const IDLE_HINT = isDesktop ? "Click or press Space to talk" : "Tap to talk";
const VOICE_HELP = {
  insecure: "Voice only works when the app is opened at its https:// address (or http://localhost on this computer).",
  unsupported: "This browser has no speech-to-text. Use Chrome, Edge, or Safari.",
  network: "This browser couldn't reach its speech-to-text service. Brave and Opera block it; use Chrome, Edge, or Safari, and check the internet connection.",
  phone: "Calm like a Potato works on a computer for now. Open it in Chrome, Edge, or Safari on a laptop or PC.",
  "not-allowed": "The microphone is blocked. Click the icon left of the web address, allow Microphone, then try again. On Windows, also check Settings > Privacy > Microphone.",
  "audio-capture": "No microphone found. Plug one in, or check your computer's sound settings.",
  "language-not-supported": "Speech-to-text doesn't support this browser's language setting.",
};
VOICE_HELP["service-not-allowed"] = VOICE_HELP["not-allowed"];
const problem = voiceProblem();
if (problem) {
  micBtn.classList.add("hidden");
  $("micHint").textContent = VOICE_HELP[problem];
}
else setMic("idle");
micBtn.addEventListener("click", async () => {
  if (sending) return;
  if (!session) {
    session = new VoiceSession({
      onTranscript: (t) => ($("liveText").textContent = t || "..."),
      onFatal: (err) => {
        session = null;
        setMic("idle");
        $("messages").append(bubble("note", VOICE_HELP[err] || "Voice stopped working. Try again."));
        scrollDown();
      },
    });
    $("liveText").textContent = "...";
    setMic("listening");
    session.start();
    return;
  }
  setMic("busy");
  const current = session;
  const { text, features, error } = await current.stop();
  if (session !== current) return; // a fatal error already reset the mic
  session = null;
  setMic("idle");
  if (!text) {
    const why = VOICE_HELP[error] || "I didn't catch that. Try the mic again, a little closer.";
    $("messages").append(bubble("note", why));
    scrollDown();
    return;
  }
  let voice = null;
  if (features) {
    voice = { at: new Date().toISOString(), ...features };
    voiceHistory.unshift(typeof chat.mood === "number" ? { ...voice, mood10: chat.mood } : voice);
    voiceHistory = voiceHistory.slice(0, 300);
    save(KEYS.voice, voiceHistory);
  }
  await sendMessage(text, voice);
});
// On a computer, Space starts and sends a voice message.
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || $("view-chat").classList.contains("hidden")) return;
  if (!$("crisis").classList.contains("hidden") || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement?.tagName)) return;
  e.preventDefault();
  micBtn.click();
});
$("cancelVoice").addEventListener("click", () => {
  session?.cancel();
  session = null;
  setMic("idle");
});

async function sendMessage(text, voice) {
  document.querySelectorAll(".moodcheck").forEach((n) => n.remove()); // they answered another way
  if (detectRisk(text)) openCrisis(); // before any network call
  const msg = { role: "user", content: text };
  if (voice) msg.voice = voice;
  chat.messages.push(msg);
  chat.lastAt = new Date().toISOString();
  save(KEYS.chat, chat);
  $("messages").append(bubble("user", text));
  await askClaude();
}

async function askClaude() {
  sending = true;
  micBtn.disabled = true;
  const showDebug = debugOn();
  const userMsg = chat.messages[chat.messages.length - 1];
  const panel = showDebug ? debugPanel(userMsg, undefined) : null;
  if (panel) $("messages").append(panel);
  const reply = bubble("assistant typing", "...");
  $("messages").append(reply);
  let analysis = null;
  scrollDown();
  let full = "";
  let failed = null;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-App-Passcode": profile.passcode || "" },
      // Only what the server uses (it keeps the last 40), so a long chat never hits the 200 KB request cap.
      body: JSON.stringify({ messages: chat.messages.slice(-40).map(({ role, content }) => ({ role, content })), context: context(), debug: showDebug }),
    });
    if (res.status === 401) failed = "passcode";
    else if (res.status === 429) failed = "busy";
    else if (!res.ok || !res.body) failed = "failed";
    else {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let stop = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.t === "text") {
            full += ev.v;
            const part = splitReply(full);
            if (part.analysis && !analysis) {
              analysis = part.analysis;
              if (panel) fillEmotion(panel.querySelector(".emotion"), analysis);
            }
            if (!part.pending && part.text) {
              reply.classList.remove("typing");
              reply.textContent = stripToken(part.text);
            }
            scrollDown();
          } else if (ev.t === "done") stop = ev.stop;
          else if (ev.t === "error") failed = ev.v;
        }
      }
      if (stop === "refusal") failed = "refusal";
      else if (!failed && !splitReply(full).text.trim()) failed = "failed";
    }
  } catch {
    failed = "offline";
  }

  if (full.includes(CRISIS_TOKEN)) openCrisis();
  if (!failed && full.includes(MOOD_TOKEN)) {
    $("messages").append(moodCheck());
    scrollDown();
  }
  if (failed) {
    reply.remove();
    panel?.remove();
    const msgs = {
      passcode: "Enter the app passcode in Settings once, then come back to Chit Chat.",
      busy: "The app is busy. Try again in a minute.",
      offline: "No connection right now. If you need someone now, call or text 988.",
      refusal: "I couldn't answer that one. If you're struggling, call or text 988 to reach a person.",
      failed: "Something went wrong getting a reply. Try again, or call or text 988 if you need someone now.",
    };
    $("messages").append(bubble("note", msgs[failed] || msgs.failed));
    // keep history valid: drop the unanswered user turn; one tap resends it
    const last = chat.messages.pop();
    if (last && failed !== "refusal") {
      const retry = el("button", "chip retry", "Try again");
      retry.type = "button";
      retry.addEventListener("click", async () => {
        if (sending) return;
        retry.remove();
        chat.messages.push(last);
        save(KEYS.chat, chat);
        await askClaude();
      });
      $("messages").append(retry);
    }
  } else {
    if (panel && !analysis) fillEmotion(panel.querySelector(".emotion"), null);
    const msg = { role: "assistant", content: splitReply(full).text };
    if (analysis) msg.analysis = analysis;
    chat.messages.push(msg);
    save(KEYS.chat, chat);
  }
  sending = false;
  micBtn.disabled = false;
  scrollDown();
}

// ---------- support panel (only when risk is detected) ----------
function openCrisis() {
  $("crisis").classList.remove("hidden");
}
$("crisisClose").addEventListener("click", () => $("crisis").classList.add("hidden"));

// ---------- settings ----------
function renderSettings() {
  $("s-name").value = profile.name || "";
  $("s-key").value = profile.passcode || "";
  $("s-voiceFeedback").checked = profile.voiceFeedback !== false;
  $("s-debugVoice").checked = profile.debugVoice !== false;
  $("settingsMsg").textContent = "";
  fetch("/api/version", { cache: "no-store" })
    .then((r) => r.json())
    .then((v) => ($("versionInfo").textContent = `App version: ${v.commit}`))
    .catch(() => ($("versionInfo").textContent = "App version: offline"));
}
$("saveSettings").addEventListener("click", () => {
  const key = $("s-key").value.trim();
  const changed = key !== (profile.passcode || "");
  profile.passcode = key;
  profile = { ...profile, name: $("s-name").value.trim(), voiceFeedback: $("s-voiceFeedback").checked, debugVoice: $("s-debugVoice").checked };
  save(KEYS.profile, profile);
  if (chat) renderChat();
  $("settingsMsg").textContent = "Saved.";
  // Back to Chit Chat, unless the new passcode is rejected.
  if (!changed) return openChat();
  checkSetup().then((missing) => (missing ? ($("settingsMsg").textContent = "Saved, but the passcode is wrong.") : openChat()));
});
$("clearChat").addEventListener("click", () => {
  if (!confirm("Delete all chats on this computer? This can't be undone.")) return;
  chat = null;
  localStorage.removeItem(KEYS.chat);
  openChat();
});
$("clearAll").addEventListener("click", () => {
  if (!confirm("Erase your conversations, voice history, and name from this computer? You won't be able to get them back.")) return;
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  if (profile.passcode) save(KEYS.profile, { passcode: profile.passcode }); // keep the passcode so the app still works
  location.reload();
});

// ---------- start ----------
openChat(); // Talk is always the first screen
// Only mention setup if the server actually rejects this device.
function checkSetup() {
  return fetch("/api/check", { method: "POST", headers: { "X-App-Passcode": profile.passcode || "" } })
    .then((r) => {
      const missing = r.status === 401;
      return missing;
    })
    .catch(() => false);
}
checkSetup().then((missing) => {
  if (missing) $("messages").append(bubble("note", "Enter the app passcode in Settings once, then come back to Chit Chat."));
});
[KEYS.log, KEYS.plan].forEach((k) => localStorage.removeItem(k)); // removed check-in log and safety plan
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
