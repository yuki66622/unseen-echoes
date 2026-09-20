# Integration validation · 2026-09-20

Release scope: unified Nebula Dark opening and chapters, current sound-hunt tutorial, square-open-v2 multiplayer chase and Pinewood Inn revision 3. Latest hotel navigation was selectively merged while preserving cloud voice routes, shared theme and the new envelope briefing. The chase map and audio are unchanged; rematch and interaction budgets are updated in the paired multiplayer service.

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
