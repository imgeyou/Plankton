//particle pos
precision highp float;
attribute vec2 position;
varying vec2 vUv;
uniform sampler2D particleData;
uniform float ratio;

void main() {
  vec4 data = texture2D(particleData, position);
  vec2 point = data.xy;
  float size = data.z;
  vUv = position;
  vec2 vPos = point * 2.0 - 1.0;
  gl_PointSize = size * ratio;
  gl_Position = vec4(vPos.x, vPos.y, 0, 1);
}
