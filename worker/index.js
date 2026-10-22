// Calm like a Potato on Cloudflare Workers: the same /api/* as server/server.js.
// Cloudflare serves the files in public/ directly; only /api/* runs this code (see wrangler.jsonc).
// It stores no messages and never logs message content.
import { DurableObject } from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";
import { BASE_PROMPT, DEBUG_PROMPT, buildContext } from "../server/prompt.js";
import { cleanMessages } from "../server/messages.js";

const TEN_MIN = 10 * 60 * 1000;

// One shared counter store for the whole app. A Worker forgets everything between requests and
// runs in many places at once, so the counters live in a single Durable Object, which handles one
// request at a time and saves to disk. It holds only timestamps, counts and hashed IP addresses.
export class Limits extends DurableObject {
  // Wrong passcodes are capped at 20 per 10 minutes for everyone, so the passcode can't be
  // guessed by trying thousands of them. While capped, even the right passcode waits, at most 10 minutes.
  async passcodeOk(given) {
    const passcode = this.env.APP_PASSCODE || "";
    if (!passcode) return true;
    const now = Date.now();
    const fails = ((await this.ctx.storage.get("fails")) || []).filter((t) => now - t < TEN_MIN);
    if (fails.length >= 20) return false;
    const a = new TextEncoder().encode(String(given || ""));
    const b = new TextEncoder().encode(passcode);
    const ok = a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
    if (!ok) fails.push(now);
    await this.ctx.storage.put("fails", fails);
    return ok;
  }

  // 60 chat requests per 10 minutes per address, and DAILY_LIMIT (default 300) per UTC day for everyone.
  async chatAllowed(ipHash) {
    const now = Date.now();
    const key = "ip:" + ipHash;
    const list = ((await this.ctx.storage.get(key)) || []).filter((t) => now - t < TEN_MIN);
    list.push(now);
    await this.ctx.storage.put(key, list);
    // Clear old per-address lists once a day so storage doesn't grow.
    await this.ctx.storage.setAlarm(now + 24 * 60 * 60 * 1000);
    if (list.length > 60) return false;

    const limit = Number(this.env.DAILY_LIMIT) || 300;
    const today = new Date(now).toISOString().slice(0, 10);
    const day = (await this.ctx.storage.get("day")) || { date: "", count: 0 };
    if (day.date !== today) (day.date = today), (day.count = 0);
    day.count++;
    await this.ctx.storage.put("day", day);
    return day.count <= limit;
  }

  async alarm() {
    const now = Date.now();
    const lists = await this.ctx.storage.list({ prefix: "ip:" });
    const stale = [...lists].filter(([, l]) => !l.some((t) => now - t < TEN_MIN)).map(([k]) => k);
    if (stale.length) await this.ctx.storage.delete(stale);
  }
}

const json = (status, obj) =>
  new Response(obj === undefined ? null : JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function hashIp(ip) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip || "unknown"));
  return [...new Uint8Array(buf).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function handleChat(request, env, ctx, limits) {
  if (!(await limits.passcodeOk(request.headers.get("x-app-passcode")))) return json(401, { error: "passcode" });
  if (!(await limits.chatAllowed(await hashIp(request.headers.get("cf-connecting-ip"))))) return json(429, { error: "rate" });

  let body;
  try {
    const text = await request.text();
    if (text.length > 200_000) throw new Error("too large");
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "bad request" });
  }
  const messages = cleanMessages(body?.messages);
  if (!messages) return json(400, { error: "bad request" });

  const context = buildContext(body.context && typeof body.context === "object" ? body.context : {});
  const system = [{ type: "text", text: BASE_PROMPT, cache_control: { type: "ephemeral" } }];
  if (context) system.push({ type: "text", text: context });
  if (body.debug === true) system.push({ type: "text", text: DEBUG_PROMPT });

  // Newline-delimited JSON events: {t:"text",v}, {t:"done",stop}, {t:"error",v}
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (obj) => writer.write(enc.encode(JSON.stringify(obj) + "\n"));

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const stream = client.beta.messages.stream({
    model: env.CLAUDE_MODEL || "claude-opus-5-5",
    max_tokens: 4000,
    system,
    messages,
    output_config: { effort: env.CLAUDE_EFFORT || "medium" },
    // If a safety check declines the request, Anthropic retries it on its recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  const pump = (async () => {
    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          // If the app was closed mid-reply this write fails, and the catch stops paying for the rest.
          await send({ t: "text", v: event.delta.text });
        }
      }
      const final = await stream.finalMessage();
      await send({ t: "done", stop: final.stop_reason });
    } catch (err) {
      stream.abort();
      // Log the error type only, never message content.
      console.error("chat error:", err?.status || "", err?.name || "error");
      await send({ t: "error", v: err?.status === 429 ? "busy" : "failed" }).catch(() => {});
    }
    await writer.close().catch(() => {});
  })();
  ctx.waitUntil(pump);

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      const limits = env.LIMITS.get(env.LIMITS.idFromName("global"));
      if (request.method === "POST" && url.pathname === "/api/chat") {
        if (!env.ANTHROPIC_API_KEY) {
          console.error("ANTHROPIC_API_KEY is not set");
          return json(500, { error: "setup" });
        }
        return await handleChat(request, env, ctx, limits);
      }
      if (request.method === "POST" && url.pathname === "/api/check") {
        return json((await limits.passcodeOk(request.headers.get("x-app-passcode"))) ? 204 : 401);
      }
      if (request.method === "GET" && url.pathname === "/api/version") {
        // COMMIT is set by `npm run deploy`; otherwise show Cloudflare's own version id.
        const commit = env.COMMIT || env.CF_VERSION_METADATA?.id || "unknown";
        return json(200, { commit: commit.slice(0, 7) });
      }
      return json(404, { error: "not found" });
    } catch (err) {
      console.error("server error:", err?.name || "error");
      return json(500, { error: "server" });
    }
  },
};
