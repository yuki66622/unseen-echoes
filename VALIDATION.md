# Integration validation · 2026-09-20

Release scope: unified Nebula Dark opening and chapters, current sound-hunt tutorial, square-open-v2 multiplayer chase and Pinewood Inn revision 3. Latest hotel navigation was selectively merged while preserving cloud voice routes, shared theme and the new envelope briefing. Current map, audio and layout checks are recorded below; earlier validation sections describe their historical snapshots. Rematch and interaction budgets remain in the paired multiplayer service.

## UI and latest investigation update

- 132 checks against the integrated Worker and hotel sources, including navigation hints, collision-safe assistance, floor transitions, explored-path masking and clean resets.
- Muted rendered UI checks: faster opening transitions, click/Enter/Space progression without double-advance, arrow movement, a single tutorial key legend, tutorial compass without a player map, envelope opening/full letter/explicit entry, shared controls and responsive layouts. An explicitly mocked provider error confirms that retry retains and resends the original input.
- The complete tutorial → two independent players → shared chase result → two independent hotel entries was repeated with the current client against the production multiplayer gateway.
- The full two-floor hotel journey, all initial testimony, incident recording, real incorrect/correct Gemini submissions, ending and restart were repeated against the integrated revision 3 source.
- Provider failure reproduced in the local Worker before the fix: `birds` returned a misleading 504 in 8 ms. With manual redirect handling, the same live Gemini request returned 200 in 1,716 ms, and ElevenLabs returned 200 with 22,613 bytes of MPEG audio. Redirects remain rejected; secrets are not forwarded. Network failures now report 502 separately from a genuine deadline. Production confirmation follows deployment.
- Rendered desktop, 390-pixel mobile and short-screen checks plus independent read-only review found no blocking layout or chapter-entry issues. Screenshots and reports remain in ignored `validation/ui-unified/`.

## Completed before publication

- 65 Worker/service checks: tutorial and hotel contracts, evidence gates, explicit submissions, role isolation, bounded actions, WAV validation, response size and deadlines, same-origin sessions, missing credentials and gateway restrictions. A stalled upload is cancelled after eight seconds and does not reserve a model-call slot.
- 33 authoritative chase-rule checks and TypeScript typecheck: same client/server geometry, directional hunter heartbeat, survivor-only opponent footsteps, motor-to-exit escape, capture, pause, reconnect and replay protection.
- Actual muted browser journey: Nebula opening → current tutorial → real keyboard movement through the tutorial door → rain confirmation → chapter continuation → naming and room entry → two independent roles prepare/start → real hunter movement and shared capture → each player's independent hotel entry.
- Actual muted hotel journey: continuous movement through both floors, all three initial testimonies, complete incident recording, a real Gemini wrong answer that preserves play, a real Gemini correct explanation after the evidence gate, ending and clean restart.
- Desktop rendering and narrow 390-pixel layouts inspected. Static import paths resolve; 38 authored hotel media assets plus the synthesized doorway cue decode. Shader renders in WebGL2.
- Publishable source scanned against actual local secret values: none found. Public media metadata omits private filesystem paths. Worker prompts/answer contract remain outside public. Both single-player APIs have distinct routes.

The prepublication chase browser test used the independent local SpacetimeDB test database. Production deployment is followed by separate live checks; never interpret that local test as an unrelated friend's network test. Detailed transient results are kept outside the versioned source in the original integration workspace.

## Boundaries

- Audio was tested silently with no microphone access. No claim of subjective loudness, accent quality, headphone experience or recognition accuracy.
- Hotel evidence state is personal client state; the service validates the schema and completion gate, not an independently authoritative history of the player's physical actions.
- Provider rate and concurrency controls are per Worker isolate, not a global billing limit. Existing provider accounts and quotas still apply; no automatic purchases are implemented.
- A timed CASE REVIEW is a revealed explanation, distinct from a player-submitted CASE EXPLAINED. The real successful-submission flow was separately verified.
- Cross-region friend connectivity, sustained load and long-duration stability remain outside this verification.

## Recovery

Preserve the previous saved Sites version and its corresponding SpacetimeDB rules. If a chapter fails to load or the two-player flow regresses, restore matching frontend/backend versions while preserving database data and browser identity. Never use a destructive database reset as a connection fix.


## Rematch and repeated controls update

- Two real local database identities completed a chase, voted separately to restart, returned to the same room with roles/readiness/votes cleared, exchanged roles, and completed another chase. A first vote alone preserved the shared result; a fresh role choice and readiness were required for round two.
- Desktop screenshots confirm the chase movement rows and letter-key hints are gone. Hotel movement controls, the E badge and duplicate nearby interaction buttons are removed; the envelope, settings, contextual object labels, conversations and evidence notes remain functional. All visited states had no browser errors.
- Twenty hotel application tests and the multiplayer TypeScript check passed. The user subsequently confirmed five total interaction attempts per round, including successful checks. Sixty rule/physics/hotel application checks passed, including fifth-attempt capture and escape, failed exhaustion, fifth recording completion despite a sixth E, no cost for rejected/replayed inputs, old-state compatibility and fresh-round reset.

The fifth hotel recording test collects the three initial witness statements through E, spends one empty check, then uses the fifth E for the recording. A sixth E neither spends another attempt nor stops playback; recording completion and the subsequent explanation remain possible. Actual microphone input and subjective listening remain outside these muted checks.

