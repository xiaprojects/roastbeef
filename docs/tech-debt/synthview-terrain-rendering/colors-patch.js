// Strong-colour terrain variants for synthview-terrain-rendering.md section 7.
// window.__rbVariant: 'A' crisp bands + contours, 'B' + borders/darker green/deeper sky, 'C' + red hatching.
(() => {
  const V = window.__rbVariant || 'A';
  const sc = angular.element(document.querySelector('#synthviewFrame')).scope();
  const R = sc.remote.rendering;
  const col = (h) => new THREE.Color(h);
  const uniforms = {
    alt: { value: 0 }, caution: { value: TERRAIN_CAUTION_METERS },
    cG: { value: col(V === 'A' ? 0x00ff00 : 0x00b400) }, cY: { value: col(0xffff00) },
    cR: { value: col(0xff0000) }, cW: { value: col(V === 'A' ? 0x0000ff : 0x0040ff) },
    contour: { value: 100.0 }, border: { value: V === 'A' ? 0.0 : 1.5 }, stripes: { value: V === 'C' ? 1.0 : 0.0 }
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.FrontSide, extensions: { derivatives: true },
    vertexShader: 'varying float vE; void main(){ vE = position.z; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `
      uniform float alt, caution, contour, border, stripes; uniform vec3 cG, cY, cR, cW; varying float vE;
      void main(){
        float e = vE; bool hi = e > 50.0; vec3 c;
        if (e <= 0.0) c = cW; else if (hi && e > alt) c = cR; else if (hi && e > alt - caution) c = cY; else c = cG;
        if (stripes > 0.5 && hi && e > alt && mod(gl_FragCoord.x + gl_FragCoord.y, 14.0) < 5.0) c = vec3(0.0);
        if (e > 0.0) {   // contour lines, faded out where they would crowd
          float q = e / contour, w = max(fwidth(q), 1e-4);
          float k = (1.0 - clamp(abs(fract(q - 0.5) - 0.5) / w - 0.5, 0.0, 1.0)) * (1.0 - smoothstep(0.2, 0.45, w));
          c = mix(c, c * 0.35, k);
        }
        if (border > 0.0 && hi) {   // black outline on the caution and warning heights
          float fw = max(fwidth(e), 1e-3);
          float d = min(abs(e - alt), abs(e - (alt - caution))) / fw;
          c = mix(c, vec3(0.0), 1.0 - clamp(d - border, 0.0, 1.0));
        }
        gl_FragColor = vec4(c, 1.0);
      }`
  });
  const dress = (t) => {
    if (!t) return;
    t.material = mat;
    t.children.forEach(o => { if (o.isLineSegments) o.visible = false; });
  };
  const load = R.loadDEM.bind(R);
  R.loadDEM = function () { load(...arguments); dress(this.terrainBrown); };
  dress(R.terrainBrown);
  const render = R.renderer.render.bind(R.renderer);
  R.renderer.render = (s, c) => { uniforms.alt.value = (window.situation || sc.situation).GPSAltitudeMSL * 0.3048; render(s, c); };
  if (V !== 'A') R.scene.background = col(0x1f5fc4);
  return 'variant ' + V;
})()
