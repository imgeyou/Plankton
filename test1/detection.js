// detection.js — gesture and audio detection
// Exports (read each frame by cpu-canvas.js / sketch.js):
//   normTips, fingertips, flowVectors — fingertip positions and velocities
//   handMoving   — true if any fingertip moved faster than M_sensitivity px/frame
//   foxGesture   — true if the fox hand shape is held (latched for FOX_LATCH_FRAMES)
//   volumeSpike  — true if mic volume spiked above the rolling average

// ─── Shared state ────────────────────────────────────────────────────────────

let normTips = [];     // MediaPipe 0–1 normalised coords  [{x,y}, …]
let fingertips = [];   // canvas-pixel coords, selfie-mirrored [{x,y}, …]
let flowVectors = [];  // per-fingertip velocity [{x,y,vx,vy}, …]
let handMoving = false;
let foxGesture = false;
let volumeSpike = false;

// ─── Internal state ───────────────────────────────────────────────────────────

const M_sensitivity = 10;       // min px/frame to count as hand movement
const FOX_LATCH_FRAMES = 20;    // frames fox gesture stays active after last detection
const SPIKE_LATCH_FRAMES = 8;   // frames volume spike stays active

let _prevFingertips = [];
let _foxLatch = 0;
let _spikeLatch = 0;

let _audioCtx = null;
let _analyser = null;
let _micData = null;
let _avgVolume = 0;

// ─── Webcam ───────────────────────────────────────────────────────────────────

const sketchVideo = document.getElementById("sketch-video");

const camera = new Camera(sketchVideo, {
  onFrame: async () => {
    try {
      await hands.send({ image: sketchVideo });
    } catch (e) {
      // swallow errors (e.g. DevTools overhead causing frame timeout)
    }
  },
  width: 640,
  height: 480,
});

camera.start();

// ─── Hand detection (MediaPipe Hands) ────────────────────────────────────────

let detections = {};

const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});

hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

hands.onResults((results) => {
  detections = results;
});

// ─── Audio (Web Audio API) ────────────────────────────────────────────────────

// Initialises the AudioContext and mic analyser on first user gesture,
// because browsers block AudioContext creation before a user interaction.
async function _startAudio() {
  if (_analyser) return; // already initialised
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const AudioCtx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    _audioCtx = new AudioCtx();
    await _audioCtx.resume();
    const src = _audioCtx.createMediaStreamSource(stream);
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize = 256;
    src.connect(_analyser);
    _micData = new Uint8Array(_analyser.frequencyBinCount);
  } catch (e) {
    console.warn("Mic unavailable — sound trigger disabled:", e);
  }
}

// Try immediately; also re-attempt on the first user interaction (required by most browsers)
_startAudio();
["click", "touchstart", "keydown"].forEach((evt) =>
  window.addEventListener(evt, _startAudio, { once: true }),
);

// Returns the RMS amplitude of the current mic frame (0–1 scale)
function getRMS() {
  if (!_analyser) return 0;
  _analyser.getByteTimeDomainData(_micData);
  let sum = 0;
  for (let i = 0; i < _micData.length; i++) {
    const v = (_micData[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / _micData.length);
}

// ─── Per-frame update ─────────────────────────────────────────────────────────

// Called each frame (from cpu-canvas.js / sketch.js draw loop) with the current canvas size.
// Updates all exported state variables at the top of this file.
function updateHandDetection(width, height) {
  // 1. Collect fingertip positions (thumb=4, middle=12, ring=16, pinky=20)
  normTips = [];
  fingertips = [];
  if (detections?.multiHandLandmarks) {
    for (const hand of detections.multiHandLandmarks) {
      for (const index of [4, 12, 16, 20]) {
        const lm = hand[index];
        normTips.push({ x: lm.x, y: lm.y });
        fingertips.push({ x: (1 - lm.x) * width, y: lm.y * height }); // selfie-mirror x
      }
    }
  }

  // 2. Compute per-fingertip velocity vectors
  flowVectors = fingertips.map((tip, i) => {
    const prev = _prevFingertips[i];
    return prev
      ? { x: tip.x, y: tip.y, vx: tip.x - prev.x, vy: tip.y - prev.y }
      : { x: tip.x, y: tip.y, vx: 0, vy: 0 };
  });
  _prevFingertips = fingertips.slice();

  // 3. Hand-moving flag
  handMoving = flowVectors.some(
    (v) => Math.sqrt(v.vx * v.vx + v.vy * v.vy) > M_sensitivity,
  );

  // 4. Fox gesture: index + pinky extended, middle + ring curled
  if (detections?.multiHandLandmarks) {
    for (const hand of detections.multiHandLandmarks) {
      const indexUp  = hand[8].y  < hand[5].y;
      const middleDown = hand[12].y > hand[9].y;
      const ringDown   = hand[16].y > hand[13].y;
      const pinkyUp  = hand[20].y  < hand[17].y;
      if (indexUp && middleDown && ringDown && pinkyUp) _foxLatch = FOX_LATCH_FRAMES;
    }
  }
  foxGesture = _foxLatch > 0;
  if (_foxLatch > 0) _foxLatch--;

  // 5. Volume spike detection (exponential moving average baseline)
  const vol = getRMS();
  _avgVolume = _avgVolume * 0.97 + vol * 0.03;
  if (vol > Math.max(_avgVolume * 2.5, 0.025)) _spikeLatch = SPIKE_LATCH_FRAMES;
  else if (_spikeLatch > 0) _spikeLatch--;
  volumeSpike = _spikeLatch > 0;
}
