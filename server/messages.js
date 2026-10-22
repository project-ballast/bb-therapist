// Shared by the Node server (server.js) and the Cloudflare Worker (worker/index.js).
export const MAX_HISTORY = 40; // messages sent per request, to cap cost

export function cleanMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const msgs = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))
    .slice(-MAX_HISTORY);
  // The app opens with its own greeting; the API needs a user turn first.
  if (msgs.length && msgs[0].role === "assistant") msgs.unshift({ role: "user", content: "(I just checked in on the app.)" });
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return null;
  return msgs;
}

// App version shown in Settings: when this build went live, as YYYYMMdd-hhmmss in Pacific time
// (PST or PDT, whichever applies on that date).
export function versionStamp(date) {
  const d = new Date(date);
  if (isNaN(d)) return "unknown";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles", hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(d).map((x) => [x.type, x.value])
  );
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}

// Turns a Claude API error into a short reason the app can explain.
export function errorReason(err) {
  const s = err?.status;
  if (s === 429 || s === 529) return "busy";
  if (s === 401 || s === 403) return "key";
  if (s === 400 || s === 404) return "model";
  return "failed";
}
