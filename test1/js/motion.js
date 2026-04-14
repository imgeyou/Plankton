
(function() {

  var CELLS = 256;

  Stage.Motion = Stage.Effect.extend({
    name: "motion",

    initialize: function (ctx) {
      this.ctx = ctx;

      var gl = ctx.gl;

      this.uniforms = {
        point: { type: "2f", value: [0, 0] },
        dye: { type: "1f", value: 0.0 },
        velocity: { type: "2f", value: [0, 0] },
        ratio: { type: "1f", value: ctx.aspect },
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

    // Called externally by cpu-canvas.js for hand-tracking injection
    injectPoint: function (nx, ny, du, dv) {
      this.uniforms.point.value = [nx, ny];
      this.uniforms.velocity.value = [du, dv];
      this.uniforms.dye.value = 1.0;
    },

    update: function (ctx) {
      this.ctx = ctx;
      this.motion.render();
      this.uniforms.velocity.value = [0, 0];
      this.uniforms.dye.value = 0;
    },

    resize: function (ctx) {
      this.ctx = ctx;
      this.uniforms.ratio.value = ctx.aspect;
    },
  });

})();
