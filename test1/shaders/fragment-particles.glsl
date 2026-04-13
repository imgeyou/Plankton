// https://github.com/JoTrdl/starfluid/blob/master/src/shaders/particles.html | Copyright (c) 2015 Johann Troendle

//particle style
precision highp float;
varying vec2 vUv;
uniform float ratio;
uniform sampler2D tSampler;
// gold color
const vec4 color = vec4(1.0, 0.5, 0.166, 0.66);
void main() {
  gl_FragColor = color;
}
