/* 光尘指针 —— 鼠标划过时洒出的微光颗粒
   ===========================================================================
   自写实现，无第三方代码、零依赖（不需要 Three.js），Canvas 2D。
   行为参照常见的 glitter cursor 做法（思路不受版权保护，此处未复制任何他人代码）：
     · 沿"上一帧位置 → 当前位置"这一段**插值发射**，快速移动才不会断成一串点
     · 每颗颗粒沿环形随机方向向外飞，位移用 cubic-out 缓动（先快后慢）
     · 移动越快 → 发射越多、飞得越远、颗粒越大（下面的 speedBoost）
     · 随机明暗闪烁 + 淡出；用 lighter 叠加出辉光
   参数全在 CFG 里。想关掉：window.GLITTER.enabled = false
   =========================================================================== */
(function () {
  const CFG = {
    color: [160, 200, 255],  // 颗粒基色 RGB —— 直接取自粒子视觉 glow sprite 的第二个色标
                             // （index.html 的 rgba(160,200,255)），所以两者是同一个蓝
    perEmit: 8,      // 每次发射的颗粒数（乘以速度加成）
    maxParticles: 1400,   // 池上限，超出复用最老的
    spread: 26,     // 向外飞散半径（px），会被速度放大
    maxSpread: 2.0,    // 高速时飞散半径的最大倍数
    life: 1100,    // 单颗寿命（毫秒）
    sizeMin: 1.0,     // 颗粒半径范围（px）
    sizeMax: 2.8,
    speedRef: 55,      // 速度参考值：指针每帧移动多少 px 算"快"
    twinkle: 0.55,    // 闪烁强度 0..1（调小 = 少往暗里闪 = 整体更亮）
    fadePow: 1.15,    // 淡出曲线：越小越"亮得久"，越大越是最后才突然消失
    sizeScale: 4.0,   // 总大小倍率——嫌大/嫌小先调这个
    brightness: 1.25,  // 总亮度倍率——嫌暗/嫌亮先调这个
                       // （颗粒变小会连带变暗，所以这里比原来 1.6 略提了一点补偿）
    idleFade: true     // 指针停下后不再发射（只让已有颗粒自然消散）
  };

  const rmq = matchMedia("(prefers-reduced-motion: reduce)");
  const cv = document.createElement("canvas");
  cv.id = "glitterCanvas";
  cv.style.cssText = "position:fixed;inset:0;z-index:70;pointer-events:none;";
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d");

  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.width = Math.floor(innerWidth * dpr);
    H = cv.height = Math.floor(innerHeight * dpr);
    cv.style.width = innerWidth + "px";
    cv.style.height = innerHeight + "px";
  }
  addEventListener("resize", resize); resize();

  // 预渲染的辉光精灵：每帧只做 drawImage，比逐颗画渐变便宜得多
  let sprite = null;
  function makeSprite() {
    const N = 64;                       // 分辨率翻倍：放大绘制时不糊
    const s = document.createElement("canvas");
    s.width = s.height = N;
    const c = s.getContext("2d");
    const [r, g, b] = CFG.color;
    const h = N / 2;
    const grd = c.createRadialGradient(h, h, 0, h, h, h);
    // 收紧的辉光剖面：很小的实芯 + 快速衰减的晕。
    // 之前把不透明度一路铺到边缘，放大后就是一团糊；现在 35% 半径外基本已经透明。
    grd.addColorStop(0.00, `rgba(255,255,255,1.00)`);
    grd.addColorStop(0.07, `rgba(255,255,255,0.98)`);   // 实芯，看着"锐"
    grd.addColorStop(0.15, `rgba(210,230,255,0.72)`);
    grd.addColorStop(0.28, `rgba(${r},${g},${b},0.34)`);
    grd.addColorStop(0.48, `rgba(120,180,255,0.10)`);   // 晕收得早
    grd.addColorStop(0.75, `rgba(90,150,255,0.02)`);
    grd.addColorStop(1.00, `rgba(90,150,255,0)`);
    c.fillStyle = grd; c.fillRect(0, 0, N, N);
    return s;
  }
  sprite = makeSprite();

  // 颗粒池：定长数组循环复用，不做 GC 压力
  const P = new Array(CFG.maxParticles);
  for (let i = 0; i < P.length; i++) P[i] = { born: -1e9 };
  let head = 0;

  function cubicOut(t) { const f = t - 1; return f * f * f + 1; }

  let px = null, py = null, tx = 0, ty = 0, moved = false;
  addEventListener("pointermove", e => { tx = e.clientX; ty = e.clientY; moved = true; }, { passive: true });
  addEventListener("pointerleave", () => { px = py = null; });

  function emit(now) {
    const sx = px == null ? tx : px, sy = py == null ? ty : py;
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.hypot(dx, dy);
    // 速度加成：动得越快，发射越多、飞得越远、颗粒越大
    const speed = Math.min(1, dist / CFG.speedRef);
    const n = Math.max(1, Math.round(CFG.perEmit * (0.35 + speed * 1.65)));
    const spreadMul = 1 + (CFG.maxSpread - 1) * speed;

    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 1 : i / (n - 1);          // 沿移动线段插值，快速移动不断线
      const a = Math.random() * Math.PI * 2;
      const p = P[head]; head = (head + 1) % P.length;
      p.x = sx + dx * t;
      p.y = sy + dy * t;
      p.ang = a;
      p.rad = CFG.spread * spreadMul * (0.25 + Math.random() * 0.75);
      p.sz = CFG.sizeMin + Math.random() * (CFG.sizeMax - CFG.sizeMin) * (0.6 + speed * 0.4);
      p.born = now;
      p.life = CFG.life * (0.6 + Math.random() * 0.7);
      p.seed = Math.random() * 1000;
      p.depth = 0.58 + Math.random() * 0.42;        // 深度：影响亮度与大小，做出层次
      p.amp = 0.78 + speed * 0.22;                  // 慢速划过时略淡（但不至于看不见）
    }
    px = tx; py = ty;
  }

  let raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!window.GLITTER.enabled || rmq.matches || document.hidden) {
      if (W) ctx.clearRect(0, 0, W, H);
      return;
    }
    if (moved) { moved = false; emit(now); }
    else if (!CFG.idleFade) { emit(now); }

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      const age = now - p.born;
      if (age < 0 || age > p.life) continue;
      const k = age / p.life;                        // 0..1 生命进度
      const ease = cubicOut(k);
      const x = (p.x + Math.cos(p.ang) * p.rad * ease) * dpr;
      const y = (p.y + Math.sin(p.ang) * p.rad * ease) * dpr;
      // 闪烁：每颗独立相位，快到能看出"碎钻"感但不刺眼
      const flick = 1 - CFG.twinkle * 0.5 * (1 - Math.cos(now * 0.018 + p.seed));
      const alpha = Math.pow(1 - k, CFG.fadePow) * p.depth * p.amp * flick * CFG.brightness;
      if (alpha <= 0.004) continue;
      const s = p.sz * p.depth * dpr * (1 + ease * 0.35) * CFG.sizeScale;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(sprite, x - s / 2, y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  raf = requestAnimationFrame(frame);

  // 对外的小接口：开关 + 改色 + 调参
  window.GLITTER = {
    enabled: true,
    cfg: CFG,
    setColor(rgb) { CFG.color = rgb; sprite = makeSprite(); },
    // 预设两种：冷蓝（默认，与粒子/冷蓝/星云·蓝同色系）/ 暖金
    blue() { this.setColor([160, 200, 255]); },
    gold() { this.setColor([255, 232, 170]); }
  };
})();
