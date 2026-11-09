// Server-side entry point. Static HTML/CSS/images remain in the repository root.
// No public write endpoints are enabled until submissions and voting are ready.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/health") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed" }, {
          status: 405,
          headers: { "Allow": "GET", "Cache-Control": "no-store" },
        });
      }

      try {
        const result = await env.DB.prepare("SELECT 1 AS healthy").first();
        if (result?.healthy !== 1) throw new Error("D1 health probe failed");
        return Response.json({ ok: true, database: "connected" }, {
          headers: { "Cache-Control": "no-store" },
        });
      } catch (error) {
        console.error("D1 health check failed", error);
        return Response.json({ ok: false, database: "unavailable" }, {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        });
      }
    }

    if (pathname.startsWith("/api/")) {
      return Response.json({ error: "Not found" }, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