Eight actual muted browser checks passed against the isolated local database: fifth-attempt capture, two-vote role reset, role swap, refresh-preserved attempts, five-attempt loss, hotel exhaustion/reset, unrestricted tutorial and absence of page errors.

### Entry readiness follow-up

Production confirmed all four multiplayer checks, then exposed a race between the independently loaded letter and game modules: the entry click occurred while its handler was still null, with the original load-status unchanged. The letter and entry buttons now remain disabled until their respective handlers are ready. `verify-hotel-entry.cjs` deliberately holds the game module, verifies that the letter is readable and entry unavailable, then releases it and enters with one click. This check failed against the prior build and passes against the updated build (three browser assertions, no page errors). All 22 hotel application tests also pass. Final live results belong to the outer release ledger.

### Complete map and upstairs audio

The user's latest direction replaces explored-path masking with a complete floor plan at entry. Map checks now verify distant walls and landmarks before movement, complete upper-floor geometry on arrival, private opponent/motor exclusion, pause/reset and separate personal paths across floors. The new upstairs PCM clip contains exactly 144,000 frames at 48 kHz (3.000 seconds). An application check verifies one dedicated ascent clip, pause/resume and no layered wood footsteps.

`verify-map-stairs.cjs` passed seven real muted browser checks: full ground floor without walking, arrow-key ascent with a decoded 3-second clip and pause/resume, complete upper floor and recorder, tutorial map without sound sources plus compass and collapsed Gemini, both chase maps visible before exploration with no opponent activity leakage, real Epic/witch playback lifecycle and stronger heartbeat on approach, and no page errors/missing assets. The level has 39 packaged media assets after this addition. No live provider generation or microphone input is part of this check.

### Final audio and responsive layout checks

- All 140 Worker, hotel, map and chase-audio tests pass. The tutorial map test verifies actual room walls, door changes and exclusion of every supplied sound source. Audio tests cover entry, every result type, pause races, mute, role restrictions and ending deduplication.
- Ten actual rendered checks cover opening and active tutorial at 1440×900, 1024×768, 390×844, 844×390 and 320×568. Text/CTA/footer alignment and map/compass/keys/chat separation are asserted; Gemini starts collapsed. The original iframe/parent button overlap and mobile map/key overlap were reproduced before repair.
- Eight chapter UI checks pass, including arrow movement, collapsed Gemini, complete tutorial map, explicit mocked retry, envelope entry and no page errors/missing resources.
- A real two-player approach changed heartbeat gain from 0.080658 to 1.193279. Both clients decoded the 30-second Epic loop at gain 0.25, never played the witch clip at entry, then stopped scene loops and played the 6.68-second witch recording once on capture. Final output gain stayed zero throughout.
- Current evidence is in ignored validation/final-polish/ and validation/ui-unified/. These are muted implementation checks, not a subjective headphone audition. No real model-generation request was needed for this update. Final deployment identifiers and live checks belong in the outer integration release record.

## Bilingual release, shared play layout and generated worlds

The latest user direction supersedes earlier snapshots: every game retains the orb and applicable controls on the left, a centred complete map without private sound sources, and the compass on the right. English text uses Times New Roman; language switches preserve the current game and authored/player text boundaries.

- 166 integrated service/application/audio tests pass; 44 authoritative chase checks and TypeScript validation pass. The Maincloud migration preserves existing database data.
- Seven rendered language/layout checks cover opening, tutorial, lobby and hotel in four viewport sizes. Eight actual map/audio checks cover upfront maps, dedicated three-second stairs, sequential English welcome speech, chase Epic/witch and menu-rain lifecycles.
- Real two-player Maincloud check observed 2,998 ms hunter freeze, 3→2→1 countdown, blocked movement/turn/E during freeze, and successful capture at exactly 1.0 m. Both clients played one 7.16-second breathing clip at 20 seconds; repeated snapshots did not restart it. Rematch removed all chase voices and required fresh roles.
- Hotel follow-up questions disappear after selection and reset on replay. Opening/envelope screenshots and same-row rules/settings were inspected; skipping chase enters the hotel.
- One actual Gemini world request returned 200 in 3.24 seconds with 1,034 reported tokens. Its validated bilingual response was reused for subsequent rendered integration checks without generating again.
- Independent generated-world browser QA passed 16 checks: real arrow/F/E route, rain collection and return, success on the fifth E, failure on the fifth wrong E, sixth ignored, clean replay, saved-world reload, language preservation, complete source-free map, and cancellation during delayed audio loading. No page errors or unexpected external requests.
- Browser audio checks are headless and muted; no microphone or subjective listening is claimed. Chrome headless did not expose a real hidden-tab state, so actual tab-background behaviour remains unverified; delayed-load cancellation was verified separately.

The source copies of original supplied music remain unchanged. The opening piano uses a two-second activation delay and three-second volume envelopes, with menu rain at 10% of its normal level underneath. Natural completion restores rain; departure cancels pending playback and later chapters cannot replay the score in that tab's journey. The tutorial chapter label is “找到雨声” / “Find the rain”.

Five additional real-media browser checks passed for the 20.7735-second piano: two-second start delay, natural three-second fades, normal rain restoration at the actual track end, no replay after reload/return, stop on tutorial entry, and cancellation when leaving during the delay. These checks used the original encoded file with Chrome output muted; no test audio was heard on the user's computer.
