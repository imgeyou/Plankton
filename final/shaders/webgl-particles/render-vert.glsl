#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;// uv position

uniform int  uHasHand;
uniform vec2 uTip;
uniform int  uIndexOnly;

out float vBright;
out float vIndex;

void main() {
  // 0-1 uv space to -1-1
  vec2 clip = aPos * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);

  float bright = 0.55;
  vIndex = 0.0;
  if (uHasHand == 1) {
    float d = length(aPos - uTip);
    bright += max(0.0, 1.0 - d / 0.14);
    // gold fades in near fingertip, back to teal at edges
    if (uIndexOnly == 1)
      vIndex = max(0.0, 1.0 - d / 0.28);
  }
  bright = clamp(bright, 0.3, 1.8);

  gl_PointSize = 1.5 + min((bright - 0.3) * 0.9, 3.2) + vIndex * 2.0;

  vBright = bright;
}

 