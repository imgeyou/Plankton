precision highp float;
varying vec2 vUv;
uniform sampler2D tSampler;
uniform sampler2D solver;
uniform float dt;
uniform vec2 d;
void main() {
  vec4 data = texture2D(tSampler, vUv);
  data.xy += dt * texture2D(solver, data.xy).xy * d * 2.0;
  if (data.a > 0.0) { data.a -= 0.01; }
  else { data = vec4(-1); }
  gl_FragColor = data;
}
