// https://github.com/JoTrdl/starfluid/blob/master/src/shaders/particles.html | Copyright (c) 2015 Johann Troendle

//samples solver at particle pos 
precision highp float;
varying vec2 vUv;
uniform sampler2D tSampler;
uniform sampler2D solver;
uniform float dt;
uniform vec2 d;
void main() {
  vec4 data = texture2D(tSampler, vUv);

  //velocity vector from the texture -> sent back to effect.js
  data.xy += dt * texture2D(solver, data.xy).xy * d * 2.0;
  
  if (data.a > 0.0) { data.a -= 0.01; }
  else { data = vec4(-1); }
  gl_FragColor = data;
}
