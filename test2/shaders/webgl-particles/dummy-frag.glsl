#version 300 es
// WebGL2 requires a fragment shader even when RASTERIZER_DISCARD is active.
// This no-op satisfies that requirement for the Transform Feedback update pass.
void main() {}
