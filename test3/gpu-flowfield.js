// this is for reading velocityData from webGL
// velocityData stored in window.webglFluidVelocity. Used in P5.js to direct particles movement

//use IIFE bcs the referenced set-up library uses it.

(function(){
  // ------ set up canvas
  var canvas = document.createElement("canvas");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = "none"; //hidden flowfield, only for directing movement
  document.body.appendChild(canvas);

  // ------ browser support check
  var renderer;
  try {
    renderer = new Stage.Renderer(canvas);
  } catch (e) {
    console.warn("WebGL not supported", e);
    return;
  }

  var gl = renderer.context.gl;
  if (
    !gl.getExtension("OES_texture_float") ||
    !gl.getExtension("OES_texture_float_linear")
  ) {
    console.warn("Float textures not supported; CPU fallback will be used");
    return;
  }

  // ------ render fluid motion -> velocity texture
  var motionEffect = new Stage.Motion();
  var fluidEffect = new Stage.Fluid();

  renderer.effect(motionEffect).effect(fluidEffect).render();

  // ----- CPU read back flow field velocity data
  var readbackSize = 64;
  var velocityData = new Float32Array(readbackSize * readbackSize * 4);
  var readbackReady = null; // null->untested, true->ok, false->unsupported
  var frame = 0;
  doReadback(); //velocityData stored in window.webglFluidVelocity
  
  function doReadback() {
    requestAnimationFrame(doReadback);
    if (readbackReady === false) return;
    if (++frame % 3 !== 0) return; // only every 3 frames to reduce GPU stall

    var solver = fluidEffect.solver;
    if (!solver || !solver.frameBuffer || !solver.output) return;

    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, solver.frameBuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        solver.output,
        0,
      );

      gl.readPixels(
        0,
        0,
        readbackSize,
        readbackSize,
        gl.RGBA,
        gl.FLOAT,
        velocityData,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      if (gl.getError() !== gl.NO_ERROR) {
        readbackReady = false;
        return;
      }
      readbackReady = true;

      window.webglFluidVelocity = {
        data: velocityData,
        w: readbackSize,
        h: readbackSize,
      };
    } catch (e) {
      readbackReady = false;
      console.warn(
        "GPUFluid: readback not supported, falling back to CPU solver",
        e,
      );
    }
  }
})();