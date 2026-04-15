#version 300 es
precision mediump float;

in float vBright;
in float vIndex; // 1.0 = index0nly gesture active

out vec4 fragColor;

void main() {
  // draw particle circle
  vec2  c = gl_PointCoord - 0.5; // shift origin from (0,0) to center (0.5,0.5)
  float d = length(c); //calculate length
  if (d > 0.5) discard; // kill vec outside of radius

  //falloff for alpha
  float a = 1.0 - d * 2.0; 
  a  = a * a;  // sharpen falloff

  // teal normally, golden during IndexOnly gesture
  vec3 teal   = vec3(0.28, 0.82, 0.92);
  vec3 golden = vec3(1.00, 0.75, 0.22);
  vec3 col = mix(teal, golden, vIndex) * vBright * (1.0 + vIndex * 1.0);

  fragColor = vec4(col * a, a * mix(0.80, 1.0, vIndex));
}
