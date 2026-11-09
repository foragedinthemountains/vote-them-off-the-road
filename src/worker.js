// Full-stack Cloudflare Worker: public reading, Turnstile-protected text posts and reports.
// Submission endpoints fail closed until Turnstile secrets and a rate limiter are configured.
const cacheHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const SITE_HOST = "votethemofftheroad.com";
const SITE_ORIGIN = "https://" + SITE_HOST;
const idPattern = /^[a-zA-Z0-9_-]{6,80}$/;
const reportReasons = new Set(["harassment", "private_info", "false_claim", "copyright", "removal_request", "other"]);
const maxPhotos = 5;
const maxPhotoBytes = 5 * 1024 * 1024;
const maxRequestBytes = 32 * 1024 * 1024;
const photoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
function photosReady(env) { return writesReady(env) && Boolean(env.PHOTOS); }
function imageSignatureIsValid(bytes, type) {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  if (type === "image/webp") return [82,73,70,70].every((v,i) => bytes[i] === v) && [87,69,66,80].every((v,i) => bytes[i+8] === v);
  return false;
}
async function attachImages(incidents, env) {
  if (!incidents.length) return incidents;
  const placeholders = incidents.map(() => "?").join(",");
  const ids = incidents.map(row => row.id);
  const result = await env.DB.prepare(
    "SELECT id, incident_id, display_order FROM incident_media WHERE media_type = 'image' AND incident_id IN (" + placeholders + ") ORDER BY display_order ASC"
  ).bind(...ids).all();
  const byIncident = new Map(ids.map(id => [id, []]));
  for (const m of result.results || []) {
    byIncident.get(m.incident_id)?.push({ id: m.id, url: "/media/" + encodeURIComponent(m.id) });
  }
  return incidents.map(i => ({ ...i, photos: byIncident.get(i.id) || [] }));
}
async function serveImage(id, env) {
  if (!env.PHOTOS || !idPattern.test(id)) return new Response("Not found", { status: 404 });
  const media = await env.DB.prepare(
    "SELECT m.storage_key FROM incident_media m JOIN incidents i ON i.id = m.incident_id WHERE m.id = ? AND m.media_type = 'image' AND m.storage_provider = 'r2' AND i.status = 'published'"
  ).bind(id).first();
  if (!media) return new Response("Not found", { status: 404 });
  const object = await env.PHOTOS.get(media.storage_key);
  if (!object?.body) return new Response("Not found", { status: 404 });
  const type = object.httpMetadata?.contentType;
  if (!photoTypes.has(type)) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: {
    "Content-Type": type, "Content-Length": String(object.size),
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin"
  } });
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { ...cacheHeaders, ...headers } });
}

function writesReady(env) {
  return Boolean(env.DB && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && env.WRITE_RATE_LIMITER);
}

