// webgl-particles.js

// Reads each frame (globals set by detection.js):
//   fingertips   — [{x,y}] screen-pixel positions, x-mirrored to match canvas
//   flowVectors  — [{x,y,vx,vy}] per-fingertip velocity in screen pixels/frame
//   foxGesture   — boolean: index+pinky up (attract mode)
//   handMoving   — boolean: hand moving faster than threshold
//   volumeSpike  — boolean: mic volume spiked
//
// Architecture:
//   Two ping-pong VBO sets (A / B) each holding [pos.xy, vel.xy] per particle.
//   Transform Feedback updates physics entirely on the GPU each frame.
//   A fade quad dims the previous frame to create glowing trails.

(function () {
  // ----- Dark background
  document.documentElement.style.background = "#000";
  document.body.style.background = "#000";

  // ------- Canvas
  const canvas = document.getElementById("webgl-canvas");

  const gl = canvas.getContext("webgl2", {
    alpha: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true, // keep frame content for trail fade
    antialias: false,
  });


  // ------ webgl suppport check
  if (!gl) {
    console.warn("[webgl-particles] WebGL2 not supported — disabled.");
    canvas.remove();
    return;
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();
  window.addEventListener("resize", resize);

  // ----- Load shaders from DOM (injected by shaders/load-shaders.js)
  const FADE_VS   = document.getElementById("wp-fade-vert").textContent;
  const FADE_FS   = document.getElementById("wp-fade-frag").textContent;
  const DUMMY_FS  = document.getElementById("wp-dummy-frag").textContent;
  const UPDATE_VS = document.getElementById("wp-update-vert").textContent;
  const RENDER_VS = document.getElementById("wp-render-vert").textContent;
  const RENDER_FS = document.getElementById("wp-render-frag").textContent;

  // ----- Compile helpers 
  function compileShader(type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(
        "[webgl-particles] Shader compile error:\n",
        gl.getShaderInfoLog(shader),
      );
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function linkProgram(vsSrc, fsSrc, tfVaryings) {
    const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);

    if (fsSrc) {
      const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
      if (!fs) return null;
      gl.attachShader(prog, fs);
    }
    if (tfVaryings) {
      gl.transformFeedbackVaryings(prog, tfVaryings, gl.SEPARATE_ATTRIBS);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(
        "[webgl-particles] Link error:\n",
        gl.getProgramInfoLog(prog),
      );
      return null;
    }
    return prog;
  }

  // ─── Programs ───────────────────────────────────────────────────────────────
  const fadeProg = linkProgram(FADE_VS, FADE_FS);
  const updateProg = linkProgram(UPDATE_VS, DUMMY_FS, ["vPos", "vVel"]);
  const renderProg = linkProgram(RENDER_VS, RENDER_FS);
  if (!fadeProg || !updateProg || !renderProg) return;

  // ─── Particle buffers ───────────────────────────────────────────────────────
  const N = 30000;

  const initPos = new Float32Array(N * 2);
  const initVel = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    initPos[i * 2] = Math.random();
    initPos[i * 2 + 1] = Math.random();
    initVel[i * 2] = (Math.random() - 0.5) * 0.002;
    initVel[i * 2 + 1] = (Math.random() - 0.5) * 0.002;
  }

  function makeBufs(posData, velData) {
    const pos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, posData, gl.DYNAMIC_COPY);

    const vel = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vel);
    gl.bufferData(gl.ARRAY_BUFFER, velData, gl.DYNAMIC_COPY);

    return { pos, vel };
  }

  const bufA = makeBufs(initPos, initVel);
  const bufB = makeBufs(new Float32Array(N * 2), new Float32Array(N * 2));

  function makeVAO(buf) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.vel);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  function makeTF(buf) {
    const tf = gl.createTransformFeedback();
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buf.pos);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, buf.vel);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    return tf;
  }

  const vaoA = makeVAO(bufA);
  const vaoB = makeVAO(bufB);
  // Clear ARRAY_BUFFER after VAO setup — makeVAO leaves bufB.vel bound to
  // ARRAY_BUFFER; if tfB later writes to bufB.vel, WebGL sees the same buffer
  // on two targets simultaneously → GL_INVALID_OPERATION.
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const tfA = makeTF(bufA); // tfA  writes INTO bufA
  const tfB = makeTF(bufB); // tfB  writes INTO bufB

  // idx=0: read vaoA → write tfB (→bufB) → render vaoB
  // idx=1: read vaoB → write tfA (→bufA) → render vaoA
  const vaos = [vaoA, vaoB];
  const tfs = [tfB, tfA];
  let idx = 0;

  // ─── Uniforms ───────────────────────────────────────────────────────────────
  function locs(prog, names) {
    gl.useProgram(prog);
    const out = {};
    for (const n of names) out[n] = gl.getUniformLocation(prog, n);
    return out;
  }

  const fadeU = locs(fadeProg, ["uFade"]);
  const updU = locs(updateProg, [
    "uTime",
    "uResolution",
    "uNumTips",
    "uTips",
    "uFlows",
    "uFoxGesture",
    "uHandMoving",
    "uVolumeSpike",
  ]);
  const renU = locs(renderProg, ["uNumTips", "uTips", "uFoxGesture"]);

  const tipArr = new Float32Array(20);
  const flowArr = new Float32Array(20);

  // ─── Initial clear ──────────────────────────────────────────────────────────
  gl.clearColor(0.01, 0.01, 0.02, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // ─── Render loop ────────────────────────────────────────────────────────────
  let time = 0;

  function frame() {
    requestAnimationFrame(frame);
    time += 0.016;

    const W = canvas.width;
    const H = canvas.height;

    // ── Call hand detection update (was in cpu-canvas.js draw loop) ──────────
    if (typeof updateHandDetection === "function") {
      updateHandDetection(W, H);
    }

    // ── Gather detection globals ──────────────────────────────────────────────
    const tips = typeof fingertips !== "undefined" ? fingertips : [];
    const flows = typeof flowVectors !== "undefined" ? flowVectors : [];
    const fox = typeof foxGesture !== "undefined" && foxGesture ? 1 : 0;
    const moving = typeof handMoving !== "undefined" && handMoving ? 1 : 0;
    const spike = typeof volumeSpike !== "undefined" && volumeSpike ? 1 : 0;

    const numTips = Math.min(tips.length, 10);
    tipArr.fill(0);
    flowArr.fill(0);
    for (let i = 0; i < numTips; i++) {
      tipArr[i * 2] = tips[i].x / W;
      tipArr[i * 2 + 1] = tips[i].y / H;
      if (flows[i]) {
        flowArr[i * 2] = flows[i].vx;
        flowArr[i * 2 + 1] = flows[i].vy;
      }
    }

    const readVAO = vaos[idx];
    const writeTF = tfs[idx];
    const drawVAO = vaos[1 - idx]; // render from the just-written buffer

    // ------ 1. Fade pass — darken previous frame for trail effect 
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA); // result = dst * (1 - srcAlpha)
    gl.useProgram(fadeProg);
    gl.uniform1f(fadeU.uFade, 0.82); // retain 89% brightness per frame
    gl.drawArrays(gl.TRIANGLES, 0, 3); // fullscreen triangle, no VAO needed

    // ------ 2. Update pass 
    gl.disable(gl.BLEND);
    gl.useProgram(updateProg);
    gl.uniform1f(updU.uTime, time);
    gl.uniform2f(updU.uResolution, W, H);
    gl.uniform1i(updU.uNumTips, numTips);
    gl.uniform2fv(updU.uTips, tipArr);
    gl.uniform2fv(updU.uFlows, flowArr);
    gl.uniform1i(updU.uFoxGesture, fox);
    gl.uniform1i(updU.uHandMoving, moving);
    gl.uniform1i(updU.uVolumeSpike, spike);

    gl.bindBuffer(gl.ARRAY_BUFFER, null); // ensure no ARRAY_BUFFER overlaps TF outputs
    gl.bindVertexArray(readVAO);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, writeTF);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, N);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);

    // ── 3. Render pass — draw updated particles ───────────────────────────────
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive for glow
    gl.useProgram(renderProg);
    gl.uniform1i(renU.uNumTips, numTips);
    gl.uniform2fv(renU.uTips, tipArr);
    gl.uniform1i(renU.uFoxGesture, fox);

    gl.bindVertexArray(drawVAO);
    gl.drawArrays(gl.POINTS, 0, N);
    gl.bindVertexArray(null);

    idx = 1 - idx;
  }

  requestAnimationFrame(frame);
  console.log("[webgl-particles] %d particles — WebGL2 Transform Feedback", N);
})();
