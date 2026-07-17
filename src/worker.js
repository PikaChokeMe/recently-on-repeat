const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_OAUTH_URL = "https://discord.com/oauth2/authorize";
const DISCORD_SCOPES = "identify openid sdk.social_layer";

const SPOTIFY_ACCOUNTS_BASE = "https://accounts.spotify.com";
const SPOTIFY_SCOPES = "user-top-read user-read-recently-played";

export default {
    async fetch(request, env, ctx) {
        try {
            return await handleRequest(request, env, ctx);
        } catch (error) {
            console.error(error?.stack || error?.message || error);

            return Response.json({
                ok: false,
                error: "Worker exception",
                message: error?.message || "Unknown error"
            }, { status: 500 });
        }
    },

    async scheduled(controller, env, ctx) {
        ctx.waitUntil(runScheduledUpdates(env));
    }
};

async function handleRequest(request, env) {
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
        return handleSpotifyStart(request, env);
    }

    if (url.pathname === "/api/auth/spotify/callback") {
        return handleSpotifyCallback(request, env);
    }

    if (url.pathname === "/api/debug-cookies") {
        return Response.json({
            cookieHeader: request.headers.get("Cookie") || null,
            hasSession: Boolean(getCookie(request, "lor_session")),
            hasOauthState: Boolean(getCookie(request, "lor_oauth_state"))
        });
    }

    if (url.pathname === "/api/update-me") {
        return handleUpdateMe(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
        return Response.json({
            ok: false,
            error: "Not found"
        }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
}

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
        ]
    });
}

async function handleSpotifyStart(request, env) {
    requireEnv(env, "SPOTIFY_CLIENT_ID");

    const discordUserId = await getSessionUserId(request, env);

    if (!discordUserId) {
        return redirect("/api/auth/discord/start");
    }

    const state = randomBase64Url(32);
    const redirectUri = getSpotifyRedirectUri(request, env);

    const authUrl = new URL(`${SPOTIFY_ACCOUNTS_BASE}/authorize`);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", env.SPOTIFY_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", SPOTIFY_SCOPES);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("show_dialog", "true");

    return redirect(authUrl.toString(), {
        "Set-Cookie": makeCookie("lor_spotify_state", state, {
            maxAge: 600
        })
    });
}

async function handleSpotifyCallback(request, env) {
    requireEnv(env, "SPOTIFY_CLIENT_ID");
    requireEnv(env, "SPOTIFY_CLIENT_SECRET");
    requireEnv(env, "TOKEN_ENCRYPTION_KEY");

    const discordUserId = await getSessionUserId(request, env);

    if (!discordUserId) {
        return Response.json({
            ok: false,
            error: "Not logged in with Discord."
        }, { status: 401 });
    }

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const storedState = getCookie(request, "lor_spotify_state");

    if (!code) {
        return Response.json({
            ok: false,
            error: "Missing Spotify OAuth code."
        }, { status: 400 });
    }

    if (!returnedState || !storedState || returnedState !== storedState) {
        return Response.json({
            ok: false,
            error: "Invalid Spotify OAuth state."
        }, { status: 400 });
    }

    const redirectUri = getSpotifyRedirectUri(request, env);
    const credentials = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);

    const tokenResponse = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/api/token`, {
        method: "POST",
        headers: {
            "Authorization": `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri
        })
    });

    const tokenBody = await tokenResponse.json().catch(() => ({}));

    if (!tokenResponse.ok) {
        return Response.json({
            ok: false,
            error: "Spotify token exchange failed.",
            status: tokenResponse.status,
            details: sanitizeOAuthError(tokenBody)
        }, { status: 500 });
    }

    if (!tokenBody.refresh_token) {
        return Response.json({
            ok: false,
            error: "Spotify did not return a refresh token."
        }, { status: 500 });
    }

    const encrypted = await encryptString(tokenBody.refresh_token, env.TOKEN_ENCRYPTION_KEY);

    await env.DB.prepare(`
    UPDATE users
    SET
      spotify_refresh_token_encrypted = ?,
      spotify_refresh_token_iv = ?,
      spotify_connected = 1,
      updated_at = CURRENT_TIMESTAMP,
      last_error = NULL
    WHERE discord_user_id = ?
  `).bind(
        encrypted.ciphertext,
        encrypted.iv,
        discordUserId
    ).run();

    return redirect("/app.html", {
        "Set-Cookie": clearCookie("lor_spotify_state")
    });
}

