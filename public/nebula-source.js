
/* Star Nest —— Relax 模式背景（原色 / 冷蓝 / 自定义色）
   ============================================================================
   Star Nest by Pablo Roman Andrioli
   License: MIT
   ----------------------------------------------------------------------------
   许可注记（本项目入库红线相关）：原作**明确标注 MIT**，允许商用，仅要求保留上面这段
   版权与许可声明——与 Shadertoy 默认的 CC BY-NC-SA（NC = 禁止商用）不同，这份可以进产品。
   正式入库时须同步登记进 THIRD_PARTY_NOTICES，并保留本注释块。
   **下方 SHADERTOY_BODY 是原作代码，逐字未改**；本项目的改动只有两处，且都在原作之外：
     ① 外面套 Shadertoy 的 uniform 外壳（iResolution / iTime / iMouse）让它能在裸 WebGL 里跑；
     ② 输出之后做后处理（冷蓝染色 / 亮度 / 可选的高光软压制），不触碰原作逻辑。
   ============================================================================ */
(function () {
  window.ENJOY_VISUALS = window.ENJOY_VISUALS || [];

  // ---- 各档共用的可调参数 ----
  const COMMON = {
    timeScale: 0.42,   // 时间流速倍率（Yuki 2026-08-25：整体放慢）。
                         // 原作 #define speed 0.010 未改，这里在喂给 iTime 之前缩放，
                         // 等效于把速度降到原来的 42%，且不动原作代码。
    energyGain: 0.22,   // 音乐能量对亮度的影响幅度（含蓄，别跟着节拍抽）
    renderScale: 1.0,    // 渲染分辨率倍率：每像素 20×17 次迭代，retina 满分辨率不划算
    softLimit: 0.0     // 高光软压制：0=忠于原作（会有穿过星云时的整片过曝）
                         // 想压住那个亮度浪涌就调到 0.6~0.9
  };

  /* ===== 以下为原作代码，逐字未改 ===== */
  const SHADERTOY_BODY = `
#define iterations 17
#define formuparam 0.53

#define volsteps 20
#define stepsize 0.1

#define zoom   0.800
#define tile   0.850
#define speed  0.010

#define brightness 0.0015
#define darkmatter 0.300
#define distfading 0.730
#define saturation 0.850

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	//get coords and direction
	vec2 uv=fragCoord.xy/iResolution.xy-.5;
	uv.y*=iResolution.y/iResolution.x;
	vec3 dir=vec3(uv*zoom,1.);
	float time=iTime*speed+.25;

	//mouse rotation
	float a1=.5+iMouse.x/iResolution.x*2.;
	float a2=.8+iMouse.y/iResolution.y*2.;
	mat2 rot1=mat2(cos(a1),sin(a1),-sin(a1),cos(a1));
	mat2 rot2=mat2(cos(a2),sin(a2),-sin(a2),cos(a2));
	dir.xz*=rot1;
	dir.xy*=rot2;
	vec3 from=vec3(1.,.5,0.5);
	from+=vec3(time*2.,time,-2.);
	from.xz*=rot1;
	from.xy*=rot2;

	//volumetric rendering
	float s=0.1,fade=1.;
	vec3 v=vec3(0.);
	for (int r=0; r<volsteps; r++) {
		vec3 p=from+s*dir*.5;
		p = abs(vec3(tile)-mod(p,vec3(tile*2.))); // tiling fold
		float pa,a=pa=0.;
		for (int i=0; i<iterations; i++) {
			p=abs(p)/dot(p,p)-formuparam; // the magic formula
			a+=abs(length(p)-pa); // absolute sum of average change
			pa=length(p);
		}
		float dm=max(0.,darkmatter-a*a*.001); //dark matter
		a*=a*a; // add contrast
		if (r>6) fade*=1.-dm; // dark matter, don't render near
		//v+=vec3(dm,dm*.5,0.);
		v+=fade;
		v+=vec3(s,s*s,s*s*s*s)*a*brightness*fade; // coloring based on distance
		fade*=distfading; // distance fading
		s+=stepsize;
	}
	v=mix(vec3(length(v)),v,saturation); //color adjust
	fragColor = vec4(v*.01,1.);

}
`;
  /* ===== 原作代码结束 ===== */

  const VERT = `#version 300 es
in vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

  const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2  iResolution;
uniform float iTime;
uniform vec4  iMouse;
uniform float uTint, uGain, uSoft;

` + SHADERTOY_BODY + `

/* 应用里那套冷蓝阶（取自粒子视觉的 glow sprite） */
vec3 coolBlue(float t){
  vec3 c0 = vec3(0.012, 0.028, 0.065);
  vec3 c1 = vec3( 90.0,150.0,255.0)/255.0;
  vec3 c2 = vec3(120.0,180.0,255.0)/255.0;
  vec3 c3 = vec3(160.0,200.0,255.0)/255.0;
  vec3 c4 = vec3(190.0,220.0,255.0)/255.0;
  return t < 0.30 ? mix(c0, c1, t / 0.30)
       : t < 0.60 ? mix(c1, c2, (t - 0.30) / 0.30)
       : t < 0.85 ? mix(c2, c3, (t - 0.60) / 0.25)
                  : mix(c3, c4, (t - 0.85) / 0.15);
}

void main(){
  vec4 col;
  mainImage(col, gl_FragCoord.xy);
  col.rgb *= uGain;
  if (uTint > 0.0) {
    float lum = clamp(dot(col.rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    col.rgb = mix(col.rgb, coolBlue(lum) * lum, uTint);
  }
  // 可选：高光软压制，抑制穿过星云时的整片过曝（uSoft=0 时完全不介入）
  if (uSoft > 0.0) {
    vec3 t = tanh(col.rgb * 1.35);
    col.rgb = mix(col.rgb, t, uSoft);
  }
  outColor = vec4(col.rgb, 1.0);
}`;

  // 三档共用一个已编译程序：只在首次 init 时编译
  let prog = null, U = null, phase = 0;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function build(gl) {
    if (prog) return;
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const g = n => gl.getUniformLocation(prog, n);
    U = { res: g("iResolution"), time: g("iTime"), mouse: g("iMouse"),
          tint: g("uTint"), gain: g("uGain"), soft: g("uSoft") };
  }

  /* 配色档（原作参数不变，只差后处理）。
     历史：Dark 一档（gain 0.55）Yuki 2026-08-26 判定太暗，移除；
     同日加过的 Customize 取色档（用户选色现推色阶）也被判定不好看，一并移除。
     两者都在 git 历史里，要翻出来看 6d9a420 之前。 */
  const LOOKS = [
    { id: "starnest",      group: "Nebula", name: "Original", tint: 0.0, gain: 1.00 },
    { id: "starnest-blue", group: "Nebula", name: "Blue",     tint: 1.0, gain: 1.00 },
  ];

  LOOKS.forEach(L => {
    window.ENJOY_VISUALS.push({
      id: L.id,
      name: L.name,
      group: L.group,
      webgl: true,
      renderScale: COMMON.renderScale,
      params: Object.assign({ tint: L.tint, gain: L.gain }, COMMON),  // 控制台可实时调

      init(gl) { build(gl); },

      render(gl, W, H, e, dt) {
        if (!prog) return;
        phase += dt * COMMON.timeScale;   // 自己的时钟（已按 timeScale 放慢），切档不跳变
        gl.useProgram(prog);
        gl.uniform2f(U.res, W, H);
        gl.uniform1f(U.time, phase);
        gl.uniform4f(U.mouse, 0, 0, 0, 0);   // 固定视角；沉浸模式不做鼠标转动
        gl.uniform1f(U.tint, this.params.tint);
        // 音乐能量只做含蓄的亮度调制
        gl.uniform1f(U.gain, this.params.gain * (1.0 + COMMON.energyGain * (e - 0.3)));
        gl.uniform1f(U.soft, this.params.softLimit);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    });
  });
})();

/* 海面 —— Relax 模式背景（蓝 / 紫 / 自定义色）
   ============================================================================
   MIT License
   -3 by @FabriceNeyret2
   -11 by @bug (very very slight visual change)
   ----------------------------------------------------------------------------
   许可注记：原作**明确标注 MIT**，允许商用，仅要求保留上面这段声明。
   入库须同步登记进 THIRD_PARTY_NOTICES.md，并保留本注释块（压缩打包时不要剥掉）。
   下方 SHADERTOY_BODY 是原作代码，除一处必要修正外逐字未改：
     · 原作把 i / n / p 声明后未初始化就参与运算。Shadertoy 的驱动通常零初始化，
       但按 GLSL 规范这是未定义行为，换显卡可能出雪花或全黑。这里显式补 i=0. /
       n=0. / p=vec3(0)，正是原作依赖的那个零初值，视觉零变化。
   本项目在原作之外的改动：WebGL uniform 外壳、输出后的调色/亮度、以及时间缩放
   （放慢用的是缩放喂进去的 iTime，不动原作内部）。
   ============================================================================ */
(function () {
  window.ENJOY_VISUALS = window.ENJOY_VISUALS || [];

  const COMMON = {
    timeScale: 0.45,   // 浪的速度（原作节奏 = 1.0；Yuki 2026-08-25 定为 0.45）
    energyGain: 0.18,  // 音乐能量对亮度的影响幅度（含蓄）
    renderScale: 1.0
  };

  /* ===== 以下为原作代码，仅补零初值 ===== */
  const SHADERTOY_BODY = `
void mainImage( out vec4 o, vec2 u ) {
    float s=.3,i=0.,n=0.;
    vec3 r = iResolution, p = vec3(0);
    for(u = (u-r.xy/2.)/r.y-s; i++ < 32. && ++s>.001;)
        for (p += vec3(u*s,s),s = p.y,
            n =.01; n < 1.;n+=n)
            s += abs(dot(sin(p.z + iTime + p/n),  r/r)) * n*.1;
    o = tanh(i*vec4(5,2,1,0)/length(u-.1)/5e2);
}
`;
  /* ===== 原作代码结束 ===== */

  const VERT = `#version 300 es
in vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

  const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec3  iResolution;
uniform float iTimeRaw;
uniform float uGain, uMoon;          // uMoon: 月亮亮度倍率（越小越暗，1.0 = 着色器原亮度）
float iTime;

/* 应用里那套冷蓝阶 */
vec3 coolBlue(float t){
  vec3 c0=vec3(0.012,0.028,0.065), c1=vec3(90.,150.,255.)/255.,
       c2=vec3(120.,180.,255.)/255., c3=vec3(160.,200.,255.)/255.,
       c4=vec3(190.,220.,255.)/255.;
  return t<0.30?mix(c0,c1,t/0.30):t<0.60?mix(c1,c2,(t-0.30)/0.30)
       :t<0.85?mix(c2,c3,(t-0.60)/0.25):mix(c3,c4,(t-0.85)/0.15);
}
` + SHADERTOY_BODY + `
void main(){
  iTime = iTimeRaw;              // 已在 JS 侧按 timeScale 缩放
  vec4 col;
  mainImage(col, gl_FragCoord.xy);
  col.rgb *= uGain;
  float l = clamp(dot(col.rgb, vec3(0.299,0.587,0.114)), 0.0, 1.0);
  /* 月亮压制：膝点以上做 Reinhard 式压缩 l' = t0 + d/(1+a·d)。
     必须**单调**——先前用 smoothstep 乘系数的写法在中心处压得比周围还狠，
     把月盘压成了一个暗环（核心塌陷）。这个式子导数恒正，且在膝点处斜率为 1，
     所以既不会反转明暗，也不会留下生硬的接缝。 */
  float t0 = 0.40;
  if (l > t0) {
    float d = l - t0;
    float a = (1.0/max(uMoon, 0.05) - 1.0) / max(1.0 - t0, 1e-3);
    l = t0 + d / (1.0 + a * d);
  }
  col.rgb = coolBlue(l) * l * 1.6;
  outColor = vec4(col.rgb, 1.0);  // 原作 alpha 权重为 0，补成不透明
}`;

  let prog = null, U = null, phase = 0;
  function compile(gl, type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function build(gl){
    if (prog) return;
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const g = n => gl.getUniformLocation(prog, n);
    U = { res:g("iResolution"), time:g("iTimeRaw"), gain:g("uGain"), moon:g("uMoon") };
  }

  /* Sea 现在只剩这一档，所以不再套折叠组（单项手风琴点开只有一个按钮，很傻），
     直接以 "Sea" 平铺在 Particles 旁边。id 保持 waves-blue 不变，旧的本地选择仍能命中。
     2026-08-26 同日删掉的两档：Violet（深紫，Yuki "太丑了"）与 Customize（取色，同评）。
     若日后再加第二档，把 group:"Sea" 加回来、name 改回具体配色名即可。
     moon 越小月亮越暗，1.0 = 着色器原亮度。 */
  const LOOKS = [
    { id:"waves-blue", name:"Sea", gain:1.00, moon:0.45 },
  ];

  LOOKS.forEach(L => {
    window.ENJOY_VISUALS.push({
      id: L.id, name: L.name, group: L.group, webgl: true,   // group 未定义即平铺
      renderScale: COMMON.renderScale,
      params: Object.assign({}, L, COMMON),
      init(gl){ build(gl); },
      render(gl, W, H, e, dt){
        if (!prog) return;
        phase += dt * COMMON.timeScale;      // 放慢
        gl.useProgram(prog);
        gl.uniform3f(U.res, W, H, 1.0);
        gl.uniform1f(U.time, phase);
        gl.uniform1f(U.moon, this.params.moon);
        gl.uniform1f(U.gain, this.params.gain * (1.0 + COMMON.energyGain * (e - 0.3)));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    });
  });
})();
