/** Every blade maps to one real record; only the owner's choices determine highlights. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { compoundLayout } from '../src/compoundLayout.ts';
const canvas = document.querySelector('#cx-canvas');
const stage = document.querySelector('#cx-stage');
const status = document.querySelector('#cx-stage-status');
let items = [...document.querySelectorAll('.cx-item')];
const detail = document.querySelector('#cx-detail');
const search = document.querySelector('#cx-search');
const matches = document.querySelector('#cx-matches');
const pause = document.querySelector('#cx-motion');
const reset = document.querySelector('#cx-reset');
const hover = document.querySelector('#cx-hover');
const shell = document.querySelector('.cx-shell');
const colorBy = document.querySelector('#cx-color-by');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
function initialSelection(id) {
  const requested = items.findIndex(item => item.dataset.id === id);
  return requested >= 0 ? requested : Math.max(0, items.findIndex(item => item.dataset.highlight === 'leading'));
}
let selected = initialSelection(new URL(location.href).searchParams.get('leaflet'));
let disposeScene = () => {};
let cameraSnapshot = () => null;
let motionPreference = !reduced.matches;
let selectMesh = () => {};
let period = 'all';
function select(index, scroll = false) {
  if (!items[index] || items[index].hidden) return;
  selected = index;
  items.forEach((item, i) => item.setAttribute('aria-pressed', String(i === index)));
  detail.replaceChildren(document.querySelector(`#cx-record-${index}`).content.cloneNode(true));
  if (scroll) {
    const list = document.querySelector('#cx-list');
    const itemBounds = items[index].getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    if (itemBounds.top < listBounds.top) list.scrollTop += itemBounds.top - listBounds.top;
    else if (itemBounds.bottom > listBounds.bottom) list.scrollTop += itemBounds.bottom - listBounds.bottom;
  }
  selectMesh(index);
  const url = new URL(location.href); url.searchParams.set('leaflet', items[index].dataset.id);
  history.replaceState(null, '', url);
}
function bindItems() {
  items.forEach((item, i) => { item.disabled = false; item.addEventListener('click', () => select(i)); });
  search.disabled = items.length === 0;
  document.querySelector('#cx-period').disabled = items.length === 0;
  document.querySelectorAll('[data-period]').forEach(button => { button.disabled = items.length === 0; });
  colorBy.disabled = items.length === 0;
}
bindItems();
function filterItems() {
  const query = search.value.trim().toLocaleLowerCase();
  const visible = items.filter(item => {
    item.hidden = !item.dataset.title.toLocaleLowerCase().includes(query) || (period !== 'all' && item.dataset.month !== period);
    return !item.hidden;
  });
  matches.textContent = String(visible.length);
  document.querySelector('#cx-no-results').hidden = visible.length > 0;
  if (items[selected]?.hidden && visible.length) select(Number(visible[0].dataset.index));
  if (!visible.length && items.length) {
    items.forEach(item => item.setAttribute('aria-pressed', 'false'));
    detail.textContent = 'No matches';
  } else if (visible.length) select(selected);
  const days = visible.map(item => item.dataset.observed).filter(Boolean).sort();
  const summary = document.querySelector('#cx-timeline-summary');
  summary.textContent = `${visible.length} of ${items.length}${days.length ? ` · ${days[0]} to ${days.at(-1)}` : ' · no dates'}`;
  summary.classList.add('fol-metric');
  document.querySelectorAll('[data-period]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.period === period)));
  const filteredHighlights = items.filter(item => item.dataset.highlight && item.hidden);
  const highlightFilter = document.querySelector('#cx-highlight-filter');
  highlightFilter.hidden = filteredHighlights.length === 0;
  highlightFilter.textContent = filteredHighlights.some(item => item.dataset.highlight === 'leading')
    ? 'Leading tip hidden by filter'
    : 'Some highlights hidden by filter';
  hover.hidden = true;
  selectMesh(selected);
}
search.addEventListener('input', filterItems);
shell.addEventListener('change', event => {
  if (event.target.id === 'cx-period') { period = event.target.value; filterItems(); }
  if (event.target.id === 'cx-color-by') {
    shell.dataset.colorBy = colorBy.value;
    document.querySelector('#cx-source-legend').hidden = colorBy.value !== 'source';
    document.querySelector('#cx-tier-legend').hidden = colorBy.value !== 'tier';
    selectMesh(selected);
  }
});
shell.addEventListener('click', event => {
  const button = event.target.closest('[data-period]');
  if (button) { period = button.dataset.period; document.querySelector('#cx-period').value = period; filterItems(); }
  const related = event.target.closest('[data-related-index]');
  if (related) {
    event.preventDefault();
    search.value = ''; period = 'all'; document.querySelector('#cx-period').value = period;
    filterItems(); select(Number(related.dataset.relatedIndex), true);
  }
});
select(selected);
canvas.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const visible = items.map((item, i) => item.hidden ? -1 : i).filter(i => i >= 0);
  if (!visible.length) return;
  const at = visible.indexOf(selected);
  select(visible[(at + (event.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length], true);
});

function createBlade() {
  const positions = [], uv = [], triangles = [];
  const rows = 20, columns = 8;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const width = Math.pow(Math.sin(Math.PI * t), 0.8) * (1 - 0.28 * t) * 0.19;
    for (let j = 0; j <= columns; j++) {
      const across = j / columns * 2 - 1;
      positions.push(across * width, t * 0.76, Math.sin(t * Math.PI) * 0.065 * (1 - across * across) + t * t * 0.08);
      uv.push(j / columns, t);
      if (i < rows && j < columns) {
        const a = i * (columns + 1) + j, b = a + columns + 1;
        triangles.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(triangles); geometry.computeVertexNormals();
  return geometry;
}
function paintBlade(base, vein) {
  const textureCanvas = document.createElement('canvas'); textureCanvas.width = 128; textureCanvas.height = 256;
  const ctx = textureCanvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 128, 0);
  gradient.addColorStop(0, base.clone().multiplyScalar(0.58).getStyle());
  gradient.addColorStop(0.47, base.getStyle());
  gradient.addColorStop(0.53, base.clone().multiplyScalar(0.86).getStyle());
  gradient.addColorStop(1, base.clone().multiplyScalar(0.65).getStyle());
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 256);
  ctx.strokeStyle = vein.getStyle(); ctx.globalAlpha = 0.34; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(64, 256); ctx.lineTo(64, 0); ctx.stroke();
  for (let i = 1; i < 12; i++) {
    ctx.globalAlpha = 0.14; ctx.lineWidth = 0.7;
    for (const side of [-1, 1]) {
      const y = i * 22;
      ctx.beginPath(); ctx.moveTo(64, y + 23); ctx.quadraticCurveTo(64 + side * 20, y + 8, 64 + side * 62, y - 16); ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(textureCanvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
async function grow(view = null) {
  stage.dataset.artifactCount = String(items.length);
  stage.dataset.leadingId = ''; stage.dataset.highlightCount = '0';
  if (!items.length) { stage.dataset.ready = 'true'; return; }
  const events = new AbortController();
  const on = (target, name, fn) => target.addEventListener(name, fn, { signal: events.signal });
  const styles = getComputedStyle(document.documentElement);
  const color = name => new THREE.Color(styles.getPropertyValue(name).trim());
  const green = color('--fol-evergreen-500');
  const lightGreen = color('--fol-evergreen-300');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.55;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
  controls.minDistance = 6; controls.maxDistance = 40; controls.maxPolarAngle = Math.PI * 0.8;
  controls.minPolarAngle = Math.PI * 0.2; controls.autoRotate = false;
  scene.add(new THREE.HemisphereLight(color('--fol-paper'), green.clone().multiplyScalar(0.2), 2));
  const key = new THREE.DirectionalLight(color('--fol-paper'), 2.3); key.position.set(-4, 7, 8); scene.add(key);
  const rim = new THREE.DirectionalLight(color('--fol-paper'), 2); rim.position.set(5, 2, -5); scene.add(rim);
  const plant = new THREE.Group(); plant.rotation.set(0.16, -0.22, -0.18); scene.add(plant);
  const stemMaterial = new THREE.MeshStandardMaterial({ color: lightGreen.clone().multiplyScalar(0.63), roughness: 0.72 });
  // A neutral vein texture preserves the category hue instead of tinting every record green.
  const texture = paintBlade(new THREE.Color('white'), new THREE.Color('white'));
  const palette = {
    source: { git: color('--fol-record-git'), photosynthesis: color('--fol-record-photosynthesis'), other: color('--fol-record-other') },
    tier: { verified: lightGreen, pending: color('--fol-pending'), excluded: color('--fol-excluded') },
  };
  const materials = new Map();
  for (const [mode, colors] of Object.entries(palette)) for (const [kind, hue] of Object.entries(colors)) {
    materials.set(`${mode}:${kind}`, new THREE.MeshStandardMaterial({ color: hue, map: texture, roughness: 0.72, side: THREE.DoubleSide }));
  }
  const fadedMaterial = new THREE.MeshStandardMaterial({ color: green, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
  const outlineMaterial = new THREE.LineBasicMaterial({ color: color('--fol-text'), transparent: true, opacity: 0.95 });
  const connectionMaterial = new THREE.LineBasicMaterial({ color: color('--fol-text-muted'), transparent: true, opacity: 0.48 });
  const geometry = createBlade();
  const perimeter = [];
  const positions = geometry.getAttribute('position');
  for (let row = 0; row <= 20; row++) perimeter.push(new THREE.Vector3().fromBufferAttribute(positions, row * 9));
  for (let row = 20; row >= 0; row--) perimeter.push(new THREE.Vector3().fromBufferAttribute(positions, row * 9 + 8));
  const outlineGeometry = new THREE.BufferGeometry().setFromPoints(perimeter);
  const outline = new THREE.LineLoop(outlineGeometry, outlineMaterial);
  outline.scale.setScalar(1.07); outline.position.z = 0.015;
  // A fixed diamond at the blade base denotes an owner choice; the perimeter denotes selection.
  const highlightGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.105, 0.13, 0.10), new THREE.Vector3(0, 0.235, 0.10),
    new THREE.Vector3(0.105, 0.13, 0.10), new THREE.Vector3(0, 0.025, 0.10),
  ]);
  const highlightMarkers = new Map();
  const connections = new THREE.Group(); plant.add(connections);
  const blades = new Array(items.length);
  const pinnae = [];
  function tube(points, radius) {
    const path = new THREE.CatmullRomCurve3(points);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 36, radius, 6, false), stemMaterial);
    return { path, mesh };
  }
  const rachisAt = t => new THREE.Vector3(Math.sin(t * Math.PI * 0.9) * 0.24, -4.4 + t * 8.8, Math.sin(t * Math.PI) * 0.18);
  plant.add(tube(Array.from({ length: 12 }, (_, i) => rachisAt(i / 11)), 0.025).mesh);
  const leading = items.findIndex(item => item.dataset.highlight === 'leading');
  const featured = items.map((item, index) => ({ index, order: Number(item.dataset.featuredOrder) }))
    .filter(item => item.order >= 0).sort((a, b) => a.order - b.order).map(item => item.index);
  const layout = compoundLayout(items.length, leading, featured);
  function attachBlade(parent, blade, index) {
    blade.userData.index = index; parent.add(blade); blades[index] = blade;
    if (items[index].dataset.highlight) {
      const marker = new THREE.LineLoop(highlightGeometry, outlineMaterial);
      blade.add(marker); highlightMarkers.set(index, marker);
    }
  }
  // The terminal blade is the actual chosen record, never a decorative duplicate.
  if (layout.terminal >= 0) {
    const terminal = new THREE.Mesh(geometry, materials.get('source:git'));
    terminal.position.copy(rachisAt(1));
    terminal.rotation.z = -0.07;
    terminal.scale.set(1.06, 1, 1);
    attachBlade(plant, terminal, layout.terminal);
  }
  stage.dataset.leadingId = layout.terminal >= 0 ? items[layout.terminal].dataset.id : '';
  stage.dataset.highlightCount = String(featured.length);
  // Pinnae share one tapered envelope. Highlight placement never changes record indices.
  for (const [b, group] of layout.pinnae.entries()) {
    const { side, along, fraction, length } = group;
    const base = rachisAt(along);
    const pinna = new THREE.Group(); pinna.position.copy(base); plant.add(pinna);
    const branch = tube([new THREE.Vector3(), new THREE.Vector3(side * length * 0.35, 0.08, 0.12),
      new THREE.Vector3(side * length * 0.74, 0.26, 0.22), new THREE.Vector3(side * length, 0.46, 0.14)], 0.012);
    pinna.add(branch.mesh);
    for (const { index, order: j, t } of group.blades) {
      const point = branch.path.getPoint(t);
      const tangent = branch.path.getTangent(t);
      const blade = new THREE.Mesh(geometry, materials.get('source:git'));
      const taper = 0.72 + 0.28 * Math.sin(Math.PI * t);
      blade.scale.set(1.06 * taper, taper * (0.82 + 0.18 * Math.sin(Math.PI * fraction)), taper);
      blade.position.copy(point);
      blade.rotation.z = Math.atan2(-tangent.x, tangent.y) + (j % 2 === 0 ? -1 : 1) * 1.18;
      blade.rotation.x = 0.18 + Math.sin(j * 2.4 + b) * 0.20;
      blade.rotation.y = Math.sin(j * 0.8 + b) * 0.22;
      attachBlade(pinna, blade, index);
    }
    pinnae.push({ group: pinna, phase: b * 0.8 });
  }
  plant.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(plant);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  function fit() {
    const aspect = stage.clientWidth / stage.clientHeight;
    camera.aspect = aspect;
    const distance = Math.max(size.y, size.x / aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.18;
    camera.position.set(center.x, center.y + 0.3, Math.min(38, distance));
    controls.target.copy(center); camera.updateProjectionMatrix(); controls.update(); controls.saveState();
  }
  let sized = false;
  function snapshot() { return { position: camera.position.toArray(), target: controls.target.toArray() }; }
  cameraSnapshot = snapshot;
  const resize = new ResizeObserver(() => {
    renderer.setSize(stage.clientWidth, stage.clientHeight, false);
    camera.aspect = stage.clientWidth / stage.clientHeight; camera.updateProjectionMatrix();
    if (!sized) {
      fit();
      if (view) { camera.position.fromArray(view.position); controls.target.fromArray(view.target); controls.update(); }
      sized = true;
    }
    stage.dataset.view = JSON.stringify(snapshot());
    renderer.render(scene, camera);
  });
  resize.observe(stage);
  fit();
  if (view) { camera.position.fromArray(view.position); controls.target.fromArray(view.target); controls.update(); }
  function clearConnections() {
    for (const line of [...connections.children]) { connections.remove(line); line.geometry.dispose(); }
  }
  function followConnections() {
    if (!connections.children.length) return;
    plant.updateMatrixWorld(true);
    for (const line of connections.children) {
      const start = plant.worldToLocal(blades[line.userData.from].localToWorld(new THREE.Vector3(0, 0.38, 0)));
      const end = plant.worldToLocal(blades[line.userData.to].localToWorld(new THREE.Vector3(0, 0.38, 0)));
      const middle = start.clone().lerp(end, 0.5); middle.z += 0.55;
      const path = new THREE.QuadraticBezierCurve3(start, middle, end);
      const points = line.geometry.getAttribute('position');
      const point = new THREE.Vector3();
      for (let i = 0; i < points.count; i++) { path.getPoint(i / (points.count - 1), point); points.setXYZ(i, point.x, point.y, point.z); }
      points.needsUpdate = true; line.geometry.computeBoundingSphere();
    }
  }
  selectMesh = index => {
    const mode = colorBy.value;
    blades.forEach(blade => {
      const item = items[blade.userData.index];
      blade.material = item.hidden ? fadedMaterial : materials.get(`${mode}:${mode === 'source' ? item.dataset.sourceKind : item.dataset.tier}`);
      const marker = highlightMarkers.get(blade.userData.index);
      if (marker) marker.visible = !item.hidden;
    });
    outline.removeFromParent(); clearConnections();
    if (blades[index] && !items[index].hidden) {
      blades[index].add(outline);
      plant.updateMatrixWorld(true);
      const start = plant.worldToLocal(blades[index].localToWorld(new THREE.Vector3(0, 0.38, 0)));
      const related = JSON.parse(items[index].dataset.related);
      for (const other of related) {
        if (!blades[other] || items[other].hidden) continue;
        const end = plant.worldToLocal(blades[other].localToWorld(new THREE.Vector3(0, 0.38, 0)));
        const middle = start.clone().lerp(end, 0.5); middle.z += 0.55;
        const path = new THREE.QuadraticBezierCurve3(start, middle, end);
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path.getPoints(24)), connectionMaterial);
        line.userData.from = index; line.userData.to = other; connections.add(line);
      }
      stage.dataset.connectionCount = String(connections.children.length);
    } else stage.dataset.connectionCount = '0';
    renderer.render(scene, camera);
  };
  selectMesh(selected);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function hit(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(blades, false).find(h => !items[h.object.userData.index].hidden)?.object;
  }
  let down;
  on(canvas, 'pointerdown', e => { down = [e.clientX, e.clientY]; });
  on(canvas, 'pointerup', e => {
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) {
      const blade = hit(e);
      if (blade) {
        select(blade.userData.index, true); hover.hidden = true;
        if (matchMedia('(max-width:760px)').matches) detail.scrollIntoView({ block: 'start', behavior: reduced.matches ? 'instant' : 'smooth' });
      }
    }
    down = null;
  });
  let hoveredIndex = -1;
  on(canvas, 'pointermove', e => {
    if (e.buttons) { hover.hidden = true; return; }
    const blade = hit(e); hover.hidden = !blade;
    if (blade) {
      const index = blade.userData.index;
      if (hoveredIndex !== index) {
        hover.replaceChildren(document.querySelector(`#cx-tooltip-${index}`).content.cloneNode(true)); hoveredIndex = index;
      }
      const rect = stage.getBoundingClientRect();
      hover.style.bottom = 'auto';
      hover.style.left = `${Math.max(8, Math.min(e.clientX - rect.left + 18, rect.width - hover.offsetWidth - 8))}px`;
      const visibleBottom = Math.min(rect.height, innerHeight - rect.top);
      hover.style.top = `${Math.max(8, Math.min(e.clientY - rect.top + 18, visibleBottom - hover.offsetHeight - 8))}px`;
    }
  });
  on(canvas, 'pointerleave', () => { hover.hidden = true; });
  let moving = motionPreference;
  function motionState() { pause.textContent = moving ? 'Pause motion' : 'Resume motion'; pause.setAttribute('aria-pressed', String(!moving)); }
  pause.disabled = false; reset.disabled = false;
  on(pause, 'click', () => { moving = !moving; motionPreference = moving; motionState(); });
  on(reduced, 'change', () => { moving = !reduced.matches; motionPreference = moving; motionState(); });
  on(reset, 'click', () => { controls.reset(); });
  motionState();
  controls.addEventListener('change', () => { stage.dataset.view = JSON.stringify(snapshot()); renderer.render(scene, camera); });
  const clock = new THREE.Clock(); let windTime = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (document.hidden) return;
    if (moving) windTime += dt;
    for (const { group, phase } of pinnae) {
      if (moving) {
        group.rotation.x = Math.sin(windTime * 0.48 + phase) * 0.035;
        group.rotation.y = Math.sin(windTime * 0.34 + phase) * 0.022;
      }
    }
    if (moving) followConnections();
    controls.update(); renderer.render(scene, camera);
  });
  on(canvas, 'webglcontextlost', event => {
    event.preventDefault(); renderer.setAnimationLoop(null); status.hidden = false;
    status.textContent = '3D paused · reload';
  });
  disposeScene = () => {
    events.abort(); resize.disconnect(); renderer.setAnimationLoop(null); controls.dispose();
    renderer.clear();
    const geometries = new Set(); plant.traverse(object => { if (object.geometry) geometries.add(object.geometry); });
    geometries.forEach(g => g.dispose());
    if (!geometries.has(outlineGeometry)) outlineGeometry.dispose();
    if (!geometries.has(highlightGeometry)) highlightGeometry.dispose();
    clearConnections();
    [stemMaterial, ...materials.values(), fadedMaterial, outlineMaterial, connectionMaterial].forEach(m => m.dispose());
    texture.dispose(); renderer.dispose(); selectMesh = () => {}; cameraSnapshot = () => null;
  };
  status.hidden = true;
  stage.dataset.ready = 'true'; stage.dataset.artifactCount = String(blades.length);
}
function unavailable() {
  status.hidden = false;
  status.textContent = '3D unavailable';
}
grow().catch(unavailable);


// Content refresh is independent of WebGL: a renderer failure never disables record updates.
let revision = document.querySelector('.cx-shell').dataset.revision;
let assistanceRevision = document.querySelector('.cx-shell').dataset.assistanceRevision;
const syncStatus = document.querySelector('#cx-sync');
let syncing = false;
let stopped = false;
let refreshTimer;
async function refreshCollection() {
  if (syncing || stopped) return;
  syncing = true;
  try {
    const response = await fetch(`/leaf/explore/state?revision=${encodeURIComponent(revision)}&assistanceRevision=${encodeURIComponent(assistanceRevision)}`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (response.status === 204) { syncStatus.textContent = 'Up to date'; return; }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'The collection could not be read.');
    const next = new DOMParser().parseFromString(payload.html, 'text/html');
    const shell = next.querySelector('.cx-shell');
    if (!shell || shell.dataset.revision !== payload.revision) throw new Error('The refreshed collection was incomplete.');
    if (shell.dataset.bundleReady === 'false') {
      throw new Error(next.querySelector('#cx-stage-status').textContent);
    }
    const nextItems = [...next.querySelectorAll('.cx-item')];
    const nextTemplates = [...next.querySelectorAll('template[id^="cx-record-"]')];
    const nextTooltips = [...next.querySelectorAll('template[id^="cx-tooltip-"]')];
    if (nextItems.length !== nextTemplates.length || nextItems.length !== nextTooltips.length) throw new Error('The refreshed artifact mapping was incomplete.');
    const selectedId = items[selected]?.dataset.id;
    const view = cameraSnapshot();
    disposeScene(); disposeScene = () => {};
    document.querySelector('#cx-list').replaceChildren(...nextItems);
    document.querySelectorAll('template[id^="cx-record-"],template[id^="cx-tooltip-"]').forEach(t => t.remove());
    document.querySelector('.cx-inspector').append(...nextTemplates, ...nextTooltips);
    document.querySelector('#cx-timeline').replaceWith(next.querySelector('#cx-timeline'));
    document.querySelector('#cx-highlights').replaceWith(next.querySelector('#cx-highlights'));
    document.querySelector('#cx-source-legend').replaceChildren(...next.querySelector('#cx-source-legend').childNodes);
    const nextPeriod = document.querySelector('#cx-period');
    if (![...nextPeriod.options].some(option => option.value === period)) period = 'all';
    nextPeriod.value = period;
    items = [...document.querySelectorAll('.cx-item')]; bindItems();
    selected = initialSelection(selectedId);
    detail.replaceChildren(...next.querySelector('#cx-detail').childNodes);
    document.querySelector('.cx-heading').replaceChildren(...next.querySelector('.cx-heading').childNodes);
    status.textContent = next.querySelector('#cx-stage-status').textContent; status.hidden = false;
    pause.disabled = true; reset.disabled = true; hover.hidden = true;
    select(selected); filterItems();
    await grow(view).catch(unavailable);
    revision = payload.revision; document.querySelector('.cx-shell').dataset.revision = revision;
    assistanceRevision = shell.dataset.assistanceRevision; document.querySelector('.cx-shell').dataset.assistanceRevision = assistanceRevision;
    syncStatus.textContent = 'Updated';
  } catch (error) {
    syncStatus.textContent = `Update failed: ${error.message}`;
  } finally { syncing = false; }
}
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => { await refreshCollection(); if (!stopped) scheduleRefresh(); }, document.hidden ? 30000 : 5000);
}
document.addEventListener('visibilitychange', () => { refreshCollection(); scheduleRefresh(); });
window.addEventListener('pagehide', () => { stopped = true; clearTimeout(refreshTimer); });
window.addEventListener('pageshow', () => { stopped = false; refreshCollection(); scheduleRefresh(); });
scheduleRefresh();
