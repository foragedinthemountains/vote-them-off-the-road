// Cloudflare Worker: serves static assets and a read-only D1-backed incident feed.
// Public writes will be introduced only after spam prevention and removal tools exist.
const cacheHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { ...cacheHeaders, ...headers } });
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

  // The ORDER BY clause is chosen from fixed strings, never user SQL input.
  const order = sort === "top"
    ? "off_votes DESC, i.created_at DESC"
    : "i.created_at DESC";

  const query = `
    SELECT ${summaryColumns}
    ${summaryJoin}
    WHERE i.state_code = ? AND i.status = 'published'
    ${summaryGroup}
    ORDER BY ${order}
    LIMIT 20
  `;

  const result = await env.DB.prepare(query).bind(state).all();
  return json({ state, sort, incidents: result.results || [] });
}

async function getIncident(id, env) {
  if (!/^[a-zA-Z0-9_-]{6,80}$/.test(id)) {
    return json({ error: "Not found" }, 404);
  }

  const row = await env.DB.prepare(`
    SELECT ${summaryColumns}
    ${summaryJoin}
    WHERE i.id = ? AND i.status = 'published'
    ${summaryGroup}
    LIMIT 1
  `).bind(id).first();

  if (!row) return json({ error: "Not found" }, 404);
  return json({ incident: row });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname.startsWith("/api/")) {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
      }

      try {
        if (pathname === "/api/health") {
          const result = await env.DB.prepare("SELECT 1 AS healthy").first();
          if (result?.healthy !== 1) throw new Error("D1 probe failed");
          return json({ ok: true, database: "connected" });
        }

        if (pathname === "/api/incidents") {
          return await listIncidents(url, env);
        }

        if (pathname.startsWith("/api/incidents/")) {
          return await getIncident(pathname.slice("/api/incidents/".length), env);
        }

        return json({ error: "Not found" }, 404);
      } catch (error) {
        console.error("API request failed", error);
        return json({ error: "Service temporarily unavailable" }, 503);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
