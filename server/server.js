// Calm like a Potato server: serves the app and passes chat messages to Claude.
// It stores nothing and never logs message content.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { BASE_PROMPT, DEBUG_PROMPT, buildContext } from "./prompt.js";

const PORT = Number(process.env.PORT) || 3000;
const PASSCODE = process.env.APP_PASSCODE || "";
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const EFFORT = process.env.CLAUDE_EFFORT || "medium";
const MAX_HISTORY = 40; // messages sent per request, to cap cost
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

if (!process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY is not set; chat will fail.");
if (!PASSCODE) console.warn("APP_PASSCODE is not set; anyone with the URL can use the chat.");

const client = new Anthropic();

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'",
};

function passcodeOk(given) {
  if (!PASSCODE) return true;
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(PASSCODE);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Simple per-IP limit: 60 chat requests per 10 minutes.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 60;
}

// Daily cap on all chat requests, so a leaked link can't run up a big bill.
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT) || 300;
let day = "", dayCount = 0;
function overDailyLimit() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) (day = today), (dayCount = 0);
  return ++dayCount > DAILY_LIMIT;
}

function readBody(req, limit = 200_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function cleanMessages(raw) {
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

async function handleChat(req, res) {
  if (!passcodeOk(req.headers["x-app-passcode"])) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "passcode" }));
  }
  if (rateLimited(req.socket.remoteAddress) || overDailyLimit()) {
    res.writeHead(429, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "rate" }));
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "bad request" }));
  }
  const messages = cleanMessages(body.messages);
  if (!messages) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "bad request" }));
  }

  // Newline-delimited JSON events: {t:"text",v}, {t:"done",stop}, {t:"error",v}
  res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
  const send = (obj) => res.write(JSON.stringify(obj) + "\n");

  const context = buildContext(body.context);
  const system = [{ type: "text", text: BASE_PROMPT, cache_control: { type: "ephemeral" } }];
  if (context) system.push({ type: "text", text: context });
  if (body.debug === true) system.push({ type: "text", text: DEBUG_PROMPT });

  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 4000,
      system,
      messages,
      output_config: { effort: EFFORT },
      // If a safety check declines the request, Anthropic retries it on its recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    req.on("close", () => stream.abort());
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        send({ t: "text", v: event.delta.text });
      }
    }
    const final = await stream.finalMessage();
    send({ t: "done", stop: final.stop_reason });
  } catch (err) {
    // Log the error type only, never message content.
    console.error("chat error:", err?.status || "", err?.name || "error");
    send({ t: "error", v: err?.status === 429 ? "busy" : "failed" });
  }
  res.end();
}

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    // Always revalidate, so a new deploy reaches the phone on the next load (the ETag keeps that cheap).
    const info = await stat(filePath);
    const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const headers = { "Cache-Control": "no-cache", ETag: etag, ...SECURITY_HEADERS };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(filePath)] || "application/octet-stream", ...headers });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

http
  .createServer(async (req, res) => {
    try {
      if (req.method === "POST" && req.url === "/api/chat") return await handleChat(req, res);
      if (req.method === "POST" && req.url === "/api/check") {
        res.writeHead(passcodeOk(req.headers["x-app-passcode"]) ? 204 : 401);
        return res.end();
      }
      if (req.method === "GET" && req.url === "/api/version") {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ commit: (process.env.RENDER_GIT_COMMIT || "local").slice(0, 7) }));
      }
      if (req.method === "GET") return await serveStatic(req, res);
      res.writeHead(405);
      res.end();
    } catch (err) {
      console.error("server error:", err?.name || "error");
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  })
  .listen(PORT, () => console.log(`Calm like a Potato running on http://localhost:${PORT}`));
