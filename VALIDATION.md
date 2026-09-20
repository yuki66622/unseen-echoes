# Integration validation · 2026-09-20

Release scope: existing Nebula Dark opening, current sound-hunt tutorial, square-open-v2 multiplayer chase and current Pinewood Inn investigation. Sources were frozen while other tasks continued; upstream changes after that snapshot are separate work.

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
