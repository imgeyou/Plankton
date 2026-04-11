(function () {
  var shaders = [
    { id: 'fluid-motion',          file: 'shaders/fluid-motion.glsl' },
    { id: 'fluid-solver',          file: 'shaders/fluid-solver.glsl' },
    { id: 'fluid-dye',             file: 'shaders/fluid-dye.glsl' },
    { id: 'fragment-particle-data',file: 'shaders/fragment-particle-data.glsl' },
    { id: 'vertex-particles',      file: 'shaders/vertex-particles.glsl' },
    { id: 'fragment-particles',    file: 'shaders/fragment-particles.glsl' },
    { id: 'fluid-visualizer',      file: 'shaders/fluid-visualizer.glsl' },
  ];

  shaders.forEach(function (s) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', s.file, false); // synchronous so shaders are ready before library scripts run
    xhr.send();
    var el = document.createElement('script');
    el.type = 'application/x-glsl';
    el.id = s.id;
    el.textContent = xhr.responseText;
    document.head.appendChild(el);
  });
})();
