const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run") || process.env.DRY_RUN === "1";

const spotifyClientId = requiredEnv("SPOTIFY_CLIENT_ID");
const spotifyClientSecret = requiredEnv("SPOTIFY_CLIENT_SECRET");
const spotifyRefreshToken = requiredEnv("SPOTIFY_REFRESH_TOKEN");

const discordAppId = requiredEnv("DISCORD_APP_ID");
const discordUserId = requiredEnv("DISCORD_USER_ID");
const discordBotToken = requiredEnv("DISCORD_BOT_TOKEN");

const discordIdentityId = process.env.DISCORD_IDENTITY_ID || "0";
const discordApiBase = process.env.DISCORD_API_BASE || "https://discord.com/api/v10";

const spotifyTimeRange = process.env.SPOTIFY_TIME_RANGE || "short_term";
const spotifyLimit = Number(process.env.SPOTIFY_LIMIT || "5");

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function truncate(value, maxLength) {
  if (!value) {
    return "";
  }

  const clean = String(value).trim();

  if (clean.length <= maxLength) {
    return clean;
  }

  return `${clean.slice(0, maxLength - 1)}…`;
}

function getArtists(track) {
  return track.artists?.map((artist) => artist.name).filter(Boolean).join(", ") || "Unknown Artist";
}

function getAlbumArt(track) {
  const images = track.album?.images || [];

  // Spotify usually returns the largest image first.
  return images[0]?.url || "";
}

async function getSpotifyAccessToken() {
  const credentials = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString("base64");

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: spotifyRefreshToken
    })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Spotify token refresh failed: ${response.status} ${JSON.stringify(body)}`);
  }

  if (body.refresh_token) {
    console.warn("Spotify returned a new refresh token. Update SPOTIFY_REFRESH_TOKEN if refreshes start failing later.");
  }

  return body.access_token;
}

async function getTopTracks(accessToken) {
  const url = new URL("https://api.spotify.com/v1/me/top/tracks");
  url.searchParams.set("time_range", spotifyTimeRange);
  url.searchParams.set("limit", String(spotifyLimit));

  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${accessToken}`
    }
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Spotify top tracks request failed: ${response.status} ${JSON.stringify(body)}`);
  }

  return body.items || [];
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
    const art = getAlbumArt(track) || "https://placehold.co/512x512/1f2430/f3f5f7.png?text=No+Art";

    if (rank === 1) {
      dynamic.push(stringField("track_1_title", title));
      dynamic.push(stringField("track_1_artist", artist));
      dynamic.push(stringField("track_1_album", album));
      dynamic.push(imageField("track_1_art", art));
    } else {
      dynamic.push(stringField(`track_${rank}_title`, title));
      dynamic.push(stringField(`track_${rank}_info`, `${artist} - ${album}`));
      dynamic.push(imageField(`track_${rank}_art`, art));
    }
  }

  return {
    data: {
      dynamic
    }
  };
}

async function patchDiscordWidget(payload) {
  const url = `${discordApiBase}/applications/${discordAppId}/users/${discordUserId}/identities/${discordIdentityId}/profile`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Authorization": `Bot ${discordBotToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Discord widget patch failed: ${response.status} ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

async function main() {
  console.log("Refreshing Spotify access token...");
  const accessToken = await getSpotifyAccessToken();

  console.log(`Fetching Spotify top tracks: time_range=${spotifyTimeRange}, limit=${spotifyLimit}...`);
  const tracks = await getTopTracks(accessToken);

  console.log(`Received ${tracks.length} tracks from Spotify.`);

  const payload = buildDiscordPayload(tracks);

  if (dryRun) {
    console.log("Dry run enabled. Discord PATCH will not be sent.");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("Patching Discord widget data...");
  await patchDiscordWidget(payload);

  console.log("Listen on Repeat widget updated.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
