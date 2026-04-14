#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;   // UV position (0-1, y=0 top)

uniform int  uNumTips;
uniform vec2 uTips[10];
uniform int  uFoxGesture;

out float vBright;
out float vFox;

void main() {
  // UV (0-1, y=0 top) → NDC clip space
  vec2 clip = aPos * 2.0 - 1.0;
  clip.y    = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);

  // Brightness increases near fingertips
  float bright = 0.55;
  for (int i = 0; i < uNumTips; i++) {
    float d = length(aPos - uTips[i]);
    bright += max(0.0, 1.0 - d / 0.14) * 2.2;
  }
  bright = clamp(bright, 0.3, 4.0);

  // Point size: 1.5 baseline, up to ~4.7 near fingertips
  gl_PointSize = 1.5 + min((bright - 0.3) * 0.9, 3.2);

  vBright = bright;
  vFox    = float(uFoxGesture);
}
