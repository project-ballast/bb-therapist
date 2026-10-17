import { detectRisk, stripToken, CRISIS_TOKEN } from "./crisis.js";
import { VoiceSession, voiceProblem, baseline, describeVoice } from "./voice.js";

// ---------- storage (this phone only) ----------
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
  `${profile.name ? `Hi ${profile.name}. ` : "Hi. "}I'm here. Take your time. What's going on right now?`;

let profile = load(KEYS.profile, { name: "", passcode: "" });
let plan = load(KEYS.plan, { helpers: [], pros: [] });
let chat = load(KEYS.chat, null); // {started, messages:[{role,content,voice?}]}
let voiceHistory = load(KEYS.voice, []); // numbers only, newest first: {at, wordsPerMinute, ...}
let sending = false;

// ---------- navigation ----------
function show(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(`view-${view}`).classList.remove("hidden");
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === view || (view === "plan" && b.dataset.view === "settings")));
  if (view === "plan") renderPlan();
  if (view === "settings") renderSettings();
  window.scrollTo(0, view === "chat" ? document.body.scrollHeight : 0);
}
document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => (b.dataset.view === "chat" ? openChat() : show(b.dataset.view)))
);
const recent = (iso) => Date.now() - new Date(iso).getTime() < 6 * 3600 * 1000;

// ---------- conversation start ----------
// Talk resumes a conversation from the last 6 hours, otherwise starts a new one.
function openChat() {
  if (!chat?.messages?.length || !recent(chat.started)) newChat();
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
function renderChat() {
  const box = $("messages");
  box.replaceChildren();
  const msgs = chat?.messages || [];
  msgs.forEach((m, i) => {
    if (m.role === "assistant" && i > 0 && debugOn()) box.append(debugPanel(msgs[i - 1], m.analysis));
    box.append(bubble(m.role, m.role === "assistant" ? stripToken(m.content) : m.content));
  });
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
// Splits a streamed reply into the hidden analysis line (debug mode) and the text she sees.
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
    box.append(el("h4", null, "Measured on the phone (real numbers)"));
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
    warningSigns: plan.warningSigns || undefined,
    copingSkills: plan.copingSkills || undefined,
    reasonsToLive: plan.reasonsToLive || undefined,
    spendingLimit: plan.spendingLimit || undefined,
    voice: voiceContext(),
    localTime: new Date().toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" }),
  };
}

