import { MultiplayerAudio } from './player-audio.mjs';
import { ChaseAudio } from './chase-audio.mjs';

// Tutorials and the solo story retain their authored room and recordings.
export class SceneAudio {
  constructor(options) {
    this.local = new MultiplayerAudio(options);
    this.chase = new ChaseAudio(options);
    this.current = this.local;
  }
  start(snapshot) {
    const next = snapshot?.roundId ? this.chase : this.local;
    if (next !== this.current) this.current.pause();
    this.current = next;
    return next.start(snapshot);
  }
  update(snapshot) { this.current.update(snapshot); }
  playCue(kind, position) { if (this.current === this.local) return this.local.playCue(kind, position); }
  setVolume(value) { this.local.setVolume(value); this.chase.setVolume(value); }
  pause() { this.local.pause(); this.chase.pause(); }
  finish(snapshot, options) {
    this.local.pause();
    this.current = this.chase;
    return this.chase.finish(snapshot, options);
  }
  getStats() { return { scene: this.current === this.chase ? 'chase' : 'local', ...this.current.getStats() }; }
}
