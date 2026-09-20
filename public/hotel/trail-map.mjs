import { WALLS } from './world.mjs';
import { drawFloorPlan } from './floor-plan.mjs';

const SAMPLE_SPACING = 0.12;
const MAX_CONTINUOUS_STEP = 1.5;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pose = player => ({ x: player.x, y: player.y, floor: player.floor, heading: player.heading || 0 });

/** Complete north-up floor plan with the player's own walking trail. */
export class TrailMap {
  constructor(canvas, { scene = 'hotel', walls = WALLS, door = null, mapDoors = [], bounds = { width: 18, height: 15, north: 12 } } = {}) {
    if (!canvas?.getContext) throw new TypeError('TrailMap requires a canvas.');
    this.canvas = canvas;
    this.walls = walls;
    this.scene = scene;
    this.door = door;this.mapDoors=mapDoors;
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
    this.doors = {};
    this.sources = {};
    this.visibleMarkers = [];
    this.draw();
  }

  update(state) {
    const player = state?.player;
    if (!player || ![0, 1].includes(player.floor) || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return;
    // Pausing freezes the displayed pose and trail, not access to the floor plan.
    if (state.paused || state.phase === 'ending') { this.draw(); return; }
    this.time = Number.isFinite(state.elapsed) ? state.elapsed : this.time + 1 / 60;
    this.activeFloor = player.floor;
    this.doors = {...state.doors};
    this.sources = Object.fromEntries(Object.entries(state.sources||{}).map(([id,p])=>[id,{...p}]));
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
      floor = { distance: 0, segments: [] };
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
        // Preserve a continuous personal trail across slower render frames.
        const pieces = Math.ceil(sampleDistance / SAMPLE_SPACING);
        for (let n = 1; n <= pieces; n++) segment.push({
          x: previousSample.x + (current.x - previousSample.x) * n / pieces,
          y: previousSample.y + (current.y - previousSample.y) * n / pieces,
          time: this.time,
        });
      }
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
    // Both floors share the same world scale and north direction.
    const padding = Math.min(width, height) * 0.04;
    const scale = Math.min((width - padding * 2) / this.bounds.width, (height - padding * 2) / this.bounds.height);
    const offsetX = (width - this.bounds.width * scale) / 2;
    const offsetY = (height - this.bounds.height * scale) / 2;
    const X = x => offsetX + x * scale;
    const Y = y => offsetY + (this.bounds.north - y) * scale;
    const pixelScale = Math.min(width / 360, height / 300);

    this.visibleMarkers=drawFloorPlan(context,{scene:this.scene,floor:this.activeFloor,walls:this.walls,door:this.door,mapDoors:this.mapDoors,bounds:this.bounds,doors:this.doors,sources:this.sources,X,Y,scale,pixelScale});

    context.globalAlpha = 0.62;
    context.strokeStyle = '#b7c7dc';
    context.shadowColor = '#859fbe';
    context.shadowBlur = 5 * pixelScale;
    context.lineWidth = Math.max(1, 1.5 * pixelScale);
    context.beginPath();
    for (const segment of floor?.segments||[]) {
      context.moveTo(X(segment[0].x), Y(segment[0].y));
      for (let n = 1; n < segment.length; n++) context.lineTo(X(segment[n].x), Y(segment[n].y));
    }
    const lastSegment = floor?.segments.at(-1);
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
      context.globalAlpha = 0.95;
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
    return {
      floor: this.activeFloor,
      fullyVisible: true,
      markerVisible: !!this.player,
      visibleMarkers: [...this.visibleMarkers],
      floors: Object.fromEntries([...this.floors].map(([id, floor]) => [id, {
        distance: floor.distance,
        segments: floor.segments.length,
        points: floor.segments.reduce((sum, segment) => sum + segment.length, 0),
        revealed: true,
      }])),
    };
  }
}
