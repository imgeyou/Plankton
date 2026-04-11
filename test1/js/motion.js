
(function() {

  var CELLS = 256;

  Stage.Motion = Stage.Effect.extend({

    name: 'motion',

    initialize: function(ctx) {
      this.ctx = ctx;

      var gl = ctx.gl;

      this.uniforms = {
        'point':     { type: '2f', value: [0, 0] },
        'lastPoint': { type: '2f', value: [0, 0] },
        'dye':       { type: '1f', value: 0.0 },
        'velocity':  { type: '2f', value: [0, 0] },
        'ratio':     { type: '1f', value: ctx.aspect }
      };

      this.motion = new RTT(gl, {
        width:   CELLS,
        height:  CELLS,
        texture: { type: gl.FLOAT }
      }).fragment(document.getElementById('fluid-motion').textContent, this.uniforms)
        .render();

      this.addDye = false;
      this.oldMouseX = 0;
      this.oldMouseY = 0;

      var self = this;

      document.addEventListener('mouseup', function() {
        self.addDye = false;
      });

      document.addEventListener('mousedown', function(e) {
        var isLeft = ('buttons' in e) ? e.buttons === 1 : (e.which || e.button);
        if (isLeft) self.addDye = true;
      });

      document.addEventListener('mousemove', function(e) {
        self._onMouseMove(e);
      });
    },

    _onMouseMove: function(e) {
      if (this.ctx.paused) return;

      var mouseX = e.clientX;
      var mouseY = e.clientY;

      var u = mouseX / this.ctx.width;
      var v = 1.0 - mouseY / this.ctx.height;

      this.uniforms.lastPoint.value = this.uniforms.point.value.slice();
      this.uniforms.point.value = [u, v];

      var du = (mouseX - this.oldMouseX) / this.ctx.width;
      var dv = -(mouseY - this.oldMouseY) / this.ctx.height;
      this.uniforms.velocity.value = [du, dv];

      if (this.addDye) this.uniforms.dye.value = 1.0;

      this.oldMouseX = mouseX;
      this.oldMouseY = mouseY;
    },

    // Called externally by starfluid.js for hand-tracking injection
    injectPoint: function(nx, ny, du, dv) {
      this.uniforms.point.value    = [nx, ny];
      this.uniforms.velocity.value = [du, dv];
      this.uniforms.dye.value      = 1.0;
    },

    update: function(ctx) {
      this.ctx = ctx;
      this.motion.render();
      this.uniforms.velocity.value = [0, 0];
      this.uniforms.dye.value      = 0;
    },

    resize: function(ctx) {
      this.ctx = ctx;
      this.uniforms.ratio.value = ctx.aspect;
    }

  });

})();
