// Full-stack Cloudflare Worker: public reading, Turnstile-protected text posts and reports.
// Submission endpoints fail closed until Turnstile secrets and a rate limiter are configured.
const cacheHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const SITE_HOST = "votethemofftheroad.com";
const SITE_ORIGIN = "https://" + SITE_HOST;
const idPattern = /^[a-zA-Z0-9_-]{6,80}$/;
const reportReasons = new Set(["harassment", "private_info", "false_claim", "copyright", "removal_request", "other"]);

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { ...cacheHeaders, ...headers } });
}

function writesReady(env) {
  return Boolean(env.DB && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && env.WRITE_RATE_LIMITER);
}

const summaryColumns = `
  i.id, i.state_code, i.location_label, i.title, i.description, i.created_at,
  COUNT(CASE WHEN v.choice = 'off' THEN 1 END) AS off_votes,
  COUNT(CASE WHEN v.choice = 'pass' THEN 1 END) AS pass_votes
`;
const summaryJoin = `
  FROM incidents i
  LEFT JOIN votes v ON v.incident_id = i.id
`;
const summaryGroup = `
  GROUP BY i.id, i.state_code, i.location_label, i.title, i.description, i.created_at
`;

async function listIncidents(url, env) {
  const state = (url.searchParams.get("state") || "NH").toUpperCase();
  const sort = url.searchParams.get("sort") || "newest";
  if (!/^[A-Z]{2}$/.test(state)) return json({ error: "Invalid state" }, 400);
  if (!["newest", "top"].includes(sort)) return json({ error: "Invalid sort" }, 400);
  const order = sort === "top" ? "off_votes DESC, i.created_at DESC" : "i.created_at DESC";
  const result = await env.DB.prepare(`
    SELECT ${summaryColumns} ${summaryJoin}
    WHERE i.state_code = ? AND i.status = 'published'
    ${summaryGroup} ORDER BY ${order} LIMIT 20
  `).bind(state).all();
  return json({ state, sort, incidents: result.results || [] });
}

async function getIncident(id, env) {
  if (!idPattern.test(id)) return json({ error: "Not found" }, 404);
  const row = await env.DB.prepare(`
    SELECT ${summaryColumns} ${summaryJoin}
    WHERE i.id = ? AND i.status = 'published'
    ${summaryGroup} LIMIT 1
  `).bind(id).first();
  return row ? json({ incident: row }) : json({ error: "Not found" }, 404);
}

async function parseBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    return { error: "Expected JSON", status: 415 };
  }
  const sizeHeader = Number(request.headers.get("content-length") || "0");
  if (sizeHeader > 8192) return { error: "Request too large", status: 413 };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 8192) return { error: "Request too large", status: 413 };
  let value;
  try { value = JSON.parse(raw); } catch { return { error: "Invalid JSON", status: 400 }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Expected a JSON object", status: 400 };
  }
  return { value };
}

async function validateTurnstile(token, action, request, env) {
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return false;
  const verdict = await response.json();
  return verdict.success === true && verdict.hostname === SITE_HOST && verdict.action === action;
}

async function prepareWrite(request, env, action) {
  if (!writesReady(env)) return { response: json({ error: "Submissions are not open yet" }, 503) };
  if (request.headers.get("origin") !== SITE_ORIGIN) {
    return { response: json({ error: "Request origin not allowed" }, 403) };
  }
  // Approximate, Cloudflare-location-local throttle, with independent keys for posting/reporting.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const allowed = await env.WRITE_RATE_LIMITER.limit({ key: action + ":" + ip });
  if (!allowed.success) return { response: json({ error: "Too many attempts. Please try again shortly." }, 429) };
  const parsed = await parseBody(request);
  if (parsed.error) return { response: json({ error: parsed.error }, parsed.status) };
  const body = parsed.value;
  if (!(await validateTurnstile(body.turnstile_token, action, request, env))) {
    return { response: json({ error: "Verification expired or failed. Please try again." }, 400) };
  }
  return { body };
}

async function createIncident(request, env) {
  const prepared = await prepareWrite(request, env, "submit");
  if (prepared.response) return prepared.response;
  const body = prepared.body;
  if (typeof body.title !== "string" || typeof body.description !== "string") {
    return json({ error: "Title and description are required" }, 400);
  }
  const title = body.title.trim();
  const description = body.description.trim();
  const location = typeof body.location_label === "string" ? body.location_label.trim() : "";
  if (title.length < 5 || title.length > 160 || description.length < 20 || description.length > 3000 || location.length > 100) {
    return json({ error: "Title must be 5–160 characters, story 20–3000, location at most 100." }, 400);
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO incidents (id, state_code, location_label, title, description, status)
    VALUES (?, 'NH', ?, ?, ?, 'published')
  `).bind(id, location || null, title, description).run();
  return json({ ok: true, id, message: "Your driving story is on the board." }, 201);
}

async function createReport(id, request, env) {
  if (!idPattern.test(id)) return json({ error: "Not found" }, 404);
  const prepared = await prepareWrite(request, env, "report");
  if (prepared.response) return prepared.response;
  const { reason, details, contact_email } = prepared.body;
  if (typeof reason !== "string" || !reportReasons.has(reason)) return json({ error: "Choose a report reason" }, 400);
  const note = typeof details === "string" ? details.trim() : "";
  const email = typeof contact_email === "string" ? contact_email.trim() : "";
  if (note.length > 3000 || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return json({ error: "Invalid report details or contact email" }, 400);
  }
  const incident = await env.DB.prepare("SELECT 1 FROM incidents WHERE id = ? AND status = 'published'").bind(id).first();
  if (!incident) return json({ error: "Not found" }, 404);
  await env.DB.prepare(`
    INSERT INTO reports (id, incident_id, reason, details, contact_email)
    VALUES (?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), id, reason, note, email || null).run();
  return json({ ok: true, message: "Report received." }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (pathname === "/api/config" && request.method === "GET") {
        const enabled = writesReady(env);
        return json({ submissions_enabled: enabled, reports_enabled: enabled,
          turnstile_site_key: enabled ? env.TURNSTILE_SITE_KEY : null });
      }
      if (pathname === "/api/health" && request.method === "GET") {
        const result = await env.DB.prepare("SELECT 1 AS healthy").first();
        if (result?.healthy !== 1) throw new Error("D1 probe failed");
        return json({ ok: true, database: "connected" });
      }
      if (pathname === "/api/incidents") {
        if (request.method === "GET") return await listIncidents(url, env);
        if (request.method === "POST") return await createIncident(request, env);
        return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
      }
      const reportMatch = /^\/api\/incidents\/([a-zA-Z0-9_-]{6,80})\/reports$/.exec(pathname);
      if (reportMatch) {
        if (request.method === "POST") return await createReport(reportMatch[1], request, env);
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      }
      if (pathname.startsWith("/api/incidents/")) {
        if (request.method === "GET") return await getIncident(pathname.slice("/api/incidents/".length), env);
        return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("API request failed", error);
      return json({ error: "Service temporarily unavailable" }, 503);
    }
  },
};
