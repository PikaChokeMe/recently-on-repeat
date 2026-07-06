# Listen on Repeat

A source-available Discord profile widget updater that pulls Spotify track data and pushes it into a custom Discord widget.

I wrote this widget for personal use: to pull the top 5 current Spotify earworms from my account and put them on my Discord profile.

This repo exists so other people can use their own Discord app, Spotify app, and GitHub Actions workflow to recreate a similar setup without having to reinvent the whole thing from scratch.

Use it, learn from it, remix it for your own personal widget, and do good with it.

Do not exploit it.
Do not sell it.
Do not turn it into a paid hosted service.
Do not use it for commercial or personal financial gain without explicit permission.

## What this does

This project is intended to:

- Fetch your Spotify top tracks.
- Extract track title, artist, album, and album artwork.
- Format that data for a Discord custom profile widget.
- Push the data to Discord on a schedule using GitHub Actions.

The intended layout is:

- One large featured track.
- Four smaller secondary tracks.
- Album artwork for each track.
- Text fields for title, artist, and album info.

## Data flow

```text
Spotify API
  -> GitHub Actions scheduled workflow
  -> updater script
  -> Discord application identity/profile data
  -> Discord profile widget
```

The Discord widget itself does not directly call Spotify.

This is intentional. Spotify auth tokens, Discord bot tokens, refresh tokens, and other secret goblin sludge should never be exposed inside a public widget, browser client, or static page.

## Discord widget data fields

The widget is designed around the following dynamic data fields:

```text
track_1_title
track_1_artist
track_1_album
track_1_art

track_2_title
track_2_info
track_2_art

track_3_title
track_3_info
track_3_art

track_4_title
track_4_info
track_4_art

track_5_title
track_5_info
track_5_art
```

The expected Discord dynamic data shape looks like this:

```json
{
  "data": {
    "dynamic": [
      {
        "type": 1,
        "name": "track_1_title",
        "value": "Song Title 1"
      },
      {
        "type": 1,
        "name": "track_1_artist",
        "value": "Song Artist 1"
      },
      {
        "type": 1,
        "name": "track_1_album",
        "value": "Song Album 1"
      },
      {
        "type": 3,
        "name": "track_1_art",
        "value": {
          "url": "https://example.com/track_1_art.png"
        }
      },
      {
        "type": 1,
        "name": "track_2_title",
        "value": "Song Title 2"
      },
      {
        "type": 1,
        "name": "track_2_info",
        "value": "Song Artist 2 - Song Album 2"
      },
      {
        "type": 3,
        "name": "track_2_art",
        "value": {
          "url": "https://example.com/track_2_art.png"
        }
      }
    ]
  }
}
```

## Requirements

You will need:

- A Discord Developer Application.
- A Discord custom widget layout using matching dynamic data fields.
- A Spotify Developer Application.
- A Spotify refresh token for your account.
- A GitHub repository with Actions enabled.
- GitHub Actions secrets for your tokens and IDs.

## GitHub Actions secrets

Create the following repository secrets:

```env
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REFRESH_TOKEN=

DISCORD_APP_ID=
DISCORD_USER_ID=
DISCORD_BOT_TOKEN=
```

Do not commit these values.

Do not put them in your widget.

Do not put them in your README.

Do not paste them into random websites.

If you leak a token, rotate it. The raccoon is already in the walls.

## Local setup

Install dependencies:

```bash
npm install
```

Copy the example environment file:

```bash
cp .env.example .env
```

Fill in your local `.env` values.

Run the updater manually:

```bash
npm run update
```

## GitHub Actions setup

This project is meant to run on a schedule through GitHub Actions.

Example schedule:

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: "17 */3 * * *"
```

This runs the updater every 3 hours, plus allows manual runs from the GitHub Actions UI.

## Security notes

This project is designed so the Discord widget only receives display data.

The widget should never receive:

- Spotify refresh tokens.
- Spotify access tokens.
- Discord bot tokens.
- Discord user tokens.
- Client secrets.
- `.env` files.

The updater script should run in a trusted environment like GitHub Actions, using encrypted repository secrets.

## Privacy

This project only needs the Spotify data required to display your widget, such as:

- Track title.
- Artist name.
- Album name.
- Album artwork URL.

It does not need your Spotify password, Discord password, messages, server contents, payment information, or anything spicy like that.

If you make your own public app based on this, write your own privacy policy and terms of service that accurately describe your version.

## License

This project is source-available under the PolyForm Noncommercial License 1.0.0.

You may use, copy, modify, and self-host this project for personal and non-commercial purposes.

You may not sell this project, offer it as a paid hosted service, include it in a paid product, monetize derivatives of it, or use it for commercial purposes without explicit written permission from PikaChokeMe Studio.

Commercial rights are reserved by PikaChokeMe Studio.

This project is provided as-is, without warranty or guarantee. Discord and Spotify APIs may change, break, explode, vanish, or otherwise make this project stop working at any time.

## Contributions

This project is not currently accepting third-party code contributions.

Bug reports, feature ideas, documentation feedback, and "hey this broke because Discord moved the cheese again" reports are welcome.

Please do not submit code pull requests unless contribution terms have been agreed to first.

This is mainly to keep the licensing clean, because parts of this project may be commercialized separately by PikaChokeMe Studio in the future.

## Disclaimer

This project is not affiliated with Discord or Spotify.

All trademarks, service names, logos, and related assets belong to their respective owners.

Use this at your own risk.
