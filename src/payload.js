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

  // Spotify usually returns the largest image first.
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

export function buildDiscordPayload(tracks) {
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
