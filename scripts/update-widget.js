import { loadConfig } from "../src/config.js";
import { getSpotifyAccessToken, getTopTracks } from "../src/spotify.js";
import { buildDiscordPayload } from "../src/payload.js";
import { patchDiscordWidget } from "../src/discord.js";

async function main() {
  const config = loadConfig();

  console.log("Refreshing Spotify access token...");
  const accessToken = await getSpotifyAccessToken(config.spotify);

  console.log(`Fetching Spotify top tracks: time_range=${config.spotify.timeRange}, limit=${config.spotify.limit}...`);
  const tracks = await getTopTracks({
    accessToken,
    timeRange: config.spotify.timeRange,
    limit: config.spotify.limit
  });

  console.log(`Received ${tracks.length} tracks from Spotify.`);

  const payload = buildDiscordPayload(tracks);

  if (config.dryRun) {
    console.log("Dry run enabled. Discord PATCH will not be sent.");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("Patching Discord widget data...");
  await patchDiscordWidget({
    config: config.discord,
    payload
  });

  console.log("Listen on Repeat widget updated.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
