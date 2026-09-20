/** Geometric game acoustics: portal routing, not a measured room simulation. */
export const STOREY_HEIGHT = 3.2;
export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));
const mix = (a, b, t) => a + (b - a) * t;
export const dbToGain = db => 10 ** (db / 20);
const xyz = p => ({ x: p.x, y: (p.floor || 0) * STOREY_HEIGHT + 1.55, z: -p.y });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, ((a.floor || 0) - (b.floor || 0)) * STOREY_HEIGHT);

export function roomAt(p) {
  if ((p.floor || 0) < 0.5) {
    if (p.y < 0) return 'exterior';
    if (p.x >= 14 && p.y >= 8) return 'stairs-lower';
    return p.x >= 10 ? 'lounge' : 'lobby';
  }
  if (p.x >= 14 && p.y >= 8) return 'stairs-upper';
  if (p.y >= 8) return 'corridor';
  return p.x >= 12 ? 'linen' : 'recording';
}

// Every inter-room route crosses an actual opening. There is no shortcut through a slab.
const PORTALS = [
  { id: 'entrance', a: 'exterior', b: 'lobby', p: { x: 5, y: 0, floor: 0 }, door: 'entrance' },
  { id: 'lounge', a: 'lobby', b: 'lounge', p: { x: 10, y: 4.6, floor: 0 }, door: 'lounge' },
  { id: 'stairs-lower', a: 'lounge', b: 'stairs-lower', p: { x: 16, y: 8, floor: 0 } },
  { id: 'stairs-flight', a: 'stairs-lower', b: 'stairs-upper', p: { x: 16, y: 10, floor: 0 }, q: { x: 16, y: 10, floor: 1 } },
  { id: 'stairs-upper', a: 'stairs-upper', b: 'corridor', p: { x: 14, y: 10, floor: 1 } },
  { id: 'recording', a: 'corridor', b: 'recording', p: { x: 3, y: 8, floor: 1 }, door: 'recording' },
  { id: 'linen', a: 'corridor', b: 'linen', p: { x: 12.9, y: 8, floor: 1 }, door: 'linen' },
];

function route(from, to) {
  if (from === to) return [];
  const queue = [{ room: from, edges: [], visited: new Set([from]) }];
  while (queue.length) {
    const item = queue.shift();
    for (const portal of PORTALS) {
      if (portal.a !== item.room && portal.b !== item.room) continue;
      const next = portal.a === item.room ? portal.b : portal.a;
      if (item.visited.has(next)) continue;
      const forward = portal.a === item.room;
      const edge = { ...portal, enter: forward ? portal.p : portal.q || portal.p, exit: forward ? portal.q || portal.p : portal.p };
      const edges = [...item.edges, edge];
      if (next === to) return edges;
      queue.push({ room: next, edges, visited: new Set([...item.visited, next]) });
    }
  }
  return [];
}

export function listenerPose(state) {
  const player = state.player || { x: 5, y: -1, floor: 0, heading: 0 };
  if (!state.stairs) return { ...player };
  const { start, end } = state.stairs;
  const t = clamp(state.stairs.progress);
  return { x: mix(start.x, end.x, t), y: mix(start.y, end.y, t), floor: mix(start.floor, end.floor, t), heading: player.heading || 0 };
}

function atPose(state, player, source, diffuse) {
  const sourceRoom = roomAt(source), listenerRoom = roomAt(player);
  const portals = route(listenerRoom, sourceRoom);
  let previous = player, length = 0, transmission = 1, cutoff = 18000;
  for (const portal of portals) {
    length += distance(previous, portal.enter) + distance(portal.enter, portal.exit);
    previous = portal.exit;
    if (portal.door) {
      const open = clamp(state.doors?.[portal.door] ?? 0);
      transmission *= dbToGain(-20 * (1 - open));
      cutoff = Math.min(cutoff, 650 * (18000 / 650) ** open);
    } else {
      const boundaryWeight = portal.id === 'stairs-flight' ? 1 : clamp(Math.min(distance(player, portal.enter), distance(source, portal.exit)) / 1.5);
      transmission *= mix(1, portal.id === 'stairs-flight' ? 0.68 : 0.93, boundaryWeight);
      cutoff = Math.min(cutoff, mix(18000, portal.id === 'stairs-flight' ? 5200 : 14000, boundaryWeight));
    }
  }
  const portalDistance = length;
  length += distance(previous, source);
  // A diffuse room bed remains broad in its own room; other rooms hear it via openings.
  const effectiveDistance = diffuse ? portalDistance : length;
  const attenuation = 1 / (1 + Math.max(0, effectiveDistance - 1) * (diffuse ? 0.22 : 0.18));
  let apparent = { ...source };
  if (portals.length) {
    const nearest = portals[0];
    const openness = nearest.door ? clamp(state.doors?.[nearest.door] ?? 0) : 1;
    const nearOpening = clamp(1 - distance(player, nearest.enter) / 1.5) * openness;
    apparent = {
      x: mix(nearest.enter.x, source.x, nearOpening),
      y: mix(nearest.enter.y, source.y, nearOpening),
      floor: mix(nearest.enter.floor, source.floor, nearOpening),
    };
  }
  const gain = transmission * attenuation;
  return {
    sourceRoom, listenerRoom, route: portals.map(p => p.id), distance: length,
    effectiveDistance, transmission, gain, cutoff, apparent: xyz(apparent),
    reflection: listenerRoom === 'exterior' ? 0.012 : listenerRoom.startsWith('stairs') ? 0.16 : listenerRoom === 'corridor' ? 0.10 : 0.065,
    diffuse: !!diffuse, directionality: diffuse ? (portals.length ? clamp(distance(player, portals[0].enter) / 1.5) : 0) : 1,
    transitionProgress: null,
  };
}

export function acousticScene(state, source, { diffuse = false } = {}) {
  if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.y)) throw new TypeError('An acoustic source needs finite world coordinates.');
  if (!state.stairs) return atPose(state, state.player, source, diffuse);
  const t = clamp(state.stairs.progress);
  const a = atPose(state, state.stairs.start, source, diffuse);
  const b = atPose(state, state.stairs.end, source, diffuse);
  return {
    ...a, listenerRoom: `${a.listenerRoom} → ${b.listenerRoom}`,
    route: [...new Set([...a.route, ...b.route])],
    routeFrom: a.route, routeTo: b.route,
    distance: mix(a.distance, b.distance, t), transmission: mix(a.transmission, b.transmission, t),
    gain: mix(a.gain, b.gain, t), cutoff: Math.exp(mix(Math.log(a.cutoff), Math.log(b.cutoff), t)),
    apparent: { x: mix(a.apparent.x, b.apparent.x, t), y: mix(a.apparent.y, b.apparent.y, t), z: mix(a.apparent.z, b.apparent.z, t) },
    reflection: mix(a.reflection, b.reflection, t), directionality: mix(a.directionality, b.directionality, t),
    transitionProgress: t,
  };
}

export function webAudioListener(state) {
  const p = listenerPose(state), heading = p.heading || 0;
  return { ...xyz(p), forwardX: Math.sin(heading), forwardY: 0, forwardZ: -Math.cos(heading) };
}
