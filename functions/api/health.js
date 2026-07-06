// functions/api/health.js

export function onRequest() {
    return Response.json({
        ok: true,
        app: "Listen on Repeat"
    });
}