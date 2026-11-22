// Design S4 for synthview-terrain-rendering.md section 11: today's colours and wireframe + haze +
// hill shading, sun 315 deg relative to the heading at 15 deg elevation.
// window.__rbShadows = true adds real cast shadows (shadow map) from the same sun.
(() => {
  const CAST = !!window.__rbShadows;
  const sc = angular.element(document.querySelector('#synthviewFrame')).scope();
  const R = sc.remote.rendering, S = R.scene;
  const HAZE = 0xc9dbe6, hz = new THREE.Color(HAZE);
  const EL = 15, REL = 315;
  // Haze: terrain fades into the haze; the dome blends sky and ground into it at the horizon
  S.fog = new THREE.Fog(HAZE, 8000, 30000);
  if (R.dome) {
    R.dome.material.uniforms.haze = { value: new THREE.Vector3(hz.r, hz.g, hz.b) };
    R.dome.material.fragmentShader = 'uniform vec3 sky; uniform vec3 ground; uniform vec3 haze; varying float vUp; void main() {' +
      ' float h = vUp / ' + (R.camera.far * 0.5).toFixed(1) + ';' +
      ' vec3 c = h >= 0.0 ? mix(haze, sky, smoothstep(0.0, 0.18, h)) : mix(haze, ground, smoothstep(0.0, 0.12, -h));' +
      ' gl_FragColor = vec4(c, 1.0); }';
    R.dome.material.needsUpdate = true;
  }
  // Light: ambient high enough that flat ground stays bright under a low sun
  const light = S.children.find(o => o.isDirectionalLight);
  const amb = S.children.find(o => o.isAmbientLight);
  amb.intensity = 0.6; light.intensity = 0.9;
  S.add(light.target);
  const sunFor = (heading) => { const az = (heading + REL) * Math.PI / 180, el = EL * Math.PI / 180;
    return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)); };
  // Today's vertex colours, lit (Lambert, no specular glare), wireframe as today
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });
  const dress = (t) => { if (!t) return; t.material = mat; t.castShadow = t.receiveShadow = CAST; };
  const load = R.loadDEM.bind(R);
  R.loadDEM = function () { load(...arguments); dress(this.terrainBrown); };
  dress(R.terrainBrown);
  if (CAST) {
    R.renderer.shadowMap.enabled = true; R.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    light.castShadow = true; light.shadow.mapSize.set(2048, 2048); light.shadow.bias = -0.0008; light.shadow.normalBias = 20;
    const c = light.shadow.camera; c.left = c.bottom = -16000; c.right = c.top = 16000; c.near = 100; c.far = 80000; c.updateProjectionMatrix();
  }
  const render = R.renderer.render.bind(R.renderer);
  R.renderer.render = (s, cam) => {   // the sun turns with the aircraft
    const st = window.situation || sc.situation, t = R.controls.target;
    light.position.copy(sunFor(st.GPSTrueCourse || 0)).multiplyScalar(30000).add(t);
    light.target.position.copy(t); light.target.updateMatrixWorld();
    render(s, cam);
  };
  S.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
  return 'S4' + (CAST ? ' + cast shadows' : '');
})()
