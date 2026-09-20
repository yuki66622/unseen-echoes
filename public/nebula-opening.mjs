const root=document.getElementById('unseen-echoes-opening'),host=root.querySelector('.ue-game');
const canvas=document.createElement('canvas');canvas.className='nebula-backdrop';canvas.setAttribute('aria-hidden','true');host.prepend(canvas);
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const renderer=window.ENJOY_VISUALS?.find(v=>v.id==='starnest-blue');
let gl,frame=0,last=0,failed=false,frames=0;
const opacities=[1,.8,.35,.27,.20,.15,.08,0];
try{gl=canvas.getContext('webgl2',{alpha:false,antialias:false,powerPreference:'low-power'});}catch{}
function draw(dt){if(!gl||failed||!renderer)return;try{renderer.init(gl);renderer.render(gl,canvas.width,canvas.height,.3,dt);frames++;root.dataset.renderer='webgl2';}catch{failed=true;root.dataset.renderer='unavailable';}}
function animate(now){frame=0;if(document.hidden||failed||reduced.matches||Number(root.dataset.step)===7)return;const elapsed=now-last;if(elapsed>=1000/30){draw(Math.min(.08,elapsed/1000));last=now;}frame=requestAnimationFrame(animate);}
function sync(){cancelAnimationFrame(frame);canvas.style.opacity=opacities[Number(root.dataset.step)||0];last=performance.now();if(gl&&!failed&&!document.hidden&&!reduced.matches&&Number(root.dataset.step)!==7)frame=requestAnimationFrame(animate);else draw(0);}
function resize(){const r=host.getBoundingClientRect(),scale=Math.min(1,Math.sqrt(720000/(r.width*r.height)));canvas.width=Math.max(1,Math.round(r.width*scale));canvas.height=Math.max(1,Math.round(r.height*scale));if(gl)gl.viewport(0,0,canvas.width,canvas.height);draw(0);}
if(renderer&&gl){renderer.params.gain=.55;draw(10);new ResizeObserver(resize).observe(host);new MutationObserver(sync).observe(root,{attributes:true,attributeFilter:['data-step']});document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();failed=true;sync();});resize();sync();}else root.dataset.renderer='unavailable';
root.nebulaDiagnostics=()=>({renderer:root.dataset.renderer,frames,opacity:Number(canvas.style.opacity),silent:true});
