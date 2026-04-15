// Adapted from: https://github.com/JoTrdl/starfluid/blob/master/src/shaders/motion.html | Copyright (c) 2015 Johann Troendle

precision highp float;
varying vec2 vUv;
uniform sampler2D tSampler;
uniform float ratio;
uniform vec2  uPoint;    // averaged fingertip UV position (0-1)
uniform vec2  uVelocity; // averaged velocity, normalised to screen size

const float VELOCITY_RADIUS = 300.0; // lower = wider Gaussian spread
const float STRENGTH = 200.0;

void main() {
  gl_FragColor = texture2D(tSampler, vUv);

  vec2 pos     = vUv    * vec2(ratio, 1.0);
  vec2 rPoint  = uPoint * vec2(ratio, 1.0);
  float gaussian = -dot(pos - rPoint, pos - rPoint);

  gl_FragColor.xy = uVelocity * exp(gaussian * VELOCITY_RADIUS) * STRENGTH;
}
