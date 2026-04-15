// this is for gesture and audio detection

// Exports:
// 1. normTips, fingertips, flowVectors — fingertip positions and velocities
// 2. handMoving   — true if any fingertip moved faster than M_sensitivity px/frame
// 3. foxGesture   — true if the fox hand shape is held (latched for FoxGesture_Latch)
// 4.volumeSpike  — true if mic volume spiked above the rolling average
// - read each frame by cpu-canvas.js / sketch.js



// --------- Shared state
const W = window.innerWidth
const H = window.innerHeight

let normTips = []; // MediaPipe 0–1 normalised coords  [{x,y}, …]
let fingertips = []; // canvas-pixel coords, selfie-mirrored [{x,y}, …]
let flowVector = { x: 0, y: 0, vx: 0, vy: 0, v: 0 };
let flowVectorWH = { x: 0, y: 0, vx: 0, vy: 0, v: 0 };

let handMoving = false;
let foxGesture = false;
let volumeSpike = false;
let indexOnly = false;

// --------- Internal state
let _oldFingertips = [];

let indexUp = false;
let middleDown = false;
let ringDown = false;
let pinkyUp = false;
let pinkyDown = false;

let _foxLatch = 0;
let _spikeLatch = 0;

let _audioCtx = null;
let _analyser = null;
let _micData = null;
let _avgVolume = 0;

// ------- parameters
const M_sensitivity = 10; // min px/frame to count as hand movement
const FoxGesture_Latch = 20; // frames fox gesture stays active after last detection
const Spike_Latch = 8;  // frames volume spike stays active

// ----- set up Webcam 
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



// ------ set up Hand detection (MediaPipe Hands) 
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



// ------- set up Audio (Web Audio API) 

// Initialises the AudioContext and mic analyser on first user gesture (tap), also re-attempt on the first user interaction
// because browsers block AudioContext creation before a user interaction.
_startAudio(); //defined in helper function section

document.getElementById("start-overlay").addEventListener("click", () => {
  _startAudio();
  document.getElementById("start-overlay").remove();
});



// ------ Per-frame update: gesture, audio

//called in cpu-canvas.js(p5.js) update
function updateHandDetection() {
  // 1. Collect fingertip positions
  // (thumb=4, index=8, middle=12, ring=16, pinky=20)

  //clean old data
  normTips = [];
  fingertips = [];

  if (detections?.multiHandLandmarks) {
    for (const hand of detections.multiHandLandmarks) {
      for (const index of [8, 12, 16, 20]) {
        const lm = hand[index];
        //mediapipe pos (0-1 scale)
        normTips.push({ x: lm.x, y: lm.y });
        //screen pos: adapted to screen size + mirror x-axis
        fingertips.push({ x: (1 - lm.x) * W, y: lm.y * H });
        if (hand[8].y < hand[5].y) indexUp = true;
        else indexUp = false;
        if (hand[12].y > hand[9].y) middleDown = true;
        else middleDown = false;
        if (hand[16].y > hand[13].y) ringDown = true;
        else ringDown = false;
        if (hand[20].y < hand[17].y) pinkyUp = true;
        else pinkyUp = false;
        if (hand[20].y > hand[17].y) pinkyDown = true;
        else pinkyDown = false;
      }
    }
  }

  // 2. average all fingertips into a single flow vector
  if (fingertips.length > 0) {
    const n = fingertips.length;
    let ax = 0, ay = 0, avx = 0, avy = 0;
    for (let i = 0; i < n; i++) {
      ax += fingertips[i].x;
      ay += fingertips[i].y;
      const old = _oldFingertips[i];
      if (old) { avx += fingertips[i].x - old.x; avy += fingertips[i].y - old.y; }
    }
    const x = ax / n; 
    const y = ay / n
    const vx = avx / n;
    const vy = avy / n;
    flowVector = { x, y, vx, vy, v: Math.sqrt(vx * vx + vy * vy) };
    const x_WH = x / W; 
    const y_WH = y / H;
    const vx_WH = vx / W;
    const vy_WH = vy / H;
    flowVectorWH = {x_WH, y_WH, vx_WH, vy_WH, v: Math.sqrt(vx_WH * vx_WH + vy_WH * vy_WH) }
  } else {
    return;
  }
  
  _oldFingertips = fingertips.slice();

  // 3. Hand-moving detection
  handMoving = flowVector.v > M_sensitivity;

  // 4. IndexOnly gesture detection
  indexOnly = false;
  if (detections?.multiHandLandmarks) {
    for (const hand of detections.multiHandLandmarks) {
      if (indexUp && middleDown && ringDown && pinkyDown) {
        indexOnly = true;
      }
    }
  }

  // 5. Fox gesture detection
  // (index + pinky extended, middle + ring curled)
  if (detections?.multiHandLandmarks) {
    for (const hand of detections.multiHandLandmarks) {
      if (indexUp && middleDown && ringDown && pinkyUp)
        _foxLatch = FoxGesture_Latch;
    }
  }
  foxGesture = _foxLatch > 0; //true if _foxLatch > 0
  if (_foxLatch > 0) _foxLatch--; //countdown

  // 6. Volume spike detection
  // (exponential moving average baseline)
  const vol = getRMS();
  _avgVolume = _avgVolume * 0.97 + vol * 0.03; //Exponential Moving Average (EMA)
  if (vol > Math.max(_avgVolume * 2.5, 0.025)) _spikeLatch = Spike_Latch;
  else if (_spikeLatch > 0) _spikeLatch--;
  volumeSpike = _spikeLatch > 0;
}



// --------------- helper function

// ----- for audio related
async function _startAudio() {
  if (_analyser) return; // already initialised
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    //create audio context
    const AudioCtx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    _audioCtx = new AudioCtx();

    //set audioCtx state to running
    await _audioCtx.resume(); 
    const src = _audioCtx.createMediaStreamSource(stream);

    //create analyser and connected to audio src
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize = 256;//8 bit
    src.connect(_analyser);

    //create audio frequency data buffer
    _micData = new Uint8Array(_analyser.frequencyBinCount);
  } catch (e) {
    console.warn("Mic unavailable — sound trigger disabled:", e);
  }
}

// Returns the RMS (Root Mean Square) amplitude of the current mic frame (0–1 scale)
function getRMS() {
  if (!_analyser) return 0;
  //update audio frequency data
  _analyser.getByteTimeDomainData(_micData);

  //calculate audio level - RMS amplitude
  let sum = 0;
  for (let i = 0; i < _micData.length; i++) {
    const v = (_micData[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / _micData.length);
}