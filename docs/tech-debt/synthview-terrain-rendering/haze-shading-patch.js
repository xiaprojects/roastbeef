// Haze + hill shading samples for synthview-terrain-rendering.md section 9.
// window.__rbVariant: 'S1' today's colours, 'S2' crisp strong colours (variant B); both hill-shaded and hazed,
// sun fixed from the north-west. 'S3' = S2 with the sun 315 deg relative to the heading (front left), 60 deg up.
(() => {
  const V = window.__rbVariant || 'S1';
  const RELATIVE = V === 'S3';   // S3: S2 with a heading-relative sun
  const sc = angular.element(document.querySelector('#synthviewFrame')).scope();
  const R = sc.remote.rendering, S = R.scene;
  const HAZE = 0xc9dbe6, NEAR = 8000, FAR = 30000;
  const hz = new THREE.Color(HAZE);
  const SUN = new THREE.Vector3(-1, 0.8, -1).normalize();   // from the north-west, about 30 deg up
  // Haze: terrain fades into the haze colour with distance
  S.fog = new THREE.Fog(HAZE, NEAR, FAR);
  // Dome: sky and ground both fade into the haze at the horizon
  if (R.dome) {
    R.dome.material.uniforms.haze = { value: new THREE.Vector3(hz.r, hz.g, hz.b) };
    R.dome.material.fragmentShader = 'uniform vec3 sky; uniform vec3 ground; uniform vec3 haze; varying float vUp; void main() {' +
      ' float h = vUp / ' + (R.camera.far * 0.5).toFixed(1) + ';' +
      ' vec3 c = h >= 0.0 ? mix(haze, sky, smoothstep(0.0, 0.18, h)) : mix(haze, ground, smoothstep(0.0, 0.12, -h));' +
      ' gl_FragColor = vec4(c, 1.0); }';
    R.dome.material.needsUpdate = true;
  }
  // Hill shading: the sun from the north-west, ambient high enough to keep the colours strong
  S.children.forEach(o => {
    if (o.isDirectionalLight) { o.position.copy(SUN).multiplyScalar(5000); o.intensity = 0.75; }
    if (o.isAmbientLight) o.intensity = 0.4;
  });
  let mat;
  // Sun 315 deg relative to the heading at 60 deg elevation. North is -Z, east +X.
  const sunFor = (heading) => { const az = (heading + 315) * Math.PI / 180, el = 60 * Math.PI / 180;
    return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)); };
  if (V === 'S1') {
    mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });
  } else {
    const fogC = new THREE.Vector3(hz.r, hz.g, hz.b);
    mat = new THREE.ShaderMaterial({
      uniforms: { alt: { value: 0 }, caution: { value: TERRAIN_CAUTION_METERS }, sun: { value: SUN },
                  hazeC: { value: fogC }, near: { value: NEAR }, far: { value: FAR } },
      side: THREE.FrontSide, extensions: { derivatives: true },
      vertexShader: `varying float vE; varying vec3 vN; varying float vD;
        void main() { vE = position.z; vN = normalize(mat3(modelMatrix) * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float alt, caution, near, far; uniform vec3 sun, hazeC; varying float vE; varying vec3 vN; varying float vD;
        void main() {
          float e = vE; bool hi = e > 50.0; vec3 c;
          if (e <= 0.0) c = vec3(0.0, 0.25, 1.0); else if (hi && e > alt) c = vec3(1.0, 0.0, 0.0);
          else if (hi && e > alt - caution) c = vec3(1.0, 1.0, 0.0); else c = vec3(0.0, 0.70, 0.0);
          if (e > 0.0) c *= min(0.45 + 0.75 * max(dot(normalize(vN), sun), 0.0), 1.0);   // hill shading
          if (e > 0.0) { float q = e / 100.0, w = max(fwidth(q), 1e-4);
            float k = (1.0 - clamp(abs(fract(q - 0.5) - 0.5) / w - 0.5, 0.0, 1.0)) * (1.0 - smoothstep(0.2, 0.45, w));
            c = mix(c, c * 0.35, k); }
          if (hi) { float fw = max(fwidth(e), 1e-3); float d = min(abs(e - alt), abs(e - (alt - caution))) / fw;
            c = mix(c, vec3(0.0), 1.0 - clamp(d - 1.5, 0.0, 1.0)); }
          c = mix(c, hazeC, smoothstep(near, far, vD));                                     // haze
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    const render = R.renderer.render.bind(R.renderer);
    const light = S.children.find(o => o.isDirectionalLight);
    R.renderer.render = (s, c) => {
      const st = window.situation || sc.situation;
      mat.uniforms.alt.value = st.GPSAltitudeMSL * 0.3048;
      if (RELATIVE) {   // the sun turns with the aircraft; the model is lit from the same side
        const v = sunFor(st.GPSTrueCourse || 0);
        mat.uniforms.sun.value.copy(v);
        light.position.copy(v).multiplyScalar(5000).add(R.controls.target);
        light.target.position.copy(R.controls.target); light.target.updateMatrixWorld();
      }
      render(s, c);
    };
  }
  const dress = (t) => {
    if (!t) return;
    t.material = mat;
    t.children.forEach(o => { if (o.isLineSegments) o.visible = (V === 'S1'); if (o.isLineSegments) o.material.opacity = 0.12; });
  };
  const load = R.loadDEM.bind(R);
  R.loadDEM = function () { load(...arguments); dress(this.terrainBrown); };
  dress(R.terrainBrown);
  S.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
  return 'haze + hill shading ' + V + (RELATIVE ? ' (sun relative to heading)' : '');
})()
