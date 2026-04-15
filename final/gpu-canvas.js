//this is for the webGL canvas, reading flowvector from detection.js and let it influence particle movement
//render: subtle particle flows (resembling water flow in the foreground)

(function () {
  // ------- Canvas
  const canvas = document.getElementById("webgl-canvas");

  const gl = canvas.getContext("webgl2", {
    alpha: true,
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
  const fadeVer = document.getElementById("wp-fade-vert").textContent.trim();
  const fadeFra = document.getElementById("wp-fade-frag").textContent.trim();
  const emptyFra = document.getElementById("wp-dummy-frag").textContent.trim();
  const updateVer = document.getElementById("wp-update-vert").textContent.trim();
  const renderVer = document.getElementById("wp-render-vert").textContent.trim();
  const renderFra = document.getElementById("wp-render-frag").textContent.trim();

  // ----- build Programs with compiled shaders
  const fadeProg = linkProgram(fadeVer, fadeFra);
  const updateProg = linkProgram(updateVer, emptyFra, ["vPos", "vVel"]);
  const renderProg = linkProgram(renderVer, renderFra);
  if (!fadeProg || !updateProg || !renderProg) return;


  // ----- Initialise Particles
  
  //particle num
  const N = 30000;

  const initPos = new Float32Array(N * 2);// [x0, y0, x1, y1, ...]
  const initVel = new Float32Array(N * 2);

  //random pos between 0-1 (tex-Coor)
  //random vel between -0.001 and +0.001 with random offset
  for (let i = 0; i < N; i++) {
    initPos[i * 2] = Math.random();
    initPos[i * 2 + 1] = Math.random();
    initVel[i * 2] = (Math.random() - 0.5) * 0.002;
    initVel[i * 2 + 1] = (Math.random() - 0.5) * 0.002;
  }

  //set up two buffers: ping-pong
  const bufA = makeBufs(initPos, initVel); // initial/old
  const bufB = makeBufs(new Float32Array(N * 2), new Float32Array(N * 2)); //updated

  //VAO: set up how vertex attributes read from buffers
  const vaoA = makeVAO(bufA);
  const vaoB = makeVAO(bufB);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  const vaos = [vaoA, vaoB];
  
  //write shader output of pos and vel back to buffers (switch places)
  const tfA = makeTF(bufA);
  const tfB = makeTF(bufB);
  const tfs = [tfB, tfA];

  //get uniforms from program
  const fadeU = locs(fadeProg, ["uFade"]);
  const updU = locs(updateProg, ["uTime", "uHasHand", "uTip", "uFlow", "uIndexOnly", "uHandMoving", "uVolumeSpike"]);
  const renU = locs(renderProg, ["uHasHand", "uTip", "uIndexOnly"]);

  // ---- Initial clear
  gl.clearColor(0.01, 0.01, 0.02, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // ------ Render loop 
  let time = 0;
  let idx = 0;
  requestAnimationFrame(frame);

  // ------- helper functions ---------------------------

  // ----------- A. for shaders
  //1. Compile shaders
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
  //2. compile shaders to a program
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
      console.error("[webgl-particles] Link error:\n",
        gl.getProgramInfoLog(prog),
      );
      return null;
    }
    return prog;
  }

  //3. Return all uniform values from shader
  function locs(prog, names) {
    gl.useProgram(prog);
    const out = {};
    for (const n of names) out[n] = gl.getUniformLocation(prog, n);
    return out;
  }

  // ----------- B. for Data
  //1. create buffers for position and velocity data
  function makeBufs(posData, velData) {
    const pos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, posData, gl.DYNAMIC_COPY);

    const vel = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vel);
    gl.bufferData(gl.ARRAY_BUFFER, velData, gl.DYNAMIC_COPY);

    return { pos, vel };
  }

  //2. create VAO and set up how vertex attributes read from buffers
  function makeVAO(buf) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    // attribute 0 for position
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // attribute 1 for velocity
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.vel);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    // Unbind
    gl.bindVertexArray(null);
    return vao;
  }

  //3. write shader output of pos and vel back to buffers
  function makeTF(buf) {
    const tf = gl.createTransformFeedback();
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buf.pos);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, buf.vel);

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    return tf;
  }

// -------------- C. for Render
  function frame() {
    //initialise
    requestAnimationFrame(frame);
    time += 0.016;

    // ----- read states from detection.js
    const hasHand = typeof flowVectorWH !== "undefined" && flowVectorWH ? 1 : 0;
    const indexOnlyFlag = typeof indexOnly !== "undefined" && indexOnly ? 1 : 0;

    // attract mode uses index tip; general flow uses the full-hand average
    const activeTip = (indexOnlyFlag && indexTipWH) ? indexTipWH : flowVectorWH;
    const fingerTip = hasHand ? [activeTip.x_WH, activeTip.y_WH] : [0, 0];
    const flowVec   = hasHand ? [activeTip.vx_WH, activeTip.vy_WH] : [0, 0];
    const moving = typeof handMoving !== "undefined" && handMoving ? 1 : 0;
    const spike = typeof volumeSpike !== "undefined" && volumeSpike ? 1 : 0;

    const readVAO = vaos[idx];
    const writeTF = tfs[idx];
    const drawVAO = vaos[1 - idx];

    // ------ 1. Fade 
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(fadeProg);
    gl.uniform1f(fadeU.uFade, 0.82); //set fadespeed
    gl.drawArrays(gl.TRIANGLES, 0, 3);//full screen triangle

    // -------- 2. Update
    gl.disable(gl.BLEND);
    gl.useProgram(updateProg);
    // update time count
    gl.uniform1f(updU.uTime, time);
    // update states
    gl.uniform1i(updU.uHasHand, hasHand);
    gl.uniform2fv(updU.uTip, fingerTip);
    gl.uniform2fv(updU.uFlow, flowVec);
    gl.uniform1i(updU.uIndexOnly, indexOnlyFlag);
    gl.uniform1i(updU.uHandMoving, moving);
    gl.uniform1i(updU.uVolumeSpike, spike);

    //update buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(readVAO);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, writeTF);
    gl.enable(gl.RASTERIZER_DISCARD);//don't draw
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, N);//Run vertex shader on all particles
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);//don't draw
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);

    // -------- 3. Render
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(renderProg);
    gl.uniform1i(renU.uHasHand, hasHand);
    gl.uniform2fv(renU.uTip, fingerTip);
    gl.uniform1i(renU.uIndexOnly, indexOnlyFlag);

    gl.bindVertexArray(drawVAO);
    gl.drawArrays(gl.POINTS, 0, N);
    gl.bindVertexArray(null);

    idx = 1 - idx; //switch places for two buffers
  }

})();