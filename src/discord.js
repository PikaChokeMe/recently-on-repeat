export async function patchDiscordWidget({ config, payload }) {
  const url = `${config.apiBase}/applications/${config.appId}/users/${config.userId}/identities/${config.identityId}/profile`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Authorization": `Bot ${config.botToken}`,
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (https://github.com/PikaChokeMe/recently-on-repeat, 0.1.0)"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Discord widget patch failed: ${response.status} ${text}`);
  }

  if (!text) {
    return {};
  }

  return JSON.parse(text);
}
