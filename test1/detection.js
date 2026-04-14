// this is for gesture and audio detection

// Exports:
// 1. normTips, fingertips, flowVectors — fingertip positions and velocities
// 2. handMoving   — true if any fingertip moved faster than M_sensitivity px/frame
// 3. foxGesture   — true if the fox hand shape is held (latched for FoxGesture_Latch)
// 4.volumeSpike  — true if mic volume spiked above the rolling average
// - read each frame by cpu-canvas.js / sketch.js



// --------- Shared state
let normTips = []; // MediaPipe 0–1 normalised coords  [{x,y}, …]
let fingertips = []; // canvas-pixel coords, selfie-mirrored [{x,y}, …]
let flowVectors = []; // per-fingertip velocity [{x,y,vx,vy}, …]

let handMoving = false;
let foxGesture = false;
let volumeSpike = false;



// --------- Internal state
const M_sensitivity = 10;       // min px/frame to count as hand movement
const FoxGesture_Latch = 20;    // frames fox gesture stays active after last detection
const Spike_Latch = 8;   // frames volume spike stays active

let _oldFingertips = [];
let _foxLatch = 0;
let _spikeLatch = 0;

let _audioCtx = null;
let _analyser = null;
let _micData = null;
let _avgVolume = 0;



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
function updateHandDetection(width, height) {
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
        fingertips.push({ x: (1 - lm.x) * width, y: lm.y * height });
      }
    }
  }

  // 2. calculate per-fingertip velocity vectors
  flowVectors = fingertips.map((tip, i) => {
    const old = _oldFingertips[i];
    return old
      ? { x: tip.x, y: tip.y, vx: tip.x - old.x, vy: tip.y - old.y }
      : { x: tip.x, y: tip.y, vx: 0, vy: 0 }; //first frame
  });
  _oldFingertips = fingertips.slice();

  // 3. Hand-moving detection
  handMoving = flowVectors.some(
    (v) => Math.sqrt(v.vx * v.vx + v.vy * v.vy) > M_sensitivity,
  );

  // 4. Fox gesture detection
  // (index + pinky extended, middle + ring curled)
  if (detections?.multiHandLandmarks) {
    for (const hand of detections.multiHandLandmarks) {
      const indexUp  = hand[8].y  < hand[5].y;
      const middleDown = hand[12].y > hand[9].y;
      const ringDown   = hand[16].y > hand[13].y;
      const pinkyUp  = hand[20].y  < hand[17].y;
      if (indexUp && middleDown && ringDown && pinkyUp) _foxLatch = FoxGesture_Latch;
    }
  }
  foxGesture = _foxLatch > 0; //true if _foxLatch > 0
  if (_foxLatch > 0) _foxLatch--;//countdown

  // 5. Volume spike detection 
  // (exponential moving average baseline)
  const vol = getRMS();
  _avgVolume = _avgVolume * 0.97 + vol * 0.03;//Exponential Moving Average (EMA) 
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