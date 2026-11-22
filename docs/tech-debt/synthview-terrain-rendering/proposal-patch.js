(() => {
  const sc = angular.element(document.querySelector('#synthviewFrame')).scope();
  const R = sc.remote.rendering, S = R.scene;
  const C = (h) => new THREE.Color(h);
  // 1. Sky / ground dome: blue over brown like the attitude indicator, haze at the horizon
  const v = (h) => { const c = new THREE.Color(); c.setHex(h); return new THREE.Vector3(((h>>16)&255)/255, ((h>>8)&255)/255, (h&255)/255); };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(60000, 48, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { zen: {value: v(0x2b6cb0)}, hor: {value: v(0xc9dbe6)}, gnd: {value: v(0x5c4128)}, gndH: {value: v(0xc9dbe6)} },
    vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 zen,hor,gnd,gndH; varying vec3 d; void main(){ float h=d.y; vec3 c = h>0.0 ? mix(hor,zen,smoothstep(0.0,0.45,h)) : mix(gndH,gnd,smoothstep(0.0,0.3,-h)); gl_FragColor=vec4(c,1.0);}'
  }));
  dome.renderOrder = -10; dome.frustumCulled = false; S.add(dome);
  S.background = null;
  // 2. Haze: terrain fades into the horizon colour before the window edge
  S.fog = new THREE.Fog(0xc9dbe6, 8000, 30000);
  const render = R.renderer.render.bind(R.renderer);
  R.renderer.render = (s, c) => { dome.position.copy(c.position); render(s, c); };
  // 3. Light from the north-west (cartographic hill shading), no specular glare
  S.children.forEach(o => { if (o.isDirectionalLight) { o.position.set(-3000, 3500, -3000); o.intensity = 1.0; } if (o.isAmbientLight) o.intensity = 0.55; });
  // 4. Natural terrain colours by elevation; yellow/red only where terrain is near or above the aircraft
  const stops = [[0, '#6e8a4a'], [300, '#879057'], [700, '#a08a5a'], [1200, '#8e6c45'], [1800, '#7a6a5e'], [2600, '#b5aea6'], [3400, '#f2f2f2']];
  const ramp = stops.map(([e, h]) => [e, C(h)]);
  const water = C('#2f6496'), cau = C('#f2c200'), warn = C('#e0281e');
  const hyps = (e) => { let i = 0; while (i < ramp.length - 1 && e > ramp[i + 1][0]) i++;
    if (i == ramp.length - 1) return ramp[i][1].clone();
    const k = Math.max(0, Math.min(1, (e - ramp[i][0]) / (ramp[i + 1][0] - ramp[i][0]))); return ramp[i][1].clone().lerp(ramp[i + 1][1], k); };
  R.generateMaterial = function (grid, cellSize, altitude) {
    const nrows = grid.length, ncols = grid[0].length, colors = [];
    for (let j = 0; j < nrows * ncols; j++) {
      const e = grid[nrows - 1 - Math.floor(j / ncols)][j % ncols];
      const rule = globalTerrainColor(e, altitude);   // unchanged TAWS rule
      let c = e <= 0 ? water.clone() : hyps(e);
      if (rule === TERRAIN_COLOR_WARNING) c.lerp(warn, 0.85); else if (rule === TERRAIN_COLOR_CAUTION) c.lerp(cau, 0.45);
      colors.push(c.r, c.g, c.b);
    }
    return [new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide }), colors];
  };
  // 5. Under the surface is solid brown, not sky
  const dress = (t) => {
    if (!t || t.userData.dressed) return; t.userData.dressed = true;
    const grid = window.globalTerrainGrid.data.terrainData;
    const m = R.generateMaterial(grid, 0, sc.situation.GPSAltitudeMSL * 0.3048);
    t.material.dispose(); t.material = m[0];
    t.geometry.setAttribute('color', new THREE.Float32BufferAttribute(m[1], 3));
    t.add(new THREE.Mesh(t.geometry, new THREE.MeshBasicMaterial({ color: 0x5c4128, side: THREE.BackSide, fog: false })));
    t.children.forEach(o => { if (o.isLineSegments) { o.material.opacity = 0.10; o.material.color.set(0x222222); } });
  };
  const load = R.loadDEM.bind(R);
  R.loadDEM = function () { load(...arguments); dress(this.terrainBrown); };
  dress(R.terrainBrown);
  // 6. Chase camera keeps 60 m above the ground under it
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  const follow = R.cameraFollowItem.bind(R);
  R.cameraFollowItem = function (item, res) {
    follow(item, res);
    if (window.__rbNoClear || !this.terrainBrown) return;
    const p = this.camera.position; ray.set(new THREE.Vector3(p.x, 1e5, p.z), down);
    const hit = ray.intersectObject(this.terrainBrown, false)[0];
    if (hit && p.y < hit.point.y + 60) { p.y = hit.point.y + 60; this.camera.lookAt(this.controls.target);
      this.camera.rotateZ(-(item.roll || 0) * Math.PI / 180 * (window.__rbCam ? window.__rbCam.bank : 1)); }
  };
  return 'patched r' + THREE.REVISION;
})()
