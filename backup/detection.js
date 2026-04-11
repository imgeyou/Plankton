let detections = {};

const effectVideo = document.getElementById("effect-video");
const sketchVideo = document.getElementById("sketch-video");

function gotHands(results) {
  detections = results;
  // console.log(detections);
}

const hands = new Hands({
  locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
  },
});
hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});
hands.onResults(gotHands);

const effectCamera = new Camera(effectVideo, {
  onFrame: async () => {
    try {
      await hands.send({ image: effectVideo });
    } catch (e) {
      // swallow errors (e.g. DevTools overhead causing frame timeout)
    }
  },
  width: 640,
  height: 480,
});
effectCamera.start();

effectVideo.addEventListener("loadedmetadata", () => {
  sketchVideo.srcObject = effectVideo.srcObject;
  sketchVideo.play();
});
