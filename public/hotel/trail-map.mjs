import { WALLS } from './world.mjs';

const REVEAL_AFTER_METRES = 0.95;
const REVEAL_RADIUS = 1;
const SAMPLE_SPACING = 0.12;
const MAX_CONTINUOUS_STEP = 1.5;
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pose = player => ({ x: player.x, y: player.y, floor: player.floor, heading: player.heading || 0 });

/** A north-up memory of walking, never a preview of the unexplored floor. */
export class TrailMap {
  constructor(canvas, { walls = WALLS, bounds = { width: 18, height: 15, north: 12 } } = {}) {
    if (!canvas?.getContext) throw new TypeError('TrailMap requires a canvas.');
    this.canvas = canvas;
    this.walls = walls;
    this.bounds = bounds;
    this.context = canvas.getContext('2d');
    if (!this.context) throw new Error('A two-dimensional canvas is unavailable.');
    this.reset();
  }

  reset() {
    this.floors = new Map();
    this.last = null;
    this.player = null;
    this.activeFloor = 0;
    this.time = 0;
    this.breakTrail = true;
    this.draw();
  }

  update(state) {
    const player = state?.player;
    if (!player || ![0, 1].includes(player.floor) || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return;
    // Freezing the clock also freezes gradual reveal. Turning in place never
    // adds walked distance or uncovers a new portion of the map.
    if (state.paused || state.phase === 'ending') { this.draw(); return; }
    this.time = Number.isFinite(state.elapsed) ? state.elapsed : this.time + 1 / 60;
    this.activeFloor = player.floor;
    if (state.stairs) {
      this.last = null;
      this.player = null;
      this.breakTrail = true;
      this.draw();
      return;
    }

    const current = pose(player);
    let floor = this.floors.get(current.floor);
    if (!floor) {
      floor = { distance: 0, unlockedAt: null, segments: [] };
      this.floors.set(current.floor, floor);
    }
    const delta = this.last?.floor === current.floor ? distance(this.last, current) : 0;
    const separated = this.breakTrail || !this.last || this.last.floor !== current.floor || delta > MAX_CONTINUOUS_STEP;
    if (separated) {
      floor.segments.push([{ x: current.x, y: current.y, time: this.time }]);
    } else if (delta > 1e-6) {
      floor.distance += delta;
      const segment = floor.segments.at(-1);
      const previousSample = segment.at(-1);
      const sampleDistance = distance(previousSample, current);
      if (sampleDistance >= SAMPLE_SPACING) {
        // Resample slow render frames so reveal masks have no holes between
        // actual continuous positions. A floor change can never reach here.
        const pieces = Math.ceil(sampleDistance / SAMPLE_SPACING);
        for (let n = 1; n <= pieces; n++) segment.push({
          x: previousSample.x + (current.x - previousSample.x) * n / pieces,
          y: previousSample.y + (current.y - previousSample.y) * n / pieces,
          time: this.time,
        });
      }
      if (floor.unlockedAt === null && floor.distance >= REVEAL_AFTER_METRES) floor.unlockedAt = this.time;
    }
    this.last = current;
    this.player = current;
    this.breakTrail = false;
    this.draw();
  }

  draw() {
    const context = this.context;
    const width = this.canvas.width, height = this.canvas.height;
    if (!(width > 0 && height > 0)) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.shadowBlur = 0;
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    const floor = this.floors.get(this.activeFloor);
    const opacity = floor?.unlockedAt === null || !floor ? 0 : smooth((this.time - floor.unlockedAt) / 0.7);
    if (opacity <= 0) { context.restore(); return; }

    // Both floors share the same world scale and north direction. No floor
    // outline, label, source, furnishing or other undiscovered marker is drawn.
    const padding = Math.min(width, height) * 0.04;
    const scale = Math.min((width - padding * 2) / this.bounds.width, (height - padding * 2) / this.bounds.height);
    const offsetX = (width - this.bounds.width * scale) / 2;
    const offsetY = (height - this.bounds.height * scale) / 2;
    const X = x => offsetX + x * scale;
    const Y = y => offsetY + (this.bounds.north - y) * scale;
    const pixelScale = Math.min(width / 360, height / 300);

    context.beginPath();
    for (const segment of floor.segments) for (const point of segment) {
      const radius = (0.25 + (REVEAL_RADIUS - 0.25) * smooth((this.time - point.time) / 0.8)) * scale;
      context.moveTo(X(point.x) + radius, Y(point.y));
      context.arc(X(point.x), Y(point.y), radius, 0, Math.PI * 2);
    }
    if (this.player?.floor === this.activeFloor) {
      // Keep the current marker visible while the surrounding one-metre
      // reveal catches up. This smaller disc also stays on the walked path.
      const radius = 0.4 * scale;
      context.moveTo(X(this.player.x) + radius, Y(this.player.y));
      context.arc(X(this.player.x), Y(this.player.y), radius, 0, Math.PI * 2);
    }
    context.clip();

    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.globalAlpha = opacity * 0.48;
    context.strokeStyle = '#7f94af';
    context.lineWidth = Math.max(1, 1.2 * pixelScale);
    context.beginPath();
    for (const wall of this.walls) {
      if (wall.floor !== this.activeFloor) continue;
      context.moveTo(X(wall.x1), Y(wall.y1));
      context.lineTo(X(wall.x2), Y(wall.y2));
    }
    context.stroke();

    context.globalAlpha = opacity * 0.62;
    context.strokeStyle = '#b7c7dc';
    context.shadowColor = '#859fbe';
    context.shadowBlur = 5 * pixelScale;
    context.lineWidth = Math.max(1, 1.5 * pixelScale);
    context.beginPath();
    for (const segment of floor.segments) {
      context.moveTo(X(segment[0].x), Y(segment[0].y));
      for (let n = 1; n < segment.length; n++) context.lineTo(X(segment[n].x), Y(segment[n].y));
    }
    const lastSegment = floor.segments.at(-1);
    if (this.player?.floor === this.activeFloor && lastSegment?.length) {
      const lastPoint = lastSegment.at(-1);
      context.moveTo(X(lastPoint.x), Y(lastPoint.y));
      context.lineTo(X(this.player.x), Y(this.player.y));
    }
    context.stroke();

    if (this.player?.floor === this.activeFloor) {
      const p = this.player, heading = Number.isFinite(p.heading) ? p.heading : 0;
      const forward = { x: Math.sin(heading), y: Math.cos(heading) };
      const right = { x: Math.cos(heading), y: -Math.sin(heading) };
      context.globalAlpha = opacity * 0.95;
      context.fillStyle = '#d3dfee';
      context.shadowBlur = 3 * pixelScale;
      context.beginPath();
      context.moveTo(X(p.x + forward.x * 0.3), Y(p.y + forward.y * 0.3));
      context.lineTo(X(p.x - forward.x * 0.18 + right.x * 0.17), Y(p.y - forward.y * 0.18 + right.y * 0.17));
      context.lineTo(X(p.x - forward.x * 0.18 - right.x * 0.17), Y(p.y - forward.y * 0.18 - right.y * 0.17));
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  getStats() {
    const current = this.floors.get(this.activeFloor);
    return {
      floor: this.activeFloor,
      markerVisible: !!this.player && current?.unlockedAt != null && this.time > current.unlockedAt,
      floors: Object.fromEntries([...this.floors].map(([id, floor]) => [id, {
        distance: floor.distance,
        segments: floor.segments.length,
        points: floor.segments.reduce((sum, segment) => sum + segment.length, 0),
        revealed: floor.unlockedAt !== null && this.time > floor.unlockedAt,
      }])),
    };
  }
}
