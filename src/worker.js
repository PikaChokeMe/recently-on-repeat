const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_OAUTH_URL = "https://discord.com/oauth2/authorize";
const DISCORD_SCOPES = "identify openid sdk.social_layer";

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

        if (url.pathname === "/api/auth/discord/start") {
            return handleDiscordStart(request, env);
        }

        if (url.pathname === "/api/auth/discord/callback") {
            return handleDiscordCallback(request, env);
        }

        if (url.pathname === "/api/me") {
            return handleMe(request, env);
        }

        if (url.pathname === "/api/delete") {
            return handleDelete(request, env);
        }

        if (url.pathname === "/api/auth/spotify/start") {
            return Response.json({
                ok: false,
                message: "Spotify connection is not implemented yet."
            }, { status: 501 });
        }

        if (url.pathname.startsWith("/api/")) {
            return Response.json({
                ok: false,
                error: "Not found"
            }, { status: 404 });
        }

        return env.ASSETS.fetch(request);
    }
};

async function handleDiscordStart(request, env) {
    requireEnv(env, "DISCORD_CLIENT_ID");
    requireEnv(env, "DISCORD_CLIENT_SECRET");
    requireEnv(env, "SESSION_SECRET");

    const state = randomBase64Url(32);
    const redirectUri = getDiscordRedirectUri(request, env);

    const authUrl = new URL(DISCORD_OAUTH_URL);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", DISCORD_SCOPES);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("prompt", "consent");

    return redirect(authUrl.toString(), {
        "Set-Cookie": makeCookie("lor_oauth_state", state, {
            maxAge: 600
        })
    });
}

async function handleDiscordCallback(request, env) {
    requireEnv(env, "DISCORD_CLIENT_ID");
    requireEnv(env, "DISCORD_CLIENT_SECRET");
    requireEnv(env, "SESSION_SECRET");

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const storedState = getCookie(request, "lor_oauth_state");

    if (!code) {
        return Response.json({
            ok: false,
            error: "Missing Discord OAuth code."
        }, { status: 400 });
    }

    if (!returnedState || !storedState || returnedState !== storedState) {
        return Response.json({
            ok: false,
            error: "Invalid OAuth state."
        }, { status: 400 });
    }

    const redirectUri = getDiscordRedirectUri(request, env);

    const tokenResponse = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
            client_id: env.DISCORD_CLIENT_ID,
            client_secret: env.DISCORD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri
        })
    });

    const tokenBody = await tokenResponse.json().catch(() => ({}));

    if (!tokenResponse.ok) {
        return Response.json({
            ok: false,
            error: "Discord token exchange failed.",
            status: tokenResponse.status,
            details: sanitizeOAuthError(tokenBody)
        }, { status: 500 });
    }

    const userResponse = await fetch(`${DISCORD_API_BASE}/users/@me`, {
        headers: {
            "Authorization": `Bearer ${tokenBody.access_token}`
        }
    });

    const user = await userResponse.json().catch(() => ({}));

    if (!userResponse.ok || !user.id) {
        return Response.json({
            ok: false,
            error: "Discord user lookup failed.",
            status: userResponse.status
        }, { status: 500 });
    }

    const displayName = user.global_name || user.username || null;

    await env.DB.prepare(`
    INSERT INTO users (
      discord_user_id,
      discord_username,
      created_at,
      updated_at
    )
    VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(discord_user_id) DO UPDATE SET
      discord_username = excluded.discord_username,
      updated_at = CURRENT_TIMESTAMP
  `).bind(user.id, displayName).run();

    const sessionValue = await createSessionValue(user.id, env.SESSION_SECRET);

    return redirect("/app.html", {
        "Set-Cookie": [
            makeCookie("lor_session", sessionValue, {
                maxAge: 60 * 60 * 24 * 30
            }),
            clearCookie("lor_oauth_state")
        ].join(", ")
    });
}

async function handleMe(request, env) {
    const discordUserId = await getSessionUserId(request, env);

    if (!discordUserId) {
        return Response.json({
            loggedIn: false
        });
    }

    const user = await env.DB.prepare(`
    SELECT
      discord_user_id,
      discord_username,
      spotify_connected,
      enabled,
      last_success_at,
      last_error
    FROM users
    WHERE discord_user_id = ?
  `).bind(discordUserId).first();

    if (!user) {
        return Response.json({
            loggedIn: false
        });
    }

    return Response.json({
        loggedIn: true,
        user
    });
}

async function handleDelete(request, env) {
    if (request.method !== "POST" && request.method !== "DELETE") {
        return Response.json({
            ok: false,
            error: "Method not allowed."
        }, {
            status: 405,
            headers: {
                "Allow": "POST, DELETE"
            }
        });
    }

    const discordUserId = await getSessionUserId(request, env);

    if (!discordUserId) {
        return Response.json({
            ok: false,
            error: "Not logged in."
        }, { status: 401 });
    }

    await env.DB.prepare(`
    DELETE FROM users
    WHERE discord_user_id = ?
  `).bind(discordUserId).run();

    return Response.json({
        ok: true,
        deleted: true
    }, {
        headers: {
            "Set-Cookie": clearCookie("lor_session")
        }
    });
}

function getDiscordRedirectUri(request, env) {
    const origin = env.PUBLIC_BASE_URL || new URL(request.url).origin;
    return `${origin}/api/auth/discord/callback`;
}

function requireEnv(env, name) {
    if (!env[name]) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
}

function getCookie(request, name) {
    const cookieHeader = request.headers.get("Cookie") || "";
    const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());

    for (const cookie of cookies) {
        const [cookieName, ...valueParts] = cookie.split("=");

        if (cookieName === name) {
            return valueParts.join("=");
        }
    }

    return null;
}

function makeCookie(name, value, options = {}) {
    const parts = [
        `${name}=${value}`,
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Lax"
    ];

    if (typeof options.maxAge === "number") {
        parts.push(`Max-Age=${options.maxAge}`);
    }

    return parts.join("; ");
}

function clearCookie(name) {
    return [
        `${name}=`,
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        "Max-Age=0"
    ].join("; ");
}

function redirect(location, headers = {}) {
    return new Response(null, {
        status: 302,
        headers: {
            "Location": location,
            ...headers
        }
    });
}

function randomBase64Url(byteLength) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes) {
    let binary = "";

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
}

async function createSessionValue(discordUserId, secret) {
    const signature = await hmacSign(discordUserId, secret);
    return `${discordUserId}.${signature}`;
}

async function getSessionUserId(request, env) {
    if (!env.SESSION_SECRET) {
        return null;
    }

    const session = getCookie(request, "lor_session");

    if (!session) {
        return null;
    }

    const dotIndex = session.lastIndexOf(".");

    if (dotIndex === -1) {
        return null;
    }

    const discordUserId = session.slice(0, dotIndex);
    const signature = session.slice(dotIndex + 1);
    const expectedSignature = await hmacSign(discordUserId, env.SESSION_SECRET);

    if (!safeEqual(signature, expectedSignature)) {
        return null;
    }

    return discordUserId;
}

async function hmacSign(value, secret) {
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        {
            name: "HMAC",
            hash: "SHA-256"
        },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(value)
    );

    return base64UrlEncode(new Uint8Array(signature));
}

function safeEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }

    let result = 0;

    for (let i = 0; i < a.length; i += 1) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
}

function sanitizeOAuthError(errorBody) {
    return {
        error: errorBody.error,
        error_description: errorBody.error_description
    };
}