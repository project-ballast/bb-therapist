import { detectRisk, stripToken, CRISIS_TOKEN } from "./crisis.js";
import { SKILLS } from "./skills.js";
import { VoiceSession, voiceProblem, baseline } from "./voice.js";

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

const STATE_LABELS = { low: "Low", high: "High / racing", mixed: "Mixed", anxious: "Anxious", unsure: "Not sure" };
const OPENERS = {
  low: "Thank you for checking in. That took effort. I'm here, and we can go as slowly as you need. What's it like right now?",
  high: "Thanks for checking in. Let's slow things down together for a minute. What's going on right now?",
  mixed: "Thanks for reaching out. Mixed feelings like this can be really hard. Before anything else: are you safe right now?",
  anxious: "Thanks for checking in. Let's take one slow breath together first: in for 4, out for 6. When you're ready, tell me what's on your mind.",
  unsure: "Thanks for checking in. Let's figure it out together. How has your sleep, energy, and mood been over the last few days?",
};

let profile = load(KEYS.profile, { name: "", passcode: "" });
let plan = load(KEYS.plan, { helpers: [], pros: [] });
let log = load(KEYS.log, []);
let chat = load(KEYS.chat, null); // {state, mood, sleep, started, messages:[{role,content,voice?}]}
let voiceHistory = load(KEYS.voice, []); // numbers only, newest first: {at, mood, state, wordsPerMinute, ...}
let sending = false;

// ---------- navigation ----------
function show(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(`view-${view}`).classList.remove("hidden");
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === view || (view === "chat" && b.dataset.view === "checkin")));
  if (view === "log") renderLog();
  if (view === "plan") renderPlan();
  if (view === "settings") renderSettings();
  if (view === "checkin") renderCheckin();
  window.scrollTo(0, view === "chat" ? document.body.scrollHeight : 0);
}
document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => show(b.dataset.view === "checkin" && chat?.messages?.length && recent(chat.started) ? "chat" : b.dataset.view))
);
const recent = (iso) => Date.now() - new Date(iso).getTime() < 6 * 3600 * 1000;

// ---------- check-in ----------
function renderCheckin() {
  $("greeting").textContent = profile.name ? `Hi ${profile.name}. How are you right now?` : "How are you right now?";
  $("resumeBtn").classList.toggle("hidden", !chat?.messages?.length);
}
$("mood").addEventListener("input", (e) => ($("moodVal").textContent = e.target.value > 0 ? `+${e.target.value}` : e.target.value));
document.querySelectorAll(".state").forEach((b) =>
  b.addEventListener("click", () => {
    const state = b.dataset.state;
    const mood = Number($("mood").value);
    const sleepRaw = $("sleep").value;
    const sleep = sleepRaw === "" ? null : Math.max(0, Math.min(24, Number(sleepRaw)));
    const started = new Date().toISOString();
    log.unshift({ at: started, state, mood, sleep });
    log = log.slice(0, 1000);
    save(KEYS.log, log);
    chat = { state, mood, sleep, started, messages: [{ role: "assistant", content: OPENERS[state] }] };
    save(KEYS.chat, chat);
    $("sleep").value = "";
    renderChat();
    show("chat");
  })
);
$("resumeBtn").addEventListener("click", () => {
  renderChat();
  show("chat");
});
$("newChatBtn").addEventListener("click", () => show("checkin"));

// ---------- chat ----------
function renderChat() {
  const box = $("messages");
  box.replaceChildren();
  for (const m of chat?.messages || []) box.append(bubble(m.role, m.role === "assistant" ? stripToken(m.content) : m.content));
  const chips = $("chatSkills");
  chips.replaceChildren();
  SKILLS.filter((s) => s.for.includes(chat?.state === "unsure" ? "anxious" : chat?.state))
    .slice(0, 5)
    .forEach((s) => {
      const c = el("button", "chip", s.name.split(":")[0]);
      c.type = "button";
      c.addEventListener("click", () => openSkill(s.id));
      chips.append(c);
    });
}
function bubble(role, text) {
  return el("div", `msg ${role}`, text);
}
function scrollDown() {
  window.scrollTo(0, document.body.scrollHeight);
}

