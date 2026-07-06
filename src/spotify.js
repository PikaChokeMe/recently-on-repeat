export async function getSpotifyAccessToken({ clientId, clientSecret, refreshToken }) {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch("https://accounts.spotify.com/api/token", {
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
    throw new Error(`Spotify token refresh failed: ${response.status} ${JSON.stringify(body)}`);
  }

  if (!body.access_token) {
    throw new Error(`Spotify token response did not include access_token: ${JSON.stringify(body)}`);
  }

  if (body.refresh_token) {
    console.warn("Spotify returned a new refresh token. Update SPOTIFY_REFRESH_TOKEN if refreshes start failing later.");
  }

  return body.access_token;
}

export async function getTopTracks({ accessToken, timeRange = "short_term", limit = 5 }) {
  const url = new URL("https://api.spotify.com/v1/me/top/tracks");
  url.searchParams.set("time_range", timeRange);
  url.searchParams.set("limit", String(limit));

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
