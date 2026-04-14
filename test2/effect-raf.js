(function () {
  function tick() {
    let normTips = [];
    if (
      typeof detections !== "undefined" &&
      detections.multiHandLandmarks != undefined
    ) {
      for (let hand of detections.multiHandLandmarks) {
        for (let idx of [4, 8, 12, 16, 20]) {
          normTips.push({ x: hand[idx].x, y: hand[idx].y });
        }
      }
    }
    if (window.starfluid) window.starfluid.inject(normTips);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