function voiceContext() {
  const last = chat.messages[chat.messages.length - 1];
  if (!last?.voice) return undefined;
  const history = voiceHistory.filter((h) => h.at !== last.voice.at); // her usual, not counting this message
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
  unsupported: "This browser can't turn speech into words. Use Chrome, Edge, or Safari. Firefox doesn't support it.",
  network: "This browser couldn't reach its speech-to-text service. Brave and Opera block it; use Chrome, Edge, or Safari, and check the internet connection.",
  "not-allowed": isDesktop
    ? "The microphone is blocked. Click the icon left of the web address, allow Microphone, then try again. On Windows, also check Settings > Privacy > Microphone."
    : "The microphone is blocked. Allow it for this app in your phone's settings, then tap the mic again.",
  "audio-capture": "No microphone found. Plug one in, or check your computer's sound settings.",
  "language-not-supported": "Speech-to-text doesn't support this browser's language setting.",
};
VOICE_HELP["service-not-allowed"] = VOICE_HELP["not-allowed"];
const problem = voiceProblem();
if (problem) {
  micBtn.classList.add("hidden");
  $("micHint").textContent = `${VOICE_HELP[problem]} Your safety plan and crisis numbers are in Settings.`;
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
    voiceHistory.unshift(voice);
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
  if (detectRisk(text)) openCrisis(); // before any network call
  const msg = { role: "user", content: text };
  if (voice) msg.voice = voice;
  chat.messages.push(msg);
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
      body: JSON.stringify({ messages: chat.messages, context: context(), debug: showDebug }),
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
  if (failed) {
    reply.remove();
    panel?.remove();
    const msgs = {
      passcode: "The app passcode is missing or wrong. Add it in Settings.",
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

// ---------- crisis panel ----------
function openCrisis() {
  const people = $("crisisPeople");
  people.replaceChildren();
  const helpers = (plan.helpers || []).filter((h) => h.phone);
  helpers.slice(0, 3).forEach((h) => {
    const msg = encodeURIComponent("I'm having a really hard time. Can you call me?");
    const call = el("a", "big person", `Call ${h.name || h.phone}`);
    call.href = `tel:${h.phone.replace(/[^\d+]/g, "")}`;
    const text = el("a", "big person", `Text ${h.name || h.phone}: "Can you call me?"`);
    text.href = `sms:${h.phone.replace(/[^\d+]/g, "")}?&body=${msg}`;
    people.append(call, text);
  });
  (plan.pros || []).filter((p) => p.phone).slice(0, 2).forEach((p) => {
    const a = el("a", "big person", `Call ${p.name || "my care team"}`);
    a.href = `tel:${p.phone.replace(/[^\d+]/g, "")}`;
    people.append(a);
  });
  const planBox = $("crisisPlan");
  planBox.replaceChildren();
  const add = (title, body) => {
    if (!body) return;
    planBox.append(el("h3", null, title), el("p", null, body));
  };
  add("Things I can do right now", plan.copingSkills);
  add("Making my space safe", plan.safeEnvironment);
  add("My reasons for living", plan.reasonsToLive);
  if (!helpers.length && !plan.copingSkills) planBox.append(el("p", "muted", "Tip: add your people in Settings → My safety plan and emergency contacts, so they show up here."));
  $("crisis").classList.remove("hidden");
}
$("crisisClose").addEventListener("click", () => $("crisis").classList.add("hidden"));

// ---------- safety plan ----------
const PLAN_FIELDS = ["warningSigns", "copingSkills", "places", "safeEnvironment", "reasonsToLive", "spendingLimit"];
function contactRows(boxId, list) {
  const box = $(boxId);
  box.replaceChildren();
  list.forEach((c, i) => {
    const row = el("div", "row");
    const name = el("input");
    name.type = "text";
    name.placeholder = "Name";
    name.value = c.name || "";
    name.addEventListener("input", () => (c.name = name.value));
    const phone = el("input");
    phone.type = "tel";
    phone.placeholder = "Phone";
    phone.value = c.phone || "";
    phone.addEventListener("input", () => (c.phone = phone.value));
    const del = el("button", null, "✕");
    del.type = "button";
    del.setAttribute("aria-label", "Remove");
    del.addEventListener("click", () => {
      list.splice(i, 1);
      contactRows(boxId, list);
    });
    row.append(name, phone, del);
    box.append(row);
  });
}
function renderPlan() {
  PLAN_FIELDS.forEach((f) => ($(`p-${f}`).value = plan[f] || ""));
  plan.helpers ||= [];
  plan.pros ||= [];
  if (!plan.helpers.length) plan.helpers.push({ name: "", phone: "" });
  if (!plan.pros.length) plan.pros.push({ name: "", phone: "" });
  contactRows("helpers", plan.helpers);
  contactRows("pros", plan.pros);
  $("planSaved").classList.add("hidden");
}
$("addHelper").addEventListener("click", () => {
  plan.helpers.push({ name: "", phone: "" });
  contactRows("helpers", plan.helpers);
});
$("addPro").addEventListener("click", () => {
  plan.pros.push({ name: "", phone: "" });
  contactRows("pros", plan.pros);
});
$("planForm").addEventListener("submit", (e) => {
  e.preventDefault();
  PLAN_FIELDS.forEach((f) => (plan[f] = $(`p-${f}`).value.trim()));
  plan.helpers = plan.helpers.filter((c) => c.name || c.phone);
  plan.pros = plan.pros.filter((c) => c.name || c.phone);
  save(KEYS.plan, plan);
  renderPlan();
  $("planSaved").classList.remove("hidden");
});

// ---------- settings ----------
function renderSettings() {
  $("s-name").value = profile.name || "";
  $("s-passcode").value = profile.passcode || "";
  $("s-voiceFeedback").checked = profile.voiceFeedback !== false;
  $("s-debugVoice").checked = profile.debugVoice !== false;
  $("settingsMsg").textContent = "";
  fetch("/api/version", { cache: "no-store" })
    .then((r) => r.json())
    .then((v) => ($("versionInfo").textContent = `App version: ${v.commit}`))
    .catch(() => ($("versionInfo").textContent = "App version: offline"));
}
$("saveSettings").addEventListener("click", async () => {
  profile = { name: $("s-name").value.trim(), passcode: $("s-passcode").value, voiceFeedback: $("s-voiceFeedback").checked, debugVoice: $("s-debugVoice").checked };
  save(KEYS.profile, profile);
  if (chat) renderChat();
  try {
    const r = await fetch("/api/check", { method: "POST", headers: { "X-App-Passcode": profile.passcode } });
    $("settingsMsg").textContent = r.ok ? "Saved. Passcode works." : "Saved, but the passcode is wrong.";
  } catch {
    $("settingsMsg").textContent = "Saved. Couldn't check the passcode (offline).";
  }
});
$("openPlan").addEventListener("click", () => show("plan"));
$("planBack").addEventListener("click", () => show("settings"));
$("clearChat").addEventListener("click", () => {
  if (!confirm("Delete all chats on this phone? This can't be undone.")) return;
  chat = null;
  localStorage.removeItem(KEYS.chat);
  openChat();
});
$("clearAll").addEventListener("click", () => {
  if (!confirm("Delete your chats, safety plan, voice measurements, and settings from this phone? This can't be undone.")) return;
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  location.reload();
});

// ---------- start ----------
if (profile.passcode) openChat();
else show("settings");
localStorage.removeItem(KEYS.log); // old check-in log from the removed mood page
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
