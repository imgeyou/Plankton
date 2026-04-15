//this is for the webGL canvas, reading flowvector from detection.js and let it influence particle movement
//render: subtle particle flows (resembling water flow in the foreground)

(function () {
  // ----- Dark background-> later will be blended with CPU canvas
  document.documentElement.style.background = "#000";
  document.body.style.background = "#000";

  // ------- Canvas
  const canvas = document.getElementById("webgl-canvas");

  const gl = canvas.getContext("webgl2", {
    alpha: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
  });

  // ------ webgl support check
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

  // ----- Load shaders from DOM
  const fadeVer   = document.getElementById("wp-fade-vert").textContent.trim();
  const fadeFra   = document.getElementById("wp-fade-frag").textContent.trim();
  const emptyFra  = document.getElementById("wp-dummy-frag").textContent.trim();
  const updateVer = document.getElementById("wp-update-vert").textContent.trim();
  const renderVer = document.getElementById("wp-render-vert").textContent.trim();
  const renderFra = document.getElementById("wp-render-frag").textContent.trim();

  // ----- Compile shaders 
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
    if (!vs) return null;
    
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

  // ----- Programs 
  const fadeProg = linkProgram(fadeVer, fadeFra);
  const updateProg = linkProgram(updateVer, emptyFra, ["vPos", "vVel"]);
  const renderProg = linkProgram(renderVer, renderFra);
  if (!fadeProg || !updateProg || !renderProg) return;

  // ----- Particle buffers 
  //particle num
  const N = 30000;

  const initPos = new Float32Array(N * 2);
  const initVel = new Float32Array(N * 2);

  for (let i = 0; i < N; i++) {
    initPos[i * 2] = Math.random();
    initPos[i * 2 + 1] = Math.random();
    initVel[i * 2] = (Math.random() - 0.5) * 0.002;
    initVel[i * 2 + 1] = (Math.random() - 0.5) * 0.002;
  }

  //bind buffer for pos and velocity
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
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const tfA = makeTF(bufA);
  const tfB = makeTF(bufB);

  const vaos = [vaoA, vaoB];
  const tfs = [tfB, tfA];
  let idx = 0;

  // ----- Uniforms 
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

  // ---- Initial clear 
  gl.clearColor(0.01, 0.01, 0.02, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // ----- Render loop 
  let time = 0;

  function frame() {
    requestAnimationFrame(frame);
    time += 0.016;

    // ----- Gather states from detection.js 
    let W = canvas.width;
    let H = canvas.height;
    let numTips = 0;
    let tipArr = [0, 0];
    let flowArr = [0, 0];
    
    if (typeof flowVectorWH !== "undefined" && flowVectorWH) {
      numTips = 1;
      tipArr = [flowVectorWH.x_WH, flowVectorWH.y_WH];
      flowArr = [flowVectorWH.vx_WH, flowVectorWH.vy_WH];
    }
    
    const fox = typeof foxGesture !== "undefined" && foxGesture ? 1 : 0;
    const moving = typeof handMoving !== "undefined" && handMoving ? 1 : 0;
    const spike = typeof volumeSpike !== "undefined" && volumeSpike ? 1 : 0;

    const readVAO = vaos[idx];
    const writeTF = tfs[idx];
    const drawVAO = vaos[1 - idx];

    // ------ 1. Fade pass
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(fadeProg);
    gl.uniform1f(fadeU.uFade, 0.82);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

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

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(readVAO);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, writeTF);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, N);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);

    // ------ 3. Render pass
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
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