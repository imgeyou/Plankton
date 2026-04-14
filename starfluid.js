(function () {
  var canvas = document.createElement('canvas');
  canvas.id = 'starfluid-canvas';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;';
  document.body.insertBefore(canvas, document.body.firstChild);
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  var renderer;
  try {
    renderer = new Stage.Renderer(canvas);
  } catch (e) {
    console.warn('StarFluid: WebGL not supported', e);
    return;
  }

  var gl = renderer.context.gl;
  if (!gl.getExtension('OES_texture_float') || !gl.getExtension('OES_texture_float_linear')) {
    console.warn('StarFluid: float textures not supported');
    return;
  }

  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.clearColor(0.0, 0.0, 0.0, 1.0);

  var motionEff     = new Stage.Motion();
  var fluidEff      = new Stage.Fluid();
  var particlesEff  = new Stage.Particles();
  var visualizerEff = new Stage.Visualizer();

  renderer
    .effect(motionEff)
    .effect(fluidEff)
    .effect(particlesEff)
    .effect(visualizerEff)
    .render();

  // ── Velocity readback ─────────────────────────────────────────────────────
  // Read the solver's velocity texture (vx=R, vy=G) into a JS array each frame
  // so effect.js particles can be advected by the real WebGL fluid.
  var READBACK_SIZE = 64;
  var velocityReadback = new Float32Array(READBACK_SIZE * READBACK_SIZE * 4);
  var readbackSupported = null; // null=untested, true=ok, false=unsupported
  var _readbackFrame = 0;

  function doReadback() {
    requestAnimationFrame(doReadback);
    if (readbackSupported === false) return;
    if (++_readbackFrame % 3 !== 0) return; // only readback every 3 frames
    var solver = fluidEff && fluidEff.solver;
    if (!solver || !solver.frameBuffer || !solver.output) return;
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, solver.frameBuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, solver.output, 0);
      // Read top-left READBACK_SIZE x READBACK_SIZE region of the 256x256 solver
      gl.readPixels(0, 0, READBACK_SIZE, READBACK_SIZE, gl.RGBA, gl.FLOAT, velocityReadback);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (gl.getError() !== gl.NO_ERROR) { readbackSupported = false; return; }
      readbackSupported = true;
      window.webglFluidVelocity = { data: velocityReadback, w: READBACK_SIZE, h: READBACK_SIZE };
    } catch (e) {
      readbackSupported = false;
      console.warn('StarFluid: float velocity readback not supported, particles will use CPU flow field', e);
    }
  }
  doReadback();

  window.addEventListener('resize', function () {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });

  var prevTips = [];

  window.starfluid = {
    inject: function (fingertips) {
      fingertips.forEach(function (tip, i) {
        var nx = 1 - tip.x;                       // mirror x (front-facing camera)
        var ny = 1 - tip.y;                        // flip y for WebGL (y=1 at top)
        var prev = prevTips[i] || { x: tip.x, y: tip.y };
        var du = nx - (1 - prev.x);
        var dv = ny - (1 - prev.y);

        motionEff.injectPoint(nx, ny, du, dv);
        particlesEff.injectPoint(nx, ny);
      });

      prevTips = fingertips.slice();
      if (fingertips.length === 0) prevTips = [];
    }
  };
})();
