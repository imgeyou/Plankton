
(function() {

  var CELLS = 256;

  Stage.Motion = Stage.Effect.extend({
    name: "motion",

    initialize: function (ctx) {
      this.ctx = ctx;

      var gl = ctx.gl;

      this.uniforms = {
        uPoint:    { type: "2f", value: [0, 0] },
        uVelocity: { type: "2f", value: [0, 0] },
        ratio:     { type: "1f", value: ctx.aspect },
      };

      this.motion = new RTT(gl, {
        width: CELLS,
        height: CELLS,
        texture: { type: gl.FLOAT },
      })
        .fragment(
          document.getElementById("fluid-motion").textContent,
          this.uniforms,
        )
        .render();
    },

    update: function (ctx) {
      this.ctx = ctx;

    
    // ── Call hand detection update (was in cpu-canvas.js draw loop) 
    if (typeof updateHandDetection === "function") {
      updateHandDetection();
    }
    var f = typeof flowVector !== 'undefined' ? flowVector : null;
    if(flowVector){
      this.uniforms.uPoint.value = [f.x, f.y];
    this.uniforms.uVelocity.value = [f.vx, f.vy];
    } else {
      this.uniforms.uPoint.value = [0, 0];
      this.uniforms.uVelocity.value = [0, 0];
    }
  },

    resize: function (ctx) {
      this.ctx = ctx;
      this.uniforms.ratio.value = ctx.aspect;
    },
  });

})();