function getSpotifyRedirectUri(request, env) {
    const origin = env.PUBLIC_BASE_URL || new URL(request.url).origin;
    return `${origin}/api/auth/spotify/callback`;
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
        DELETE FROM recent_plays
        WHERE discord_user_id = ?
    `).bind(discordUserId).run();

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

async function handleUpdateMe(request, env) {
    if (request.method !== "POST") {
        return Response.json({
            ok: false,
            error: "Method not allowed."
        }, {
            status: 405,
            headers: {
                "Allow": "POST"
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

    const result = await updateOneUser(env, discordUserId);

    return Response.json(result, {
        status: result.ok ? 200 : 500
    });
}

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

async function updateOneUser(env, discordUserId) {
    requireEnv(env, "SPOTIFY_CLIENT_ID");
    requireEnv(env, "SPOTIFY_CLIENT_SECRET");
    requireEnv(env, "TOKEN_ENCRYPTION_KEY");
    requireEnv(env, "DISCORD_BOT_TOKEN");

    const user = await env.DB.prepare(`
        SELECT
            discord_user_id,
            spotify_refresh_token_encrypted,
            spotify_refresh_token_iv,
            spotify_connected,
            enabled,
            recently_played_cursor_ms
        FROM users
        WHERE discord_user_id = ?
  `).bind(discordUserId).first();

    if (!user) {
        return {
            ok: false,
            error: "User not found."
        };
    }

    if (Number(user.enabled) !== 1) {
        return {
            ok: false,
            error: "User updates are disabled."
        };
    }

    if (Number(user.spotify_connected) !== 1 || !user.spotify_refresh_token_encrypted || !user.spotify_refresh_token_iv) {
        return {
            ok: false,
            error: "Spotify is not connected."
        };
    }

    try {
        const refreshToken = await decryptString(
            user.spotify_refresh_token_encrypted,
            user.spotify_refresh_token_iv,
            env.TOKEN_ENCRYPTION_KEY
        );

        const tokenBody = await refreshSpotifyAccessToken(env, refreshToken);

        if (tokenBody.refresh_token) {
            const encrypted = await encryptString(tokenBody.refresh_token, env.TOKEN_ENCRYPTION_KEY);

            await env.DB.prepare(`
        UPDATE users
        SET
          spotify_refresh_token_encrypted = ?,
          spotify_refresh_token_iv = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE discord_user_id = ?
      `).bind(
                encrypted.ciphertext,
                encrypted.iv,
                discordUserId
            ).run();
        }

        const tracks = await getWidgetTracksForUser(env, user, tokenBody.access_token);
        const payload = buildDiscordPayload(tracks);

        await patchDiscordWidgetForUser(env, discordUserId, payload);

        await env.DB.prepare(`
      UPDATE users
      SET
        last_success_at = CURRENT_TIMESTAMP,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE discord_user_id = ?
    `).bind(discordUserId).run();

        return {
            ok: true,
            updated: true,
            trackCount: tracks.length
        };
    } catch (error) {
        const safeError = sanitizeRuntimeError(error);

        await env.DB.prepare(`
      UPDATE users
      SET
        last_error = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE discord_user_id = ?
    `).bind(safeError, discordUserId).run();

        return {
            ok: false,
            error: safeError
        };
    }
}

async function refreshSpotifyAccessToken(env, refreshToken) {
    const credentials = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);

    const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/api/token`, {
        method: "POST",
        headers: {
            "Authorization": `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken
        })
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(`Spotify refresh failed: ${response.status} ${body.error || "unknown_error"}`);
    }

    if (!body.access_token) {
        throw new Error("Spotify refresh did not return an access token.");
    }

    return body;
}

async function getSpotifyTopTracks(env, accessToken) {
    const timeRange = env.SPOTIFY_TIME_RANGE || "short_term";
    const limit = env.SPOTIFY_LIMIT || "5";

    const url = new URL(`${SPOTIFY_API_BASE}/me/top/tracks`);
    url.searchParams.set("time_range", timeRange);
    url.searchParams.set("limit", limit);

    const response = await fetch(url, {
        headers: {
            "Authorization": `Bearer ${accessToken}`
        }
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(`Spotify top tracks failed: ${response.status} ${body.error?.message || body.error || "unknown_error"}`);
    }

    return body.items || [];
}

async function patchDiscordWidgetForUser(env, discordUserId, payload) {
    const apiBase = env.DISCORD_API_BASE || "https://discord.com/api/v9";
    const appId = env.DISCORD_CLIENT_ID;
    const identityId = env.DISCORD_IDENTITY_ID || "0";

    const url = `${apiBase}/applications/${appId}/users/${discordUserId}/identities/${identityId}/profile`;

    const response = await fetch(url, {
        method: "PATCH",
        headers: {
            "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json",
            "User-Agent": "DiscordBot (https://github.com/PikaChokeMe/recently-on-repeat, 0.1.0)"
        },
        body: JSON.stringify(payload)
    });

    const text = await response.text();

    if (!response.ok) {
        throw new Error(`Discord widget patch failed: ${response.status} ${text.slice(0, 240)}`);
    }

    try {
        return text ? JSON.parse(text) : {};
    } catch {
        return {
            raw: text
        };
    }
}

const FALLBACK_ART_URL = "https://placehold.co/512x512/1f2430/f3f5f7.png?text=No+Art";

function truncate(value, maxLength) {
    if (!value) {
        return "";
    }

    const clean = String(value).trim();

    if (clean.length <= maxLength) {
        return clean;
    }

    return `${clean.slice(0, maxLength - 3)}...`;
}

function getArtists(track) {
    return track?.artists?.map((artist) => artist.name).filter(Boolean).join(", ") || "Unknown Artist";
}

function getAlbumArt(track) {
    const images = track?.album?.images || [];
    return images[0]?.url || FALLBACK_ART_URL;
}

function stringField(name, value) {
    return {
        type: 1,
        name,
        value
    };
}

function imageField(name, url) {
    return {
        type: 3,
        name,
        value: {
            url
        }
    };
}

function buildDiscordPayload(tracks) {
    const dynamic = [];

    for (let i = 0; i < 5; i += 1) {
        const rank = i + 1;
        const track = tracks[i];

        const title = truncate(track?.name || `Song Title ${rank}`, rank === 1 ? 80 : 48);
        const artist = truncate(track ? getArtists(track) : `Song Artist ${rank}`, rank === 1 ? 80 : 48);
        const album = truncate(track?.album?.name || `Song Album ${rank}`, rank === 1 ? 80 : 48);
        const art = getAlbumArt(track);

        if (rank === 1) {
            dynamic.push(stringField("track_1_title", title));
            dynamic.push(stringField("track_1_artist", artist));
            dynamic.push(stringField("track_1_album", album));
            dynamic.push(imageField("track_1_art", art));
        } else {
            dynamic.push(stringField(`track_${rank}_title`, title));
            dynamic.push(stringField(`track_${rank}_info`, truncate(`${artist} - ${album}`, 96)));
            dynamic.push(imageField(`track_${rank}_art`, art));
        }
    }

    return {
        data: {
            dynamic
        }
    };
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

function redirect(location, extraHeaders = {}) {
    const headers = new Headers();

    headers.set("Location", location);

    for (const [name, value] of Object.entries(extraHeaders)) {
        if (Array.isArray(value)) {
            for (const item of value) {
                headers.append(name, item);
            }
        } else {
            headers.set(name, value);
        }
    }

    return new Response(null, {
        status: 302,
        headers
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

async function encryptString(plainText, base64UrlKey) {
    const encoder = new TextEncoder();
    const keyBytes = base64UrlDecode(base64UrlKey);

    if (keyBytes.byteLength !== 32) {
        throw new Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes.");
    }

    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-GCM" },
        false,
        ["encrypt"]
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv
        },
        cryptoKey,
        encoder.encode(plainText)
    );

    return {
        ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
        iv: base64UrlEncode(iv)
    };
}

async function decryptString(ciphertextBase64Url, ivBase64Url, base64UrlKey) {
    const decoder = new TextDecoder();
    const keyBytes = base64UrlDecode(base64UrlKey);
    const iv = base64UrlDecode(ivBase64Url);
    const ciphertext = base64UrlDecode(ciphertextBase64Url);

    if (keyBytes.byteLength !== 32) {
        throw new Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes.");
    }

    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-GCM" },
        false,
        ["decrypt"]
    );

    const plainBuffer = await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv
        },
        cryptoKey,
        ciphertext
    );

    return decoder.decode(plainBuffer);
}

function sanitizeRuntimeError(error) {
    const message = error?.message || "Unknown error";

    return message
        .replace(/refresh_token=[^&\s]+/gi, "refresh_token=[redacted]")
        .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
        .slice(0, 240);
}

function base64UrlDecode(value) {
    const base64 = value
        .replaceAll("-", "+")
        .replaceAll("_", "/")
        .padEnd(Math.ceil(value.length / 4) * 4, "=");

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

async function runScheduledUpdates(env) {
    const users = await env.DB.prepare(`
    SELECT discord_user_id
    FROM users
    WHERE enabled = 1
      AND spotify_connected = 1
      AND spotify_refresh_token_encrypted IS NOT NULL
      AND spotify_refresh_token_iv IS NOT NULL
  `).all();

    const rows = users.results || [];

    for (const user of rows) {
        await updateOneUser(env, user.discord_user_id);
    }

    return {
        ok: true,
        updatedUsers: rows.length
    };
}

function useRecentRepeatsMode(env) {
    return env.EXPERIMENTAL_RECENT_REPEATS === "1";
}

async function getWidgetTracksForUser(env, user, accessToken) {
    if (!useRecentRepeatsMode(env)) {
        return getSpotifyTopTracks(env, accessToken);
    }

    await syncRecentlyPlayed(env, user, accessToken);

    const recentRepeatTracks = await getRecentRepeatTracks(env, user.discord_user_id);

    if (recentRepeatTracks.length > 0) {
        return recentRepeatTracks;
    }

    return getSpotifyTopTracks(env, accessToken);
}

async function syncRecentlyPlayed(env, user, accessToken) {
    const url = new URL(`${SPOTIFY_API_BASE}/me/player/recently-played`);
    url.searchParams.set("limit", "50");

    if (user.recently_played_cursor_ms) {
        url.searchParams.set("after", String(user.recently_played_cursor_ms));
    }

    const response = await fetch(url, {
        headers: {
            "Authorization": `Bearer ${accessToken}`
        }
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(`Spotify recently played failed: ${response.status} ${body.error?.message || body.error || "unknown_error"}`);
    }

    const items = body.items || [];

    let newestPlayedAtMs = Number(user.recently_played_cursor_ms || 0);

    for (const item of items) {
        const track = item.track;

        if (!track || !track.id || !item.played_at) {
            continue;
        }

        const playedAtMs = Date.parse(item.played_at);

        if (!Number.isFinite(playedAtMs)) {
            continue;
        }

        newestPlayedAtMs = Math.max(newestPlayedAtMs, playedAtMs);

        await env.DB.prepare(`
      INSERT OR IGNORE INTO recent_plays (
        discord_user_id,
        played_at,
        played_at_ms,
        track_id,
        track_name,
        artist_name,
        album_name,
        album_art_url,
        spotify_track_url
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
            user.discord_user_id,
            item.played_at,
            playedAtMs,
            track.id,
            track.name || "Unknown Track",
            getArtists(track),
            track.album?.name || null,
            getAlbumArt(track),
            track.external_urls?.spotify || null
        ).run();
    }

    if (newestPlayedAtMs > Number(user.recently_played_cursor_ms || 0)) {
        await env.DB.prepare(`
      UPDATE users
      SET
        recently_played_cursor_ms = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE discord_user_id = ?
    `).bind(
            newestPlayedAtMs,
            user.discord_user_id
        ).run();
    }

    await trimRecentPlayHistory(env, user.discord_user_id);
}

async function trimRecentPlayHistory(env, discordUserId) {
    const retentionDays = Number(env.RECENT_PLAY_RETENTION_DAYS || "30");
    const maxEvents = Number(env.RECENT_PLAY_MAX_EVENTS || "5000");
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    await env.DB.prepare(`
    DELETE FROM recent_plays
    WHERE discord_user_id = ?
      AND played_at_ms < ?
  `).bind(
        discordUserId,
        cutoffMs
    ).run();

    await env.DB.prepare(`
        DELETE FROM recent_plays
        WHERE rowid IN (
            SELECT rowid
            FROM recent_plays
            WHERE discord_user_id = ?
            ORDER BY played_at_ms DESC
            LIMIT -1 OFFSET ?
            )
    `).bind(
        discordUserId,
        maxEvents
    ).run();
}

async function getRecentRepeatTracks(env, discordUserId) {
    const limit = Number(env.SPOTIFY_LIMIT || "5");
    const retentionDays = Number(env.RECENT_PLAY_RETENTION_DAYS || "30");
    const maxEvents = Number(env.RECENT_PLAY_MAX_EVENTS || "5000");
    const halfLifeDays = Number(env.RECENT_REPEAT_HALF_LIFE_DAYS || "2.5");

    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const result = await env.DB.prepare(`
    SELECT
      track_id,
      track_name,
      artist_name,
      album_name,
      album_art_url,
      spotify_track_url,
      played_at_ms
    FROM recent_plays
    WHERE discord_user_id = ?
      AND played_at_ms >= ?
    ORDER BY played_at_ms DESC
    LIMIT ?
  `).bind(
        discordUserId,
        cutoffMs,
        maxEvents
    ).all();

    const rows = result.results || [];
    const now = Date.now();
    const tracks = new Map();

    for (const row of rows) {
        const ageDays = Math.max(0, (now - Number(row.played_at_ms)) / (24 * 60 * 60 * 1000));
        const weight = Math.pow(0.5, ageDays / halfLifeDays);

        const existing = tracks.get(row.track_id) || {
            track_id: row.track_id,
            track_name: row.track_name,
            artist_name: row.artist_name,
            album_name: row.album_name,
            album_art_url: row.album_art_url,
            spotify_track_url: row.spotify_track_url,
            score: 0,
            play_count: 0,
            last_played_at_ms: 0
        };

        existing.score += weight;
        existing.play_count += 1;
        existing.last_played_at_ms = Math.max(existing.last_played_at_ms, Number(row.played_at_ms));

        tracks.set(row.track_id, existing);
    }

    return [...tracks.values()]
        .sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }

            return b.last_played_at_ms - a.last_played_at_ms;
        })
        .slice(0, limit)
        .map((row) => ({
            id: row.track_id,
            name: row.track_name,
            artists: String(row.artist_name || "Unknown Artist")
                .split(", ")
                .map((name) => ({ name })),
            album: {
                name: row.album_name || "Unknown Album",
                images: row.album_art_url ? [{ url: row.album_art_url }] : []
            },
            external_urls: {
                spotify: row.spotify_track_url
            }
        }));
}
