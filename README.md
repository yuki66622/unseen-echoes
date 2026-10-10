# Unseen Echoes

An atmospheric game about finding your way through sound. Wake in an unfamiliar space, choose a door, and discover what waits beyond it.

**[Play the game](https://unseen-echoes-play.yuki6666.chatgpt.site)**

## The journey

| Chapter | Experience |
|---|---|
| Opening | A dark, star-filled introduction with a one-time piano score. |
| Find the Rain | Learn spatial listening by following rain among birds and fire. |
| The Chase | Two players choose hunter and survivor in an open 8 × 8 m arena. Follow heartbeats, avoid footsteps, and find a way out. This chapter can be skipped. |
| Pinewood Inn | Open a letter, explore two floors, question three witnesses, and explain an unsettling recording with Gemini. Skip the case at any time to continue. |
| Another Door | Describe a new world. Gemini creates a validated, bilingual four-room setting using the existing sound library. |

For multiplayer, enter a name, create a room, and share its six-character code. Choose different roles and ready up. A rematch requires both players to agree and choose roles again. Hotel evidence and conversations remain individual.

## Controls and presentation

| Key | Action |
|---|---|
| Up / Down | Move forward / backward |
| Left / Right | Turn |
| E | Confirm or interact |
| F | Open or close a door where available |
| P | Pause local controls and audio |
| V | Hold to speak in chapters with voice input |
| Esc | Leave input or stop assisted movement |

Xbox controllers with the browser's `standard` mapping work in Find the Rain, The Chase, Pinewood Inn and Another Door. Pair in macOS Bluetooth settings, focus the game and press a controller button, then release the sticks and buttons. Menus and first audio activation still use the mouse.

| Controller input | Action |
|---|---|
| Left stick up / down | Forward / backward |
| Right stick left / right | Turn |
| D-pad | Equivalent movement and turning |
| A / X | Inspect or interact / open or close a door |
| B / Menu | Stop / pause or resume |

Holding a stick repeats the existing half-metre or 30-degree actions; turning takes priority over walking. This version does not change speed with stick pressure or add strafing. Centre dead zones filter small drift. Releasing stops controller movement; loss of focus, disconnecting, typing or opening controls suspends it. Return the sticks to centre before continuing. Held A/X never repeat an interaction. Physical Xbox/macOS mapping and subjective listening still require a device check.

Open `/controller/` on the local game server for a silent input check. It displays device identity, mapping, axes and buttons without microphone access, audio or input uploads. For this check and offline exploration only, no API credentials are needed:

```sh
python3 -m http.server 18779 --bind 127.0.0.1 --directory public
```

Then open `http://127.0.0.1:18779/controller/`. The static server does not provide multiplayer or AI APIs; use the full local runtime below for those. Current controller changes are local/source updates until the Site is separately deployed.

Each game keeps the sound-reactive orb and applicable controls on the left, a complete map in the centre, and a compass on the right. The tutorial and generated worlds hide sound-source markers; the chase hides the motor and other player. The hotel reveals rooms, doors, stairs and investigation landmarks.

English is the default. Switch between English and Chinese at the top right without resetting progress or typed text. English uses Times New Roman. Opening text advances on click; the first tagline also stays visible for four seconds. Tutorial Gemini chat starts collapsed. Previously asked witness questions disappear until replay.

Every chapter after the tutorial allows **five E attempts per round**, including successful interactions. A successful fifth attempt counts; a sixth is rejected. The hunter has a **three-second head start delay**, a 1.25 m capture radius, and the survivor has a 1.5 m interaction radius. Multiplayer time continues while local sound is paused.

## Sound

The opening piano begins two seconds after audio activation, fades in and out over three seconds, and plays once per journey. Refreshing the opening starts a fresh journey. Rain stays at 10% underneath, returns to normal after the piece ends, and stops with the piano when tutorial play begins. Later non-playing screens use gentle rain.

The chase uses quiet Epic Dark background music, a breathing clip every 20 seconds, stronger heartbeat changes with distance, and a single Powerful Witch ending cue. The hotel includes its English welcome and a dedicated three-second stair recording. Browser playback requires a player gesture; voice input is limited to 6 seconds.

Generated worlds reuse the existing rain, bird and fire recordings. Gemini does not create audio or executable code. The latest 12 worlds are saved in the current browser, without cross-device synchronization.

## Run locally

Use Node.js 24. Install dependencies, then start the local development service:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:18776/?mode=solo` to choose Hunter or Survivor and enter immediately, without a name, room code, second player or API credentials. The opposite character is a stationary test target. Movement, head start, timer, interactions and outcomes use the same rules as multiplayer. Use **Choose roles again** during play or after the result to restart on your own. This is a test mode, not an AI opponent.

The development service reads `public/` and `src/` directly and rebuilds the solo rules when their source changes. Save changes and refresh the game to test them; no deployment is needed. Do not edit the generated `public/multiplayer/solo.bundle.mjs`. `npm run build` still creates the separate distribution in `dist/`.

The role screen also links to the tutorial, hotel, generated worlds, controller check and original two-player game. Multiplayer settings remain in `connection.json` and point to the existing Maincloud service. Personal evidence and conversations are not stored in the multiplayer database.

For optional AI features, copy `.dev.vars.example` to `.dev.vars` if that private file does not exist, and configure your existing Gemini and/or ElevenLabs credentials plus a random `GAME_SESSION_SECRET`. Keep these values out of source control and `public/`. Solo testing and existing recordings work without provider keys. Restart the development service after changing credentials.

For a provider-free development-loop check, run `node verify-local-dev.mjs`. `verify-solo.cjs` checks the real single-player browser flow with audio muted and external requests blocked; supply your installed Playwright path through `PLAYWRIGHT_MODULE` if it is not on the module search path.

Without Gemini, recorded audio and exploration still work, but free-form conversation, explanation judging and world generation are unavailable. Without ElevenLabs, text replies and existing recordings remain available. Provider calls use the configured accounts and quotas; no automatic purchases are made. World generation accepts at most eight requests per visitor per hour within each running service instance; this is not a global billing cap.

## Project structure and validation

| Path | Purpose |
|---|---|
| `public/` | Game client, selected audio and asset notices |
| `src/` | Worker, chapter APIs and validated world generation |
| `spacetimedb/` | Authoritative multiplayer rules |
| `tests/` | Service, gameplay, navigation and audio checks |

The client and APIs use a Cloudflare Workers-compatible runtime. Multiplayer subscriptions pass through a restricted same-origin gateway to SpacetimeDB. Each personal chapter has a separate API. Hotel explanations require the initial testimony and incident recording; a timed case review is distinct from a successful player explanation.

```sh
npm test
cd spacetimedb
npm ci
npm test
npm run typecheck
```

The latest release passed 166 integrated checks and 44 multiplayer-rule checks. Browser verification covers bilingual layouts, chapter transitions, hotel investigation, real two-player capture, five-attempt outcomes, saved generated worlds, and audio lifecycles. Automated browsers are headless and muted, with no microphone permission. Some live integration scripts invoke configured providers; reuse captured responses for repeated rendering checks. See [VALIDATION.md](VALIDATION.md) for evidence and limits.

## Deployment and maintenance

Reuse the Sites project in `.openai/hosting.json`. Build, commit and push the exact source before saving and deploying its matching archive. This GitHub repository is public; a GitHub push alone does not deploy the Site.

Publish multiplayer rule changes together with the matching client. Preserve database data with `--delete-data=never`. Roll back to a matching Site/rules pair if needed. Browser session identity is not guaranteed to transfer across devices or new sessions.

This is a standalone integrated repository. The historical import scripts are not required for normal builds and can overwrite current chapter adaptations. Merge upstream changes selectively using `upstream-snapshot.json`, `hotel-snapshot.json` and `PROJECT_NOTES.md`.

## Credits and asset rights

Third-party code and recordings retain their individual terms and provenance in [public/licenses/](public/licenses/) and [AUDIO_PROVENANCE.md](AUDIO_PROVENANCE.md). The complete asset collection is not offered under one blanket open-source license. Backend answers are visible in this public source repository but are not served as static browser assets. Credentials and local configuration are excluded.

Project team: yuki66622 and xuejunyue0911.
