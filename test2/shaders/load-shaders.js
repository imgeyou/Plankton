// used to load the .glsl shader files before the app starts:

(function () {
  var shaders = [
    { id: 'fluid-motion',          file: 'shaders/fluid-motion.glsl' },
    { id: 'fluid-solver',          file: 'shaders/fluid-solver.glsl' },
    { id: 'fluid-dye',             file: 'shaders/fluid-dye.glsl' },
    { id: 'fragment-particle-data',file: 'shaders/fragment-particle-data.glsl' },
    { id: 'vertex-particles',      file: 'shaders/vertex-particles.glsl' },
    { id: 'fragment-particles',    file: 'shaders/fragment-particles.glsl' },
    { id: 'fluid-visualizer',      file: 'shaders/fluid-visualizer.glsl' },
    // webgl-particles shaders
    { id: 'wp-fade-vert',   file: 'shaders/webgl-particles/fade-vert.glsl'   },
    { id: 'wp-fade-frag',   file: 'shaders/webgl-particles/fade-frag.glsl'   },
    { id: 'wp-dummy-frag',  file: 'shaders/webgl-particles/dummy-frag.glsl'  },
    { id: 'wp-update-vert', file: 'shaders/webgl-particles/update-vert.glsl' },
    { id: 'wp-render-vert', file: 'shaders/webgl-particles/render-vert.glsl' },
    { id: 'wp-render-frag', file: 'shaders/webgl-particles/render-frag.glsl' },
  ];

  shaders.forEach(function (s) {
    var request = new XMLHttpRequest();
    request.open('GET', s.file, false); // open a GET request for the file
    request.send();// send the request (fetch the file)

    var scripts = document.createElement('script');//added to the html
    scripts.type = 'application/x-glsl';
    scripts.id = s.id;
    scripts.textContent = request.responseText;
    document.head.appendChild(scripts);
  });
})();