// Anonymous browser voting. No IP address or raw voter cookie is stored in D1.
// Clearing cookies permits another vote; this is a lightweight launch safeguard, not verified identity.
const voterCookieName = "vtor_voter";
const voterIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function readVoterId(request) {
  const cookie = (request.headers.get("Cookie") || "").split(";")
    .map(value => value.trim()).find(value => value.startsWith(voterCookieName + "="));
  if (!cookie) return null;
  const id = cookie.slice(voterCookieName.length + 1);
  return voterIdPattern.test(id) ? id.toLowerCase() : null;
}
function withVoterCookie(request, response) {
  if (readVoterId(request) || !response.ok) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", voterCookieName + "=" + crypto.randomUUID() +
    "; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax");
  return new Response(response.body, {
    status: response.status, statusText: response.statusText, headers
  });
}
async function voterHash(request) {
  const id = readVoterId(request);
  if (!id) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function attachMyVotes(rows, request, env) {
  const hash = await voterHash(request);
  if (!rows.length || !hash) return rows.map(row => ({ ...row, my_vote: null }));
  const placeholders = rows.map(() => "?").join(",");
  const result = await env.DB.prepare(
    "SELECT incident_id, choice FROM votes WHERE voter_key_hash = ? AND incident_id IN (" +
      placeholders + ")"
  ).bind(hash, ...rows.map(row => row.id)).all();
  const choices = new Map((result.results || []).map(row => [row.incident_id, row.choice]));
  return rows.map(row => ({ ...row, my_vote: choices.get(row.id) || null }));
}
async function voteIncident(id, request, env) {
  if (!idPattern.test(id)) return json({ error: "Not found" }, 404);
  if (!env.DB || !env.VOTE_RATE_LIMITER) return json({ error: "Voting is not available yet" }, 503);
  if (request.headers.get("Origin") !== SITE_ORIGIN) {
    return json({ error: "Request origin not allowed" }, 403);
  }
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && fetchSite !== "same-origin") {
    return json({ error: "Request not allowed" }, 403);
  }
  const hash = await voterHash(request);
  if (!hash) return json({ error: "Refresh the incident feed to initialize voting" }, 428);
  const parsed = await parseBody(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const choice = parsed.value.choice;
  if (choice !== "off" && choice !== "pass") return json({ error: "Invalid vote choice" }, 400);
  // Per-network throttling deters rapid automated voting; Cloudflare limits are approximate.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const allowed = await env.VOTE_RATE_LIMITER.limit({ key: "ip:" + ip });
  if (!allowed.success) {
    return json({ error: "Too many votes right now. Try again shortly." }, 429);
  }
  await env.DB.prepare(`
    INSERT INTO votes (incident_id, voter_key_hash, choice)
    SELECT ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM incidents WHERE id = ? AND status = 'published'
    )
    ON CONFLICT (incident_id, voter_key_hash)
    DO UPDATE SET choice = excluded.choice
  `).bind(id, hash, choice, id).run();
  // If an incident was hidden or removed, never return its vote totals.
  const publicIncident = await env.DB.prepare(
    "SELECT 1 FROM incidents WHERE id = ? AND status = 'published'"
  ).bind(id).first();
  if (!publicIncident) return json({ error: "Not found" }, 404);
  const counts = await env.DB.prepare(`
    SELECT
      COUNT(CASE WHEN choice = 'off' THEN 1 END) AS off_votes,
      COUNT(CASE WHEN choice = 'pass' THEN 1 END) AS pass_votes
    FROM votes WHERE incident_id = ?
  `).bind(id).first();
  return json({
    ok: true, id, my_vote: choice,
    off_votes: Number(counts?.off_votes || 0),
    pass_votes: Number(counts?.pass_votes || 0)
  });
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

async function listIncidents(url, env, request) {
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
  return json({
    state, sort,
    incidents: await attachMyVotes(await attachImages(result.results || [], env), request, env)
  });
}

async function getIncident(id, env, request) {
  if (!idPattern.test(id)) return json({ error: "Not found" }, 404);
  const row = await env.DB.prepare(`
    SELECT ${summaryColumns} ${summaryJoin}
    WHERE i.id = ? AND i.status = 'published'
    ${summaryGroup} LIMIT 1
  `).bind(id).first();
  return row
    ? json({ incident: (await attachMyVotes(await attachImages([row], env), request, env))[0] })
    : json({ error: "Not found" }, 404);
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
  let body;
  const type = request.headers.get("content-type") || "";
  if (/^multipart\/form-data(?:;|$)/i.test(type)) {
    if (Number(request.headers.get("content-length") || 0) > maxRequestBytes) {
      return { response: json({ error: "Upload too large" }, 413) };
    }
    const data = await request.formData();
    const photos = data.getAll("photos");
    if (photos.length > maxPhotos || photos.some(f => typeof f?.arrayBuffer !== "function")) {
      return { response: json({ error: "Choose up to five photos" }, 400) };
    }
    if (photos.reduce((sum,f) => sum + f.size, 0) > 25 * 1024 * 1024) {
      return { response: json({ error: "Total image upload too large" }, 413) };
    }
    body = {
      title: data.get("title"), location_label: data.get("location_label"),
      description: data.get("description"), turnstile_token: data.get("turnstile_token"), photos
    };
  } else {
    const parsed = await parseBody(request);
    if (parsed.error) return { response: json({ error: parsed.error }, parsed.status) };
    body = parsed.value;
  }
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
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (photos.length && !photosReady(env)) return json({ error: "Photo uploads are being set up. Submit a text story for now." }, 503);
  if (photos.length > maxPhotos) return json({ error: "Maximum five photos" }, 400);
  for (const file of photos) {
    if (!photoTypes.has(file.type) || file.size < 100 || file.size > maxPhotoBytes) {
      return json({ error: "Photos must be JPG, PNG, or WebP under 5 MB each." }, 400);
    }
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (!imageSignatureIsValid(head, file.type)) return json({ error: "Invalid photo file" }, 400);
  }
  const id = crypto.randomUUID();
  // Keep the incident hidden until every photo and database reference is safely stored.
  const initialStatus = photos.length ? "hidden" : "published";
  await env.DB.prepare(`
    INSERT INTO incidents (id, state_code, location_label, title, description, status)
    VALUES (?, 'NH', ?, ?, ?, ?)
  `).bind(id, location || null, title, description, initialStatus).run();
  if (!photos.length) return json({ ok: true, id, message: "Your driving story is on the board." }, 201);
  const uploadedKeys = [];
  try {
    for (let index = 0; index < photos.length; index++) {
      const file = photos[index];
      const imageId = crypto.randomUUID();
      const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
      const key = "incidents/" + id + "/" + imageId + "." + extension;
      const stored = await env.PHOTOS.put(key, file, {
        httpMetadata: { contentType: file.type, contentDisposition: "inline" }
      });
      if (!stored) throw new Error("Image storage refused file");
      uploadedKeys.push(key);
      await env.DB.prepare(`
        INSERT INTO incident_media (id, incident_id, media_type, storage_provider, storage_key, display_order)
        VALUES (?, ?, 'image', 'r2', ?, ?)
      `).bind(imageId, id, key, index).run();
    }
    await env.DB.prepare("UPDATE incidents SET status = 'published', updated_at = unixepoch() WHERE id = ?")
      .bind(id).run();
    return json({ ok: true, id, photos: photos.length, message: "Your photo story is on the board." }, 201);
  } catch (error) {
    console.error("Photo submission failed", error);
    // Best-effort rollback to avoid leaving visible partial incidents or orphaned photos.
    await Promise.allSettled([
      env.DB.prepare("DELETE FROM incidents WHERE id = ?").bind(id).run(),
      ...uploadedKeys.map(key => env.PHOTOS.delete(key))
    ]);
    return json({ error: "Photos could not be saved. Please retry your submission." }, 503);
  }
}

// Optional native Cloudflare Email Service alerts. No emails are sent until
// a REPORT_ALERT_EMAIL binding is configured and the recipient is verified.
async function notifyAdminOfNewReport(env, incidentId, title, reason) {
  if (!env.REPORT_ALERT_EMAIL || !env.ADMIN_EMAIL) return;
  try {
    await env.REPORT_ALERT_EMAIL.send({
      to: String(env.ADMIN_EMAIL).trim(),
      from: "alerts@" + SITE_HOST,
      subject: "Vote Them Off the Road: New " + reason.replace(/_/g, " ") + " report",
      text: "A report or removal request needs review.\n\n" +
        "Incident: " + title + "\n" +
        "Reason: " + reason.replace(/_/g, " ") + "\n" +
        "Incident ID: " + incidentId + "\n\n" +
        "Review: " + SITE_ORIGIN + "/admin/\n\n" +
        "The incident has not been hidden automatically."
    });
  } catch (error) {
    // Never drop a valid report due to an email service outage.
    console.error("Admin email notification failed", error?.code || "error", error?.message || "");
  }
}

async function createReport(id, request, env, ctx) {
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
  const incident = await env.DB.prepare("SELECT title FROM incidents WHERE id = ? AND status = 'published'").bind(id).first();
  if (!incident) return json({ error: "Not found" }, 404);
  await env.DB.prepare(`
    INSERT INTO reports (id, incident_id, reason, details, contact_email)
    VALUES (?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), id, reason, note, email || null).run();
  if (env.REPORT_ALERT_EMAIL && ctx?.waitUntil) {
    ctx.waitUntil(notifyAdminOfNewReport(env, id, incident.title, reason));
  }
  return json({ ok: true, message: "Report received and pending review. The incident stays visible unless it is hidden or removed." }, 201);
}


// Inlined so the authenticated dashboard works even when the static asset
// resolver does not map /admin/ to /admin/index.html in production.
const ADMIN_DASHBOARD_HTML = "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"robots\" content=\"noindex,nofollow\"><meta name=\"theme-color\" content=\"#f7c744\">\n<title>Admin Dashboard | Vote Them Off the Road</title>\n<link rel=\"icon\" href=\"/assets/favicon.svg\" type=\"image/svg+xml\">\n<link rel=\"stylesheet\" href=\"/assets/styles.css\"><link rel=\"stylesheet\" href=\"/assets/admin.css\"></head>\n<body><a class=\"skip\" href=\"#main\">Skip to content</a>\n<div class=\"announcement\">PRIVATE ADMIN DASHBOARD <strong>• NEW HAMPSHIRE</strong></div>\n<header><div class=\"container header-inner\">\n<a class=\"brand\" href=\"/\" aria-label=\"Vote Them Off the Road home\"><span class=\"brand-mark\" aria-hidden=\"true\">✓</span><span class=\"brand-words\">Vote Them Off<br>the Road<small>SITE MANAGEMENT.</small></span></a>\n<nav class=\"nav\"><a href=\"/nh/\" target=\"_blank\" rel=\"noopener\">Public site ↗</a><a class=\"nav-cta\" href=\"/guidelines/\" target=\"_blank\" rel=\"noopener\">Site rules ↗</a></nav>\n</div></header>\n<main id=\"main\">\n<section class=\"admin-hero\"><div class=\"container admin-hero-inner\"><div><div class=\"section-kicker\">Your control room</div><h1>Admin dashboard.</h1><p>Review reports, manage published incidents and keep the community entertaining.</p>\n<p id=\"admin-signed-in\" class=\"admin-signed-in\"></p></div>\n<button id=\"refresh-admin\" class=\"btn btn-primary\" type=\"button\">↻ Refresh dashboard</button></div></section>\n<section class=\"section admin-section\"><div class=\"container\">\n<p id=\"admin-status\" class=\"admin-status\" role=\"status\" aria-live=\"polite\">Loading dashboard…</p>\n<div class=\"admin-stats\" id=\"admin-stats\"></div>\n<div class=\"admin-heading\"><div><div class=\"section-kicker\">Reports first</div><h2>Removal requests & reports</h2></div><span class=\"admin-note\">A report does not automatically hide a post.</span></div>\n<div id=\"admin-reports\" class=\"admin-list\"></div>\n<div class=\"admin-heading admin-heading-spaced\"><div><div class=\"section-kicker\">The whole board</div><h2>Manage incidents</h2></div></div>\n<div id=\"admin-incidents\" class=\"admin-list\"></div>\n<p class=\"admin-footnote\">“Remove from site” is reversible. “Permanently delete + photos” destroys the incident, its votes and reports, and associated R2 photos. This action cannot be undone.</p>\n</div></section></main>\n<footer class=\"footer\"><div class=\"container\"><div class=\"footer-bottom\">Vote Them Off the Road • Private administrator area</div></div></footer>\n<script src=\"/assets/site.js\" defer></script><script src=\"/assets/admin.js\" defer></script></body></html>\n";

/* Private admin API. Both Cloudflare Access and Worker-side signed JWT validation
   must succeed. No admin credentials or user report details are exposed publicly. */
let cachedAccessKeys = { team: "", expiresAt: 0, keys: [] };

function base64UrlBytes(encoded) {
  if (typeof encoded !== "string" || !/^[a-zA-Z0-9_-]+$/.test(encoded)) {
    throw new Error("Bad token encoding");
  }
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

function tokenJson(encoded) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(encoded)));
}

async function getAccessKeys(team, refresh = false) {
  if (!refresh && cachedAccessKeys.team === team && cachedAccessKeys.expiresAt > Date.now()) {
    return cachedAccessKeys.keys;
  }
  let response;
  try {
    response = await fetch("https://" + team + "/cdn-cgi/access/certs", {
      signal: AbortSignal.timeout(8000)
    });
  } catch (error) {
    console.error("Cloudflare Access public-key fetch failed", error?.name, error?.message);
    throw new Error("KEY_FETCH");
  }
  if (!response.ok) {
    console.error("Cloudflare Access public-key HTTP status", response.status);
    throw new Error("KEY_HTTP_" + String(response.status));
  }
  let certs;
  try { certs = await response.json(); }
  catch {
    console.error("Cloudflare Access public-key response was not JSON");
    throw new Error("KEY_JSON");
  }
  if (!Array.isArray(certs?.keys)) throw new Error("KEY_FORMAT");
  const keys = certs.keys.filter(key => key.kty === "RSA" && key.n && key.e && key.kid);
  if (!keys.length) throw new Error("KEY_EMPTY");
  cachedAccessKeys = { team, keys, expiresAt: Date.now() + 300000 };
  return keys;
}

async function authorizeAdmin(request, env) {
  const failed = code => ({ error: code });
  const team = String(env.ADMIN_ACCESS_TEAM || "").trim().toLowerCase();
  const aud = String(env.ADMIN_ACCESS_AUD || "").trim();
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{1,64}\.cloudflareaccess\.com$/.test(team) ||
      !aud || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) return failed("AUTH_CONFIG");
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || "";
  if (token.length > 12000) return failed("TOKEN_FORMAT");
  const parts = token.split(".");
  if (parts.length !== 3) return failed(token ? "TOKEN_FORMAT" : "TOKEN_MISSING");
  try {
    const header = tokenJson(parts[0]);
    const payload = tokenJson(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string" ||
        typeof payload.email !== "string" || payload.email.toLowerCase() !== adminEmail) return failed("IDENTITY_MISMATCH");
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(payload.exp) || payload.exp <= now ||
        (payload.nbf !== undefined && (typeof payload.nbf !== "number" || payload.nbf > now + 30)) ||
        (payload.iat !== undefined && (typeof payload.iat !== "number" || payload.iat > now + 30)) ||
        payload.iss !== "https://" + team ||
        !(Array.isArray(payload.aud) ? payload.aud.includes(aud) : payload.aud === aud)) {
      return failed("TOKEN_CLAIMS");
    }
    let keys;
    try {
      keys = await getAccessKeys(team);
    } catch (error) {
      return failed(String(error?.message || "").startsWith("KEY_") ? error.message : "KEY_FETCH");
    }
    let signingKey = keys.find(key => key.kid === header.kid);
    if (!signingKey) {
      try { keys = await getAccessKeys(team, true); }
      catch (error) {
        return failed(String(error?.message || "").startsWith("KEY_") ? error.message : "KEY_FETCH");
      }
      signingKey = keys.find(key => key.kid === header.kid);
    }
    if (!signingKey) return failed("SIGNING_KEY");
    let key;
    try {
      key = await crypto.subtle.importKey("jwk",
        { kty: "RSA", n: signingKey.n, e: signingKey.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    } catch (error) {
      console.error("Cloudflare Access public-key import failed", error?.name, error?.message);
      return failed("KEY_IMPORT");
    }
    let valid;
    try {
      valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5", key, base64UrlBytes(parts[2]),
        new TextEncoder().encode(parts[0] + "." + parts[1]));
    } catch (error) {
      console.error("Cloudflare Access JWT signature verification threw", error?.name, error?.message);
      return failed("SIGNATURE_ERROR");
    }
    return valid ? { email: adminEmail } : failed("SIGNATURE");
  } catch (error) {
    console.error("Admin authentication verification failed", error?.message || "error");
    return failed("VERIFICATION_ERROR");
  }
}

function isAdminMutationAllowed(request) {
  return request.headers.get("Origin") === SITE_ORIGIN &&
    (!request.headers.get("Sec-Fetch-Site") ||
      request.headers.get("Sec-Fetch-Site") === "same-origin");
}

function adminId(value) {
  return idPattern.test(value || "");
}

// Permanent deletion: hide first, delete R2 objects, then cascade-delete D1 records.
// If an external storage operation fails, leave a hidden incident for safe retry.
async function permanentlyDeleteIncident(env, id, identity) {
  const current = await env.DB.prepare("SELECT id FROM incidents WHERE id=?").bind(id).first();
  if (!current) return json({ error: "Incident not found" }, 404);

  await env.DB.prepare("UPDATE incidents SET status='removed', updated_at=unixepoch() WHERE id=?").bind(id).run();
  const media = await env.DB.prepare(
    "SELECT storage_provider, storage_key FROM incident_media WHERE incident_id=?"
  ).bind(id).all();
  const rows = media.results || [];
  if (rows.some(row => row.storage_provider !== "r2")) {
    return json({ error: "Incident hidden but non-R2 media must be deleted manually before permanent deletion." }, 409);
  }
  const keys = [...new Set(rows.map(row => row.storage_key).filter(Boolean))];
  if (keys.length && !env.PHOTOS) {
    return json({ error: "Incident hidden. R2 is unavailable; retry when storage is connected." }, 503);
  }
  try {
    for (let start = 0; start < keys.length; start += 1000) {
      await env.PHOTOS.delete(keys.slice(start, start + 1000));
    }
  } catch (error) {
    console.error("R2 permanent deletion failed", id, error?.message || "error");
    return json({ error: "Photo deletion failed. Incident is hidden; retry permanent deletion." }, 503);
  }
  // ON DELETE CASCADE removes associated media rows, votes and reports.
  await env.DB.prepare("DELETE FROM incidents WHERE id=?").bind(id).run();
  console.log("Admin permanently deleted incident", { email: identity.email, id, photo_count: keys.length });
  return json({ ok: true, deleted: true, photo_count: keys.length });
}

async function adminApi(request, env, path, identity) {
  if (path === "/admin/api/me" && request.method === "GET") {
    return json({ ok: true, email: identity.email, alerts_configured: Boolean(env.REPORT_ALERT_EMAIL && env.ADMIN_EMAIL) });
  }
  if (path === "/admin/api/reports" && request.method === "GET") {
    const rows = await env.DB.prepare(`
      SELECT r.id, r.incident_id, r.reason, r.details, r.contact_email,
        r.status, r.created_at, r.resolved_at,
        i.title AS incident_title, i.status AS incident_status
      FROM reports r
      LEFT JOIN incidents i ON i.id = r.incident_id
      ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
        r.created_at DESC LIMIT 100
    `).all();
    return json({ reports: rows.results || [] });
  }
  if (path === "/admin/api/incidents" && request.method === "GET") {
    const rows = await env.DB.prepare(`
      SELECT i.id, i.state_code, i.location_label, i.title, i.status,
        i.created_at, i.updated_at,
        (SELECT COUNT(*) FROM votes v WHERE v.incident_id = i.id AND v.choice = 'off') AS off_votes,
        (SELECT COUNT(*) FROM votes v WHERE v.incident_id = i.id AND v.choice = 'pass') AS pass_votes,
        (SELECT COUNT(*) FROM reports r WHERE r.incident_id = i.id AND r.status IN ('open', 'reviewing')) AS pending_reports
      FROM incidents i ORDER BY i.created_at DESC LIMIT 100
    `).all();
    return json({ incidents: rows.results || [] });
  }
  if (request.method !== "PATCH" && request.method !== "DELETE") return json({ error: "Not found" }, 404);
  if (!isAdminMutationAllowed(request)) return json({ error: "Invalid request origin" }, 403);
  const body = await parseBody(request);
  if (body.error) return json({ error: body.error }, body.status);
  const incidentMatch = /^\/admin\/api\/incidents\/([A-Za-z0-9_-]{6,80})$/.exec(path);
  if (incidentMatch) {
    const id = incidentMatch[1];
    if (request.method === "DELETE") {
      if (body.value.confirm !== "DELETE " + id)
        return json({ error: "Explicit deletion confirmation is required" }, 400);
      return permanentlyDeleteIncident(env, id, identity);
    }
    const state = body.value.status;
    if (!["published", "hidden", "removed"].includes(state)) {
      return json({ error: "Invalid incident status" }, 400);
    }
    const existing = await env.DB.prepare("SELECT id FROM incidents WHERE id = ?").bind(id).first();
    if (!existing) return json({ error: "Incident not found" }, 404);
    await env.DB.prepare(
      "UPDATE incidents SET status = ?, updated_at = unixepoch() WHERE id = ?"
    ).bind(state, id).run();
    console.log("Admin incident update", { email: identity.email, id, status: state });
    return json({ ok: true, id, status: state });
  }
  const reportMatch = /^\/admin\/api\/reports\/([A-Za-z0-9_-]{6,80})$/.exec(path);
  if (reportMatch) {
    if (request.method !== "PATCH") return json({ error: "Not found" }, 404);
    const id = reportMatch[1];
    const action = body.value.action;
    if (!["reviewing", "resolve", "dismiss", "reopen", "hide_and_resolve"].includes(action)) {
      return json({ error: "Invalid report action" }, 400);
    }
    const existing = await env.DB.prepare(
      "SELECT incident_id FROM reports WHERE id = ?"
    ).bind(id).first();
    if (!existing) return json({ error: "Report not found" }, 404);
    if (action === "hide_and_resolve") {
      // D1 batches execute statements in order as a transaction.
      await env.DB.batch([
        env.DB.prepare("UPDATE incidents SET status='hidden', updated_at=unixepoch() WHERE id=?")
          .bind(existing.incident_id),
        env.DB.prepare("UPDATE reports SET status='resolved', resolved_at=unixepoch() WHERE id=?").bind(id)
      ]);
    } else {
      const status = action === "resolve" ? "resolved" :
        action === "dismiss" ? "dismissed" :
        action === "reopen" ? "open" : "reviewing";
      await env.DB.prepare(
        "UPDATE reports SET status=?, resolved_at=? WHERE id=?"
      ).bind(status, status === "resolved" || status === "dismissed" ? Math.floor(Date.now()/1000) : null, id).run();
    }
    console.log("Admin report update", { email: identity.email, id, action });
    return json({ ok: true, id, action });
  }
  return json({ error: "Not found" }, 404);
}

async function adminRequest(request, env, pathname) {
  const configured = Boolean(env.ADMIN_ACCESS_TEAM && env.ADMIN_ACCESS_AUD && env.ADMIN_EMAIL);
  if (!configured) {
    return new Response("Admin dashboard is not configured yet.", {
      status: 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }
    });
  }
  const identity = await authorizeAdmin(request, env);
  if (!identity?.email) {
    const code = identity?.error || "ACCESS_DENIED";
    // Codes explain the category of failure without revealing tokens, email, or keys.
    console.warn("Admin Access verification rejected request", code);
    return new Response("Admin access denied (" + code + "). Check Cloudflare Access and your application settings.", {
      status: 403, headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store", "X-Robots-Tag": "noindex"
      }
    });
  }
  if (pathname.startsWith("/admin/api/")) {
    try { return await adminApi(request, env, pathname, identity); }
    catch (error) {
      console.error("Admin API failed", error);
      return json({ error: "Admin request failed" }, 503);
    }
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  if (pathname !== "/admin/" && pathname !== "/admin/index.html") {
    return new Response("Not found", {
      status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }
    });
  }
  return new Response(request.method === "HEAD" ? null : ADMIN_DASHBOARD_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/admin") return Response.redirect(SITE_ORIGIN + "/admin/", 302);
    if (pathname.startsWith("/admin/")) return adminRequest(request, env, pathname);
    if (pathname.startsWith("/media/")) {
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      try {
        const image = await serveImage(pathname.slice("/media/".length), env);
        return request.method === "HEAD" ? new Response(null, { status: image.status, headers: image.headers }) : image;
      } catch (error) {
        console.error("Photo fetch failed", error);
        return new Response("Temporarily unavailable", { status: 503 });
      }
    }
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (pathname === "/api/config" && request.method === "GET") {
        const enabled = writesReady(env);
        return json({ submissions_enabled: enabled, reports_enabled: enabled,
          photos_enabled: photosReady(env), voting_enabled: Boolean(env.DB && env.VOTE_RATE_LIMITER), max_photos: maxPhotos,
          turnstile_site_key: enabled ? env.TURNSTILE_SITE_KEY : null });
      }
      if (pathname === "/api/health" && request.method === "GET") {
        const result = await env.DB.prepare("SELECT 1 AS healthy").first();
        if (result?.healthy !== 1) throw new Error("D1 probe failed");
        return json({ ok: true, database: "connected" });
      }
      if (pathname === "/api/incidents") {
        if (request.method === "GET") return withVoterCookie(request, await listIncidents(url, env, request));
        if (request.method === "POST") return await createIncident(request, env);
        return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
      }
      const voteMatch = /^\/api\/incidents\/([a-zA-Z0-9_-]{6,80})\/vote$/.exec(pathname);
      if (voteMatch) {
        if (request.method === "POST") return await voteIncident(voteMatch[1], request, env);
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      }
      const reportMatch = /^\/api\/incidents\/([a-zA-Z0-9_-]{6,80})\/reports$/.exec(pathname);
      if (reportMatch) {
        if (request.method === "POST") return await createReport(reportMatch[1], request, env, ctx);
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      }
      if (pathname.startsWith("/api/incidents/")) {
        if (request.method === "GET") return withVoterCookie(request,
          await getIncident(pathname.slice("/api/incidents/".length), env, request));
        return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("API request failed", error);
      return json({ error: "Service temporarily unavailable" }, 503);
    }
  },
};
