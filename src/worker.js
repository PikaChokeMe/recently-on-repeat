export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === "/api/health") {
            return Response.json({
                ok: true,
                app: "Listen on Repeat"
            });
        }

        if (url.pathname === "/api/db-test") {
            const result = await env.DB.prepare("SELECT 1 AS ok").first();

            return Response.json({
                ok: true,
                db: result
            });
        }

        if (url.pathname.startsWith("/api/")) {
            return Response.json(
                {
                    ok: false,
                    error: "Not found"
                },
                { status: 404 }
            );
        }

        return env.ASSETS.fetch(request);
    }
};