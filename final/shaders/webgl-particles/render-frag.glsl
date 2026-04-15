#version 300 es
precision mediump float;

in float vBright;
in float vFox;    // 1.0 = fox gesture active

out vec4 fragColor;

void main() {
  // Soft circular point sprite
  vec2  c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;

  float a = 1.0 - d * 2.0;
  a       = a * a;  // sharpen falloff

  // Teal normally, golden during fox gesture (index + pinky up)
  vec3 teal   = vec3(0.28, 0.82, 0.92);
  vec3 golden = vec3(1.00, 0.75, 0.22);
  vec3 col    = mix(teal, golden, vFox) * vBright;

  fragColor = vec4(col * a, a * 0.80);
}
