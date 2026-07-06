export function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optionalNumberEnv(name, fallback) {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${name} must be a number.`);
  }

  return value;
}

export function loadConfig() {
  return {
    dryRun: process.argv.includes("--dry-run") || process.env.DRY_RUN === "1",

    spotify: {
      clientId: requiredEnv("SPOTIFY_CLIENT_ID"),
      clientSecret: requiredEnv("SPOTIFY_CLIENT_SECRET"),
      refreshToken: requiredEnv("SPOTIFY_REFRESH_TOKEN"),
      timeRange: process.env.SPOTIFY_TIME_RANGE || "short_term",
      limit: optionalNumberEnv("SPOTIFY_LIMIT", 5)
    },

    discord: {
      appId: requiredEnv("DISCORD_APP_ID"),
      userId: requiredEnv("DISCORD_USER_ID"),
      botToken: requiredEnv("DISCORD_BOT_TOKEN"),
      identityId: process.env.DISCORD_IDENTITY_ID || "0",
      apiBase: process.env.DISCORD_API_BASE || "https://discord.com/api/v10"
    }
  };
}
