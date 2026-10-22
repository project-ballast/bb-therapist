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
