
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

      // Average all available fingertip positions and velocities
      var tips  = typeof fingertips  !== 'undefined' ? fingertips  : [];
      var flows = typeof flowVectors !== 'undefined' ? flowVectors : [];
      var n = tips.length;

      if (n > 0) {
        var ax = 0, ay = 0, avx = 0, avy = 0;
        for (var i = 0; i < n; i++) {
          ax  += tips[i].x;
          ay  += tips[i].y;
          if (flows[i]) { avx += flows[i].vx; avy += flows[i].vy; }
        }
        this.uniforms.uPoint.value    = [ax / n / ctx.width,  ay / n / ctx.height];
        this.uniforms.uVelocity.value = [avx / n / ctx.width, avy / n / ctx.height];
      } else {
        this.uniforms.uVelocity.value = [0, 0];
      }

      this.motion.render();
    },

    resize: function (ctx) {
      this.ctx = ctx;
      this.uniforms.ratio.value = ctx.aspect;
    },
  });

})();
