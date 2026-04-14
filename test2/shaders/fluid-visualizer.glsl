// https://github.com/JoTrdl/starfluid/blob/master/src/shaders/visualizer.html | Copyright (c) 2015 Johann Troendle

precision highp float;
varying vec2 vUv;
uniform sampler2D sampler;
uniform sampler2D particles;
const vec4 dyeColor = vec4(0.3, 0.5, 1.1, 1.0);

void main() {
  float dye = texture2D(sampler, vUv).z;

  //particle texture
  vec4 particlesTexture = texture2D(particles, vUv);

  gl_FragColor = dye * dyeColor + particlesTexture;
}
