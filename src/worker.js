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
    "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff",
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
  return json({ ok: true, message: "Report received and pending review. The incident stays visible unless it is hidden or removed." }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
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
        if (request.method === "POST") return await createReport(reportMatch[1], request, env);
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
