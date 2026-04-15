// gpu-canvas.js
// WebGL1 particle system — Stage.Effect structure (same pattern as motion.js).
//
// WebGL2 Transform Feedback → replaced with GPGPU float-texture ping-pong:
//   State texture (TEX_W × TEX_H pixels): RGBA = [pos.x, pos.y, vel.x, vel.y]
//   Update pass : fragment shader reads old state → writes new state to FBO
//   Render pass : vertex shader reads positions from state texture → draws points
//
// Reads detection globals (set by detection.js each frame):
//   fingertips, flowVectors, foxGesture, handMoving, volumeSpike

(function () {
  'use strict';

  var TEX_W = 256, TEX_H = 128;  // state texture dimensions
  var N = TEX_W * TEX_H;         // 32 768 particles

  // ─── Shaders ─────────────────────────────────────────────────────────────────

  // Shared fullscreen quad vertex — used by both update and fade passes
  var QUAD_VS = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = aPos * 0.5 + 0.5;',          // NDC [-1,1] → UV [0,1]
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  // Physics update — one fragment per particle, reads old state, writes new state
  var UPDATE_FS = [
    'precision highp float;',
    'uniform sampler2D uState;',
    'uniform float uTime;',
    'uniform vec2  uResolution;',
    'uniform int   uNumTips;',
    'uniform vec2  uTips[10];',
    'uniform vec2  uFlows[10];',
    'uniform int   uFoxGesture;',
    'uniform int   uHandMoving;',
    'uniform int   uVolumeSpike;',
    'varying vec2 vUv;',
    '',
    'float hash21(vec2 p) {',
    '  p = fract(p * vec2(127.1, 311.7));',
    '  p += dot(p, p + 19.19);',
    '  return fract(p.x * p.y);',
    '}',
    'float vnoise(vec2 p) {',
    '  vec2 i = floor(p), f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  return mix(',
    '    mix(hash21(i),              hash21(i + vec2(1.0, 0.0)), f.x),',
    '    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),',
    '  f.y);',
    '}',
    'vec2 curlNoise(vec2 p, float t) {',
    '  const float E = 0.0015;',
    '  const float F = 1.5;',
    '  float n_py = vnoise((p + vec2(0.0,  E)) * F + t);',
    '  float n_my = vnoise((p - vec2(0.0,  E)) * F + t);',
    '  float n_px = vnoise((p + vec2(E,  0.0)) * F + t);',
    '  float n_mx = vnoise((p - vec2(E,  0.0)) * F + t);',
    '  return vec2((n_py - n_my) / (2.0 * E), -(n_px - n_mx) / (2.0 * E));',
    '}',
    '',
    'void main() {',
    '  vec4 state = texture2D(uState, vUv);',
    '  vec2 pos   = state.rg;',
    '  vec2 vel   = state.ba;',
    '',
    '  float t = uTime * 0.08 + hash21(pos) * 3.14;',
    '  vel += curlNoise(pos, t) * 0.00055;',
    '',
    '  vel.y -= 0.000065;',
    '',
    '  float radius  = uHandMoving == 1 ? 0.22 : 0.14;',
    '  float foxSign = uFoxGesture == 1 ? -1.0 : 1.0;',
    '  for (int i = 0; i < 10; i++) {',
    '    if (i >= uNumTips) break;',
    '    vec2  diff = pos - uTips[i];',
    '    float dist = length(diff);',
    '    if (dist < radius && dist > 0.001) {',
    '      float f = 1.0 - dist / radius;',
    '      float s = f * f * 0.013;',
    '      vel += foxSign * normalize(diff) * s;',
    '      vel += (uFlows[i] / uResolution) * 0.014 * f;',
    '    }',
    '  }',
    '',
    '  if (uVolumeSpike == 1) {',
    '    vec2 dir = pos - vec2(0.5);',
    '    if (length(dir) > 0.001) vel += normalize(dir) * 0.009;',
    '  }',
    '',
    '  vel *= 0.963;',
    '  float spd = length(vel);',
    '  if (spd > 0.02) vel = normalize(vel) * 0.02;',
    '',
    '  pos = fract(pos + vel + 1.0);',
    '  gl_FragColor = vec4(pos, vel);',
    '}'
  ].join('\n');

  // Render vertex — reads position from state texture by particle index
  var RENDER_VS = [
    'attribute float aIndex;',
    'uniform sampler2D uState;',
    'uniform vec2 uTexSize;',
    'uniform int  uNumTips;',
    'uniform vec2 uTips[10];',
    'uniform int  uFoxGesture;',
    'varying float vBright;',
    'varying float vFox;',
    'void main() {',
    '  float col = mod(aIndex, uTexSize.x) + 0.5;',
    '  float row = floor(aIndex / uTexSize.x) + 0.5;',
    '  vec4 state = texture2D(uState, vec2(col, row) / uTexSize);',
    '  vec2 pos = state.rg;',
    '',
    '  vec2 clip = pos * 2.0 - 1.0;',
    '  clip.y = -clip.y;',
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '',
    '  float bright = 0.55;',
    '  for (int i = 0; i < 10; i++) {',
    '    if (i >= uNumTips) break;',
    '    float d = length(pos - uTips[i]);',
    '    bright += max(0.0, 1.0 - d / 0.14);',
    '  }',
    '  bright = clamp(bright, 0.3, 1.8);',
    '  gl_PointSize = 1.5 + min((bright - 0.3) * 0.9, 3.2);',
    '  vBright = bright;',
    '  vFox    = float(uFoxGesture);',
    '}'
  ].join('\n');

  var RENDER_FS = [
    'precision mediump float;',
    'varying float vBright;',
    'varying float vFox;',
    'void main() {',
    '  vec2  c = gl_PointCoord - 0.5;',
    '  float d = length(c);',
    '  if (d > 0.5) discard;',
    '  float a = 1.0 - d * 2.0;',
    '  a = a * a;',
    '  vec3 teal   = vec3(0.28, 0.82, 0.92);',
    '  vec3 golden = vec3(1.00, 0.75, 0.22);',
    '  vec3 col = mix(teal, golden, vFox) * vBright;',
    '  gl_FragColor = vec4(col * a, a * 0.80);',
    '}'
  ].join('\n');

  // Fade — darkens the previous frame each tick for trail decay
  var FADE_FS = [
    'precision mediump float;',
    'uniform float uFade;',
    'void main() {',
    '  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - uFade);',
    '}'
  ].join('\n');

  // ─── Stage.Effect ─────────────────────────────────────────────────────────────

  Stage.Particles = Stage.Effect.extend({
    name: 'particles',

    initialize: function (ctx) {
      var gl = ctx.gl;
      this.gl   = gl;
      this.time = 0;
      this.ready = false;

      if (!gl.getExtension('OES_texture_float')) {
        console.warn('[gpu-canvas] OES_texture_float not supported — disabled');
        return;
      }
      if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 1) {
        console.warn('[gpu-canvas] Vertex texture fetch not supported — disabled');
        return;
      }

      this.updateProg = this._link(QUAD_VS,    UPDATE_FS);
      this.renderProg = this._link(RENDER_VS,  RENDER_FS);
      this.fadeProg   = this._link(QUAD_VS,    FADE_FS);
      if (!this.updateProg || !this.renderProg || !this.fadeProg) return;

      // Seed initial particle state: random positions, tiny random velocities
      var data = new Float32Array(N * 4);
      for (var i = 0; i < N; i++) {
        data[i*4]     = Math.random();
        data[i*4 + 1] = Math.random();
        data[i*4 + 2] = (Math.random() - 0.5) * 0.002;
        data[i*4 + 3] = (Math.random() - 0.5) * 0.002;
      }
      this.stateTex = [
        this._floatTex(TEX_W, TEX_H, data),  // read source
        this._floatTex(TEX_W, TEX_H, null),  // write target
      ];
      this.stateIdx = 0;

      this.fbo = gl.createFramebuffer();

      // Fullscreen quad (2 triangles, NDC)
      this.quadBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER,
        new Float32Array([-1,-1, 1,-1, -1,1, 1,-1, 1,1, -1,1]),
        gl.STATIC_DRAW);

      // Per-particle index buffer [0, 1, … N-1] — used by render vertex shader
      var idx = new Float32Array(N);
      for (var i = 0; i < N; i++) idx[i] = i;
      this.indexBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuf);
      gl.bufferData(gl.ARRAY_BUFFER, idx, gl.STATIC_DRAW);

      // Cache uniform locations
      this.uUpd = this._locs(this.updateProg, [
        'uState', 'uTime', 'uResolution', 'uNumTips',
        'uTips', 'uFlows', 'uFoxGesture', 'uHandMoving', 'uVolumeSpike'
      ]);
      this.uRen = this._locs(this.renderProg, [
        'uState', 'uTexSize', 'uNumTips', 'uTips', 'uFoxGesture'
      ]);
      this.uFad = this._locs(this.fadeProg, ['uFade']);

      this.tipArr  = new Float32Array(20);
      this.flowArr = new Float32Array(20);

      gl.clearColor(0.01, 0.01, 0.02, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      this.ready = true;
      console.log('[gpu-canvas] %d particles — WebGL1 texture ping-pong', N);
    },

    update: function (ctx) {
      if (!this.ready) return;
      var gl = this.gl;
      this.time += 0.016;

      var W = gl.canvas.width;
      var H = gl.canvas.height;

      if (typeof updateHandDetection === 'function') updateHandDetection(W, H);

      var tips   = typeof fingertips  !== 'undefined' ? fingertips  : [];
      var flows  = typeof flowVectors !== 'undefined' ? flowVectors : [];
      var fox    = typeof foxGesture  !== 'undefined' && foxGesture  ? 1 : 0;
      var moving = typeof handMoving  !== 'undefined' && handMoving  ? 1 : 0;
      var spike  = typeof volumeSpike !== 'undefined' && volumeSpike ? 1 : 0;

      var numTips = Math.min(tips.length, 10);
      this.tipArr.fill(0);
      this.flowArr.fill(0);
      for (var i = 0; i < numTips; i++) {
        this.tipArr[i*2]     = tips[i].x / W;
        this.tipArr[i*2 + 1] = tips[i].y / H;
        if (flows[i]) {
          this.flowArr[i*2]     = flows[i].vx;
          this.flowArr[i*2 + 1] = flows[i].vy;
        }
      }

      var readTex  = this.stateTex[this.stateIdx];
      var writeTex = this.stateTex[1 - this.stateIdx];

      // ── 1. Physics update → writeTex ─────────────────────────────────────────
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, writeTex, 0);
      gl.viewport(0, 0, TEX_W, TEX_H);
      gl.disable(gl.BLEND);

      gl.useProgram(this.updateProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(this.uUpd.uState, 0);
      gl.uniform1f(this.uUpd.uTime, this.time);
      gl.uniform2f(this.uUpd.uResolution, W, H);
      gl.uniform1i(this.uUpd.uNumTips, numTips);
      gl.uniform2fv(this.uUpd.uTips, this.tipArr);
      gl.uniform2fv(this.uUpd.uFlows, this.flowArr);
      gl.uniform1i(this.uUpd.uFoxGesture, fox);
      gl.uniform1i(this.uUpd.uHandMoving, moving);
      gl.uniform1i(this.uUpd.uVolumeSpike, spike);
      this._quad(this.updateProg);

      // ── 2. Switch back to screen ──────────────────────────────────────────────
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);

      // ── 3. Fade — darken previous frame for trail decay ───────────────────────
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.fadeProg);
      gl.uniform1f(this.uFad.uFade, 0.82);
      this._quad(this.fadeProg);

      // ── 4. Render particles ───────────────────────────────────────────────────
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(this.renderProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, writeTex);
      gl.uniform1i(this.uRen.uState, 0);
      gl.uniform2f(this.uRen.uTexSize, TEX_W, TEX_H);
      gl.uniform1i(this.uRen.uNumTips, numTips);
      gl.uniform2fv(this.uRen.uTips, this.tipArr);
      gl.uniform1i(this.uRen.uFoxGesture, fox);

      var aIdx = gl.getAttribLocation(this.renderProg, 'aIndex');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuf);
      gl.enableVertexAttribArray(aIdx);
      gl.vertexAttribPointer(aIdx, 1, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, N);
      gl.disableVertexAttribArray(aIdx);
      gl.disable(gl.BLEND);

      this.stateIdx = 1 - this.stateIdx;
    },

    resize: function (ctx) {
      if (this.gl) this.gl.viewport(0, 0, ctx.width, ctx.height);
    },

    // ── Private helpers ───────────────────────────────────────────────────────

    _link: function (vsSrc, fsSrc) {
      var gl = this.gl;
      function compile(type, src) {
        var sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          console.error('[gpu-canvas] Shader error:', gl.getShaderInfoLog(sh));
          return null;
        }
        return sh;
      }
      var vs = compile(gl.VERTEX_SHADER,   vsSrc);
      var fs = compile(gl.FRAGMENT_SHADER, fsSrc);
      if (!vs || !fs) return null;
      var prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('[gpu-canvas] Link error:', gl.getProgramInfoLog(prog));
        return null;
      }
      return prog;
    },

    _floatTex: function (w, h, data) {
      var gl = this.gl;
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.FLOAT, data || null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return tex;
    },

    _quad: function (prog) {
      var gl = this.gl;
      var a = gl.getAttribLocation(prog, 'aPos');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disableVertexAttribArray(a);
    },

    _locs: function (prog, names) {
      var gl = this.gl;
      gl.useProgram(prog);
      var o = {};
      for (var i = 0; i < names.length; i++) o[names[i]] = gl.getUniformLocation(prog, names[i]);
      return o;
    }
  });

  // ─── Bootstrap ────────────────────────────────────────────────────────────────

  var canvas = document.createElement('canvas');
  canvas.id = 'gpu-canvas';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;';
  document.body.appendChild(canvas);

  function resizeCanvas() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  var renderer;
  try {
    renderer = new Stage.Renderer(canvas, {
      gl: { preserveDrawingBuffer: true, alpha: false, antialias: false }
    });
  } catch (e) {
    console.warn('[gpu-canvas] WebGL not supported:', e);
    canvas.remove();
    return;
  }

  renderer.effect(new Stage.Particles()).render();

})();
