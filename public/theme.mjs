import '/nebula-source.js';

// Narrative chapters share the opening's renderer. Active audio worlds stay dark.
const root = document.documentElement;
const chapter = root.dataset.uiChapter;
const canvas = document.createElement('canvas');
canvas.className = 'chapter-nebula';
canvas.setAttribute('aria-hidden', 'true');
canvas.style.opacity = '0';
document.body.prepend(canvas);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const renderer = window.ENJOY_VISUALS?.find(v => v.id === 'starnest-blue');
let gl, frame = 0, last = 0, failed = false, opacity = 0, frames = 0;
try { gl = canvas.getContext('webgl2', {alpha: false, antialias: false, powerPreference: 'low-power'}); } catch {}
function draw(dt) {
  if (!gl || !renderer || failed) return;
  try { renderer.init(gl); renderer.render(gl, canvas.width, canvas.height, .3, dt); frames++; root.dataset.nebula = 'ready'; }
  catch { failed = true; root.dataset.nebula = 'unavailable'; }
}
function animate(now) {
  frame = 0;
  if (!opacity || document.hidden || reduced.matches || failed) return;
  const elapsed = now-last;
  if (elapsed >= 1000/24) { draw(Math.min(.08, elapsed/1000)); last = now; }
  frame = requestAnimationFrame(animate);
}
function sync() {
  if (chapter === 'multiplayer') opacity = document.body.dataset.phase === 'lobby' ? .38 : document.body.dataset.phase?.endsWith('result') ? .28 : 0;
  else if (chapter === 'tutorial') opacity = document.body.classList.contains('has-entered') ? 0 : .38;
  else opacity = !document.getElementById('intro')?.hidden || !document.getElementById('ending')?.hidden ? .38 : 0;
  canvas.style.opacity = String(opacity);
  cancelAnimationFrame(frame); frame = 0; last = performance.now();
  if (opacity && !document.hidden && !reduced.matches && !failed) frame = requestAnimationFrame(animate);
  else if (opacity) draw(0);
}
function resize() {
  const scale = Math.min(1, Math.sqrt(500000/(innerWidth*innerHeight)));
  canvas.width = Math.max(1, Math.round(innerWidth*scale)); canvas.height = Math.max(1, Math.round(innerHeight*scale));
  gl?.viewport(0,0,canvas.width,canvas.height); draw(0);
}
if (gl && renderer) {
  renderer.params.gain = .55;
  resize(); draw(10);
  const observer = new MutationObserver(sync);
  observer.observe(document.body, {attributes: true, attributeFilter: ['class','data-phase']});
  for (const id of ['intro','ending']) { const el = document.getElementById(id); if (el) observer.observe(el, {attributes: true, attributeFilter: ['hidden']}); }
  addEventListener('resize',resize); document.addEventListener('visibilitychange',sync); reduced.addEventListener('change',sync);
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); failed = true; cancelAnimationFrame(frame); canvas.style.opacity = '0'; root.dataset.nebula = 'unavailable'; });
  sync();
} else root.dataset.nebula = 'unavailable';