function context() {
  const recentSleep = log.filter((l) => typeof l.sleep === "number").slice(0, 5).map((l) => l.sleep);
  return {
    name: profile.name || undefined,
    state: STATE_LABELS[chat.state],
    mood: chat.mood,
    sleep: typeof chat.sleep === "number" ? chat.sleep : undefined,
    recentSleep,
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
  $("micHint").textContent = `${VOICE_HELP[problem]} Skills and your safety plan still work.`;
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
    voiceHistory.unshift({ ...voice, mood: chat.mood, state: chat.state });
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
  const reply = bubble("assistant typing", "...");
  $("messages").append(reply);
  scrollDown();
  let full = "";
  let failed = null;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-App-Passcode": profile.passcode || "" },
      body: JSON.stringify({ messages: chat.messages, context: context() }),
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
            reply.classList.remove("typing");
            reply.textContent = stripToken(full);
            scrollDown();
          } else if (ev.t === "done") stop = ev.stop;
          else if (ev.t === "error") failed = ev.v;
        }
      }
      if (stop === "refusal") failed = "refusal";
      else if (!failed && !full.trim()) failed = "failed";
    }
  } catch {
    failed = "offline";
  }

  if (full.includes(CRISIS_TOKEN)) openCrisis();
  if (failed) {
    reply.remove();
    const msgs = {
      passcode: "The app passcode is missing or wrong. Add it in Settings.",
      busy: "The app is busy. Try again in a minute.",
      offline: "No connection right now. Your Skills tab and safety plan still work offline.",
      refusal: "I couldn't answer that one. If you're struggling, call or text 988 to reach a person.",
      failed: "Something went wrong getting a reply. Your Skills tab and safety plan still work.",
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
    chat.messages.push({ role: "assistant", content: full });
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
  if (!helpers.length && !plan.copingSkills) planBox.append(el("p", "muted", "Tip: fill in your safety plan (Plan tab) so your people and steps show up here."));
  $("crisis").classList.remove("hidden");
}
$("crisisClose").addEventListener("click", () => $("crisis").classList.add("hidden"));

// ---------- skills ----------
let skillFilter = "all";
function renderSkills() {
  const filter = $("skillFilter");
  filter.replaceChildren();
  [["all", "All"], ["low", "Low"], ["high", "High"], ["mixed", "Mixed"], ["anxious", "Anxious"]].forEach(([k, label]) => {
    const c = el("button", `chip${skillFilter === k ? " on" : ""}`, label);
    c.type = "button";
    c.addEventListener("click", () => {
      skillFilter = k;
      renderSkills();
    });
    filter.append(c);
  });
  const list = $("skillList");
  list.replaceChildren();
  SKILLS.filter((s) => skillFilter === "all" || s.for.includes(skillFilter)).forEach((s) => {
    const d = el("details", "skill");
    d.id = `skill-${s.id}`;
    const sum = el("summary", null, s.name);
    sum.append(el("small", null, `${s.from} · ${s.when}`));
    const body = el("div", "body");
    const ol = el("ol");
    s.steps.forEach((st) => ol.append(el("li", null, st)));
    body.append(ol);
    if (s.note) body.append(el("p", "muted", s.note));
    d.append(sum, body);
    list.append(d);
  });
}
function openSkill(id) {
  skillFilter = "all";
  renderSkills();
  show("skills");
  const d = $(`skill-${id}`);
  if (d) {
    d.open = true;
    d.scrollIntoView({ block: "start" });
  }
}

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

// ---------- mood log ----------
function renderLog() {
  const days = log.filter((l) => Date.now() - new Date(l.at).getTime() < 14 * 86400 * 1000);
  const chart = $("logChart");
  chart.replaceChildren(el("div", "mid"));
  if (!days.length) chart.append(el("span", "empty", "Check-ins from the last 14 days show here."));
  [...days].reverse().forEach((l) => {
    const wrap = el("div", "bar-wrap");
    const bar = el("div", `bar ${l.mood >= 0 ? "pos" : "neg"}`);
    const h = Math.max(4, (Math.abs(l.mood) / 5) * 50);
    bar.style.height = `${h}%`;
    if (l.mood >= 0) bar.style.bottom = "50%";
    else bar.style.top = "50%";
    bar.title = `${new Date(l.at).toLocaleDateString()} mood ${l.mood}`;
    wrap.append(bar);
    chart.append(wrap);
  });
  const sleeps = log.filter((l) => typeof l.sleep === "number").slice(0, 2);
  const warn = $("sleepWarn");
  if (sleeps.length === 2 && sleeps.every((l) => l.sleep < 6)) {
    warn.textContent = `Your last 2 sleep entries were under 6 hours (${sleeps.map((l) => l.sleep).join(" and ")}). Short sleep can be an early sign of a high. Consider telling your prescriber.`;
    warn.classList.remove("hidden");
  } else warn.classList.add("hidden");
  const list = $("logList");
  list.replaceChildren();
  log.slice(0, 50).forEach((l) => {
    const li = el("li");
    li.append(
      el("span", null, new Date(l.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })),
      el("span", null, `${STATE_LABELS[l.state]} · mood ${l.mood > 0 ? "+" : ""}${l.mood}${typeof l.sleep === "number" ? ` · ${l.sleep}h sleep` : ""}`)
    );
    list.append(li);
  });
}
$("exportBtn").addEventListener("click", () => {
  const rows = [["date_time", "state", "mood_-5_to_5", "sleep_hours"], ...log.map((l) => [l.at, STATE_LABELS[l.state], l.mood, l.sleep ?? ""])];
  const csv = rows.map((r) => r.join(",")).join("\n");
  const a = el("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `mood-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- settings ----------
function renderSettings() {
  $("s-name").value = profile.name || "";
  $("s-passcode").value = profile.passcode || "";
  $("s-voiceFeedback").checked = profile.voiceFeedback !== false;
  $("settingsMsg").textContent = "";
}
$("saveSettings").addEventListener("click", async () => {
  profile = { name: $("s-name").value.trim(), passcode: $("s-passcode").value, voiceFeedback: $("s-voiceFeedback").checked };
  save(KEYS.profile, profile);
  try {
    const r = await fetch("/api/check", { method: "POST", headers: { "X-App-Passcode": profile.passcode } });
    $("settingsMsg").textContent = r.ok ? "Saved. Passcode works." : "Saved, but the passcode is wrong.";
  } catch {
    $("settingsMsg").textContent = "Saved. Couldn't check the passcode (offline).";
  }
});
$("clearChat").addEventListener("click", () => {
  if (!confirm("Delete all chats on this phone? This can't be undone.")) return;
  chat = null;
  localStorage.removeItem(KEYS.chat);
  show("checkin");
});
$("clearAll").addEventListener("click", () => {
  if (!confirm("Delete your chats, safety plan, mood log, voice measurements, and settings from this phone? This can't be undone.")) return;
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  location.reload();
});

// ---------- start ----------
renderSkills();
if (chat?.messages?.length && recent(chat.started)) {
  renderChat();
  show("chat");
} else show(profile.passcode ? "checkin" : "settings");
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
