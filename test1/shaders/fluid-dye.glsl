precision highp float;
varying vec2 vUv;
uniform sampler2D tSampler;
uniform sampler2D motion;
uniform sampler2D solver;
uniform float dt;
uniform vec2 d;
const float acc = 2.0;
const float diffusion = 0.994;
void main() {
  vec2 Was = vUv - dt * texture2D(solver, vUv).xy * d * acc;
  gl_FragColor.xyz = texture2D(tSampler, Was).xyz * diffusion;
  gl_FragColor.z += texture2D(motion, vUv).z;
  gl_FragColor.a = 1.0;
}
