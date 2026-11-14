/** A progressive enhancement of the records already on this page. No fetches or private data sources. */
import * as THREE from 'three';

const mounted = new Map();
let motionRequested = null;
const units = 72;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const orderName = value => ['newest', 'oldest'].includes(value) ? value : 'notable';

/** Shared lamina and vein meshes; every instance belongs to exactly one admitted DOM row. */
function leafGeometry() {
  const vertices = [], normals = [], uv = [], indices = [], edge = [], veins = [];
  const rows = 48, columns = 12;
  const widthAt = t => Math.pow(Math.sin(Math.PI * t), 0.72) * (1 - t * 0.24) * 0.46;
  const point = (t, across = 0) => new THREE.Vector3(
    widthAt(t) * across * (1 + 0.035 * Math.sin(t * 21)), t * 2.45,
    Math.sin(t * Math.PI) * (0.13 - across * across * 0.11) + t * t * 0.14,
  );
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= columns; j++) {
    const t = i / rows, across = j / columns * 2 - 1;
    vertices.push(...point(t, across).toArray()); normals.push(0, 0, 1); uv.push(j / columns, t);
    if (i < rows && j < columns) {
      const a = i * (columns + 1) + j, b = a + columns + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const surface = new THREE.BufferGeometry();
  surface.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  surface.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  surface.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  surface.setIndex(indices); surface.computeVertexNormals();
  for (let i = 0; i <= rows; i++) edge.push(point(i / rows, -1));
  for (let i = rows; i >= 0; i--) edge.push(point(i / rows, 1));
  const vein = (a, b) => { a.z += 0.012; b.z += 0.012; veins.push(...a.toArray(), ...b.toArray()); };
  for (let i = 0; i < rows; i++) vein(point(i / rows), point((i + 1) / rows));
  for (let rib = 1; rib <= 10; rib++) for (const side of [-1, 1]) {
    const base = rib / 12;
    for (let part = 0; part < 8; part++) {
      const a = part / 8, b = (part + 1) / 8;
      vein(point(base + a * 0.105, side * a * 0.94), point(base + b * 0.105, side * b * 0.94));
    }
  }
  return {
    surface,
    perimeter: new THREE.BufferGeometry().setFromPoints(edge),
    veins: new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(veins, 3)),
    diamond: new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.12, 0.26, 0.08), new THREE.Vector3(0, 0.38, 0.08),
      new THREE.Vector3(0.12, 0.26, 0.08), new THREE.Vector3(0, 0.14, 0.08),
    ]),
  };
}

/** Mount once per root; call dispose before replacing it, or dispatch foliage:portfolio-refresh afterwards. */
export function mountPortfolioLeaf(root) {
  mounted.get(root)?.dispose();
  const canvas = root.querySelector('[data-portfolio-canvas]');
  const journey = root.querySelector('[data-portfolio-journey]');
  const list = root.querySelector('[data-portfolio-records]');
  const status = root.querySelector('[data-portfolio-status]');
  const orderControl = root.querySelector('select[data-portfolio-order]');
  const collectionControl = root.querySelector('select[data-portfolio-collection]');
  const collectionNote = root.querySelector('[data-portfolio-collection-note]');
  const collectionEmpty = root.querySelector('[data-portfolio-collection-empty]');
  const motionControl = root.querySelector('button[data-portfolio-motion]');
  const orderNote = root.querySelector('[data-portfolio-order-note]');
  const carriedActiveId = root.dataset.portfolioActiveId ?? '';
  const carriedMotion = root.dataset.portfolioMotion;
  const announce = text => { if (status && status.textContent !== text) status.textContent = text; };
  root.dataset.portfolioReady = 'false'; root.dataset.portfolioError = '';
  root.dataset.portfolioActiveId = carriedActiveId; root.dataset.portfolioVisibleCount = '0';
  let disposed = false, graphicsAvailable = false, renderer, frame = 0, layoutFrame = 0, observer;
  const events = new AbortController();
  const on = (target, name, listener, options = {}) => target?.addEventListener(name, listener, { ...options, signal: events.signal });
  const geometry = new Set(), materials = new Set();
  function disposeGraphics() {
    graphicsAvailable = false; cancelAnimationFrame(frame); cancelAnimationFrame(layoutFrame);
    observer?.disconnect(); renderer?.clear(); renderer?.dispose(); renderer = undefined;
    geometry.forEach(value => value.dispose()); materials.forEach(value => value.dispose());
    geometry.clear(); materials.clear();
    root.classList.remove('lp-enhanced'); root.dataset.portfolioReady = 'false';
  }
  function dispose() {
    if (disposed) return;
    disposed = true; events.abort(); disposeGraphics(); mounted.delete(root); root.classList.remove('lp-interactive');
    root.querySelectorAll('[data-focus-leaflet],[data-portfolio-motion]').forEach(button => { button.disabled = true; });
  }
  function fail(error) {
    disposeGraphics(); root.classList.add('lp-no-webgl');
    if (motionControl) motionControl.disabled = true;
    root.dataset.portfolioError = error instanceof Error ? error.message : String(error);
    announce('3D view unavailable');
  }
  const handle = { dispose, refresh: () => queueLayout() };
  mounted.set(root, handle);
  let queueLayout = () => {};
  try {
    if (!list && root.querySelector('[data-record-id]')) throw new Error('The ordered portfolio record list is missing.');
    const rows = list ? [...list.querySelectorAll('[data-record-id]')] : [];
    if (new Set(rows.map(row => row.dataset.recordId)).size !== rows.length || rows.some(row => !row.dataset.recordId)) throw new Error('Portfolio record identifiers must be present and unique.');
    const collectionIds = node => {
      const value = JSON.parse(node.dataset.collectionIds || '[]');
      if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) throw new Error('Portfolio collection membership must be a list of identifiers.');
      return value;
    };
    const presentationStyles = node => {
      const base = JSON.parse(node.dataset.baseStyle || '{}');
      const collections = JSON.parse(node.dataset.collectionStyles || '{}');
      const valid = value => value && typeof value === 'object' && ['editorial', 'clean'].includes(value.typography) && ['airy', 'compact'].includes(value.spacing) && ['source', 'quiet'].includes(value.palette) && ['branching', 'linear'].includes(value.layout) && ['split', 'stacked'].includes(value.hero) && ['contained', 'immersive'].includes(value.media);
      if (!valid(base) || !collections || typeof collections !== 'object' || Array.isArray(collections) || Object.values(collections).some(value => !valid(value))) throw new Error('Portfolio presentation styles must use supported presets.');
      return { base, collections };
    };
    const rootStyles = presentationStyles(root);
    const records = rows.map((row, index) => ({ row, id: row.dataset.recordId,
      collections: collectionIds(row),
      styles: presentationStyles(row),
      index: Number.isFinite(Number(row.dataset.documentIndex)) ? Number(row.dataset.documentIndex) : index,
      featured: Number(row.dataset.featuredOrder ?? -1), leading: row.dataset.leading === 'true',
      date: row.dataset.date ? Date.parse(row.dataset.date) : NaN,
      title: row.querySelector('h2,h3,h4')?.textContent?.trim() || row.dataset.recordId,
      source: ['git', 'photosynthesis'].includes(row.dataset.sourceKind) ? row.dataset.sourceKind : 'other',
    }));
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const keystones = [...root.querySelectorAll('[data-achievement-id]')].map(node => ({ node, collections: collectionIds(node) }));
    const paged = root.dataset.portfolioPaged === 'true';
    const choices = new Set(collectionControl ? [...collectionControl.options].map(option => option.value) : ['']);
    const requestedCollection = new URL(location.href).searchParams.get('collection') ?? root.dataset.portfolioCollection ?? collectionControl?.value ?? '';
    let collection = choices.has(requestedCollection) ? requestedCollection : '';
    let moving = carriedMotion === 'paused' ? false : carriedMotion === 'moving' ? true : motionRequested ?? !preference.matches;
    let order = orderName(new URL(location.href).searchParams.get('order') ?? orderControl?.value);
    let ordered = [], measured = [], blades = [], pinnae = [], journeyTop = 0, height = 0, width = 0, activeId = '';
    let terminal = null, lastTime = 0, wind = 0, lastScroll = NaN;
    let restoreActive = carriedActiveId;
    let focusedRecordId = "";
    // Sorting and reading a record remain functional even when this browser cannot create WebGL.
    applyOrder();
    const readingViewport = matchMedia('(max-width:760px)');
    on(readingViewport, 'change', () => {
      ordered.forEach((record, index) => { record.row.dataset.portfolioSide = readingViewport.matches || record.activeStyle.layout === 'linear' || index % 2 ? 'right' : 'left'; });
    });
    if (restoreActive) activate(ordered.find(record => record.id === restoreActive));
    if (collectionControl) collectionControl.disabled = false;
    root.classList.add('lp-interactive');
    root.querySelectorAll('[data-focus-leaflet]').forEach(button => { button.disabled = false; });
    on(root, 'click', event => {
      const citation = event.target.closest?.('a[data-evidence-citation]');
      if (citation && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && citation.target !== '_blank') {
        const url = new URL(citation.href, location.href);
        if (url.origin === location.origin && url.pathname === location.pathname && revealCitation(url.hash)) {
          event.preventDefault();
          const current = new URL(location.href); current.hash = url.hash; history.replaceState(null, '', current);
        }
      }
      const button = event.target.closest?.('[data-focus-leaflet]');
      if (button) focusRecord(ordered.find(record => record.id === button.closest('[data-record-id]')?.dataset.recordId));
    });
    on(window, 'hashchange', () => revealCitation(location.hash));
    on(collectionControl, 'change', () => {
      collection = choices.has(collectionControl.value) ? collectionControl.value : '';
      if (paged) {
        const url = new URL(location.href);
        if (collection) url.searchParams.set('collection', collection); else url.searchParams.delete('collection');
        url.searchParams.delete('page'); url.hash = 'leaf-highlights';
        location.assign(url.href); return;
      }
      applyOrder(); updateLocation();
      if (graphicsAvailable) measure();
      const selected = collectionControl.selectedOptions[0]?.textContent?.trim() || 'All work';
      announce(`${selected}: ${ordered.length} ${ordered.length === 1 ? 'Leaflet' : 'Leaflets'}`);
      root.dispatchEvent(new CustomEvent('foliage:portfolio-collection', { bubbles: true, detail: { id: collection } }));
    });
    on(orderControl, 'change', () => {
      if (paged) {
        const url = new URL(location.href);
        url.searchParams.set('order', orderName(orderControl.value));
        url.searchParams.delete('page'); url.hash = 'leaf-highlights';
        location.assign(url.href); return;
      }
      order = orderName(orderControl.value); applyOrder();
      if (graphicsAvailable) measure();
      updateLocation();
      journey?.scrollIntoView({ block: 'start', behavior: preference.matches ? 'instant' : 'smooth' });
      announce('Order updated');
    });
    revealCitation(location.hash);
    if (!rows.length) {
      root.dataset.portfolioReady = 'true'; root.dataset.portfolioBladeCount = '0';
      if (motionControl) motionControl.disabled = true;
      announce('No Leaflets');
      return handle;
    }
    if (!(canvas instanceof HTMLCanvasElement) || !journey) throw new Error('The portfolio canvas or record layout is missing.');
    const styles = getComputedStyle(root);
    const color = name => {
      const value = styles.getPropertyValue(name).trim();
      if (!value) throw new Error(`Portfolio color token ${name} is unavailable.`);
      return new THREE.Color(value);
    };
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    graphicsAvailable = true;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
    renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.z = 24;
    const forest = color('--fol-evergreen-500');
    const light = color('--fol-paper');
    scene.add(new THREE.HemisphereLight(light, forest.clone().multiplyScalar(0.24), 2.1));
    const sun = new THREE.DirectionalLight(light, 2.25); sun.position.set(-4, 6, 12); scene.add(sun);
    const rim = new THREE.DirectionalLight(light, 1.35); rim.position.set(5, -2, -4); scene.add(rim);
    const plant = new THREE.Group(); scene.add(plant);
    const meshes = leafGeometry(); Object.values(meshes).forEach(value => geometry.add(value));
    const material = value => { materials.add(value); return value; };
    const sourceMaterials = Object.fromEntries(['git', 'photosynthesis', 'other'].map(source => [source,
      material(new THREE.MeshPhysicalMaterial({ color: color(`--fol-record-${source}`), roughness: 0.64,
        metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.72, transparent: true, opacity: 0.94, side: THREE.DoubleSide })),
    ]));
    const quietMaterial = material(new THREE.MeshPhysicalMaterial({ color: color('--fol-role-fg-tertiary'), roughness: 0.68,
      metalness: 0, clearcoat: 0.08, clearcoatRoughness: 0.76, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    const stemMaterial = material(new THREE.MeshStandardMaterial({ color: forest.clone().multiplyScalar(1.24), roughness: 0.8 }));
    const veinMaterial = material(new THREE.LineBasicMaterial({ color: light, transparent: true, opacity: 0.24, depthWrite: false }));
    const choiceMaterial = material(new THREE.LineBasicMaterial({ color: color('--fol-text'), transparent: true, opacity: 0.92 }));
    const outline = new THREE.LineLoop(meshes.perimeter, choiceMaterial); outline.scale.setScalar(1.04); outline.position.z = 0.025;
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();

    function motionLabel() {
      root.dataset.portfolioMotion = moving ? 'moving' : 'paused';
      if (!motionControl) return;
      motionControl.disabled = !ordered.length;
      motionControl.textContent = moving ? 'Pause motion' : 'Resume motion';
      motionControl.setAttribute('aria-pressed', String(!moving));
    }
    function orderMessage() {
      return order === 'notable' ? '' : orderNote?.dataset.dateNote ?? '';
    }
    function applyOrder() {
      const focus = root.contains(document.activeElement) ? document.activeElement : null;
      const visible = record => !collection || record.collections.includes(collection);
      records.forEach(record => { record.row.hidden = !visible(record); });
      const activeRootStyle = rootStyles.collections[collection] ?? rootStyles.base;
      root.dataset.readingTypography = activeRootStyle.typography;
      root.dataset.readingSpacing = activeRootStyle.spacing;
      root.dataset.readingPalette = activeRootStyle.palette;
      root.dataset.readingLayout = activeRootStyle.layout;
      root.dataset.readingHero = activeRootStyle.hero;
      root.dataset.readingMedia = activeRootStyle.media;
      records.forEach(record => {
        const activeStyle = record.styles.collections[collection] ?? record.styles.base;
        record.activeStyle = activeStyle;
        record.row.dataset.readingTypography = activeStyle.typography;
        record.row.dataset.readingSpacing = activeStyle.spacing;
        record.row.dataset.readingPalette = activeStyle.palette;
        record.row.dataset.readingLayout = activeStyle.layout;
        record.row.dataset.readingHero = activeStyle.hero;
        record.row.dataset.readingMedia = activeStyle.media;
      });
      keystones.forEach(item => { item.node.hidden = !visible(item); });
      ordered = records.filter(visible).sort((a, b) => {
        if (order === 'notable') {
          if (a.leading !== b.leading) return a.leading ? -1 : 1;
          const aFeatured = a.featured >= 0, bFeatured = b.featured >= 0;
          if (aFeatured !== bFeatured) return aFeatured ? -1 : 1;
          return aFeatured && bFeatured ? a.featured - b.featured || a.index - b.index : a.index - b.index;
        }
        if (Number.isFinite(a.date) !== Number.isFinite(b.date)) return Number.isFinite(a.date) ? -1 : 1;
        return Number.isFinite(a.date) ? (order === 'newest' ? b.date - a.date : a.date - b.date) || a.index - b.index : a.index - b.index;
      });
      const mobile = matchMedia('(max-width:760px)').matches;
      ordered.forEach((record, index) => { record.row.dataset.portfolioSide = mobile || record.activeStyle.layout === 'linear' || index % 2 ? 'right' : 'left'; });
      list?.append(...ordered.map(record => record.row));
      if (focus?.closest('[hidden]')) collectionControl?.focus({ preventScroll: true });
      else focus?.focus({ preventScroll: true });
      if (orderControl) { orderControl.disabled = !ordered.length; orderControl.value = order; }
      if (collectionControl) collectionControl.value = collection;
      root.dataset.portfolioCollection = collection;
      root.dataset.portfolioFilteredCount = String(ordered.length);
      root.dataset.portfolioAchievementCount = String(keystones.filter(visible).length);
      root.querySelectorAll('[data-portfolio-keystone-empty]').forEach(node => { node.hidden = !collection || keystones.some(visible); });
      root.querySelectorAll('[data-portfolio-visible-count]').forEach(node => { node.textContent = String(ordered.length); });
      root.querySelectorAll('input[type="hidden"][name="order"]').forEach(input => { input.value = order; });
      root.querySelectorAll('input[type="hidden"][name="collection"]').forEach(input => { input.value = collection; });
      if (motionControl && graphicsAvailable) motionControl.disabled = !ordered.length;
      if (collectionEmpty) collectionEmpty.hidden = ordered.length > 0 || !collection;
      if (collectionNote) {
        collectionNote.textContent = collectionControl?.selectedOptions[0]?.dataset.description ?? '';
        collectionNote.hidden = !collectionNote.textContent;
      }
      if (activeId && !ordered.some(record => record.id === activeId)) {
        activeId = ''; root.dataset.portfolioActiveId = ''; restoreActive = '';
        rows.forEach(row => { row.dataset.portfolioActive = 'false'; row.querySelector('[data-focus-leaflet]')?.setAttribute('aria-pressed', 'false'); });
      }
      if (restoreActive && !ordered.some(record => record.id === restoreActive)) {
        restoreActive = ''; root.dataset.portfolioActiveId = '';
      }
      root.dataset.portfolioOrder = order;
      terminal = order === 'notable' ? ordered.find(record => record.leading) ?? null : null;
      root.dataset.portfolioLeadingPosition = terminal ? 'terminal' : ordered.some(record => record.leading) ? 'in-order' : 'unselected';
      root.querySelectorAll('[data-leading-label]').forEach(label => { label.textContent = order === 'notable' ? 'Leading tip' : 'Highlight'; });
      if (orderNote) orderNote.textContent = orderMessage();
      let previousPeriod = '';
      for (const record of ordered) {
        const period = Number.isFinite(record.date) ? new Date(record.date).toISOString().slice(0, 7) : 'undated';
        const starts = order !== 'notable' && period !== previousPeriod;
        let marker = record.row.querySelector('.lp-period');
        if (starts) {
          record.row.dataset.portfolioPeriodStart = period;
          if (!marker) { marker = document.createElement('span'); marker.className = 'lp-period fol-metric'; record.row.prepend(marker); }
          if (Number.isFinite(record.date)) {
            const month = marker.tagName === 'TIME' ? marker : document.createElement('time'); month.dateTime = period;
            month.textContent = new Date(record.date).toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
            if (month !== marker) marker.replaceChildren(month);
          } else {
            marker.removeAttribute('datetime');
            marker.textContent = root.dataset.datePurpose === 'work' ? 'No work date' : 'No observed date';
          }
          marker.hidden = false;
        } else { delete record.row.dataset.portfolioPeriodStart; if (marker) marker.hidden = true; }
        previousPeriod = period;
      }
    }
    function updateLocation() {
      const url = new URL(location.href); url.searchParams.set('order', order);
      if (collection) url.searchParams.set('collection', collection); else url.searchParams.delete('collection');
      const anchor = hashTarget(url.hash);
      if (anchor?.closest('[hidden]')) url.hash = '';
      history.replaceState(null, '', url);
    }
    function hashTarget(hash) {
      if (!hash || hash === '#') return null;
      try { const target = document.getElementById(decodeURIComponent(hash.slice(1))); return target && root.contains(target) ? target : null; }
      catch { return null; }
    }
    function revealCitation(hash) {
      const target = hashTarget(hash);
      if (!target) return false;
      const record = records.find(item => item.row.contains(target));
      if (target.closest('[hidden]') && collection) { collection = ''; applyOrder(); updateLocation(); }
      if (target.closest('[hidden]')) return false;
      for (let node = target; node && node !== root; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
      root.querySelectorAll('[data-citation-active]').forEach(node => { delete node.dataset.citationActive; });
      if (record || target.matches('[data-claim-id],[id^="claim-"]')) target.dataset.citationActive = 'true';
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.scrollIntoView({ block: 'center', behavior: 'instant' }); target.focus({ preventScroll: true });
      if (record) activate(record);
      queueLayout();
      return true;
    }
    function tube(points, radius, segments = 22, taper = false) {
      const curve = new THREE.CatmullRomCurve3(points);
      const shape = new THREE.TubeGeometry(curve, segments, radius, 6, false);
      if (taper) {
        const positions = shape.getAttribute('position');
        for (let section = 0; section <= segments; section++) {
          const center = curve.getPointAt(section / segments), factor = 0.38 + 0.62 * section / segments;
          for (let around = 0; around <= 6; around++) {
            const index = section * 7 + around;
            const point = new THREE.Vector3().fromBufferAttribute(positions, index).sub(center).multiplyScalar(factor).add(center);
            positions.setXYZ(index, point.x, point.y, point.z);
          }
        }
        shape.computeVertexNormals();
      }
      geometry.add(shape);
      return new THREE.Mesh(shape, stemMaterial);
    }
    function clearPlant() {
      outline.removeFromParent();
      plant.traverse(object => {
        if (object.geometry && !Object.values(meshes).includes(object.geometry)) { object.geometry.dispose(); geometry.delete(object.geometry); }
      });
      plant.clear(); blades = []; pinnae = [];
    }
    function measure() {
      if (disposed || !graphicsAvailable) return;
      if (!ordered.length) {
        clearPlant(); measured = []; renderer.clear(); cancelAnimationFrame(frame); frame = 0;
        root.dataset.portfolioBladeCount = '0'; root.dataset.portfolioVisibleCount = '0'; root.dataset.portfolioTerminalId = '';
        root.dataset.portfolioReady = 'true';
        return;
      }
      if (activeId) restoreActive = activeId;
      const box = canvas.getBoundingClientRect();
      width = box.width; height = box.height;
      if (width <= 0 || height <= 0) return;
      const mobile = matchMedia('(max-width:760px)').matches;
      ordered.forEach((record, index) => { record.row.dataset.portfolioSide = mobile || record.activeStyle.layout === 'linear' || index % 2 ? 'right' : 'left'; });
      journeyTop = journey.getBoundingClientRect().top + scrollY;
      const stemPosition = Number.parseFloat(getComputedStyle(root).getPropertyValue('--portfolio-stem-position'));
      const axis = width * (Number.isFinite(stemPosition) ? clamp(stemPosition, 0.05, 0.95) : mobile ? 0.12 : 0.5);
      const stemX = (axis - width / 2) / units;
      measured = ordered.map(record => {
        const row = record.row.getBoundingClientRect();
        const panel = (record.row.querySelector('[data-portfolio-panel]') ?? record.row).getBoundingClientRect();
        const side = record.row.dataset.portfolioSide === 'left' ? -1 : 1;
        const edge = side < 0 ? panel.right - box.left : panel.left - box.left;
        return { ...record, side, top: row.top + scrollY, bottom: row.bottom + scrollY, height: row.height,
          y: panel.top + scrollY - journeyTop + Math.min(panel.height / 2, 210),
          space: Math.max(0, Math.abs(edge - axis) - 10) };
      });
      clearPlant();
      renderer.setSize(width, height, false);
      camera.left = -width / units / 2; camera.right = width / units / 2;
      camera.top = height / units / 2; camera.bottom = -height / units / 2; camera.updateProjectionMatrix();
      const top = Math.min(...measured.map(record => record.y));
      const bottom = Math.max(...measured.map(record => record.y)) + 82;
      const rachisX = y => stemX + Math.sin((y - top) / 470) * (mobile ? 0.025 : 0.09);
      const count = Math.max(8, Math.min(4000, Math.ceil((bottom - top) / 50)));
      const stemTop = terminal ? top + 78 : Math.max(0, top - 72);
      plant.add(tube(Array.from({ length: count + 1 }, (_, index) => {
        const y = stemTop + (bottom - stemTop) * index / count;
        return new THREE.Vector3(rachisX(y), -y / units, Math.sin(y / 550) * 0.055);
      }), mobile ? 0.018 : 0.025, count, true));
      for (const [index, record] of measured.entries()) {
        const isTerminal = record.id === terminal?.id;
        const group = new THREE.Group();
        const envelope = 0.64 + 0.36 * Math.pow(Math.sin(Math.PI * (index + 1) / (measured.length + 1)), 0.6);
        const desiredLength = isTerminal ? (mobile ? 115 : 215) : mobile ? clamp(record.space * 1.5, 100, 155)
          : clamp(Math.max(record.space * 1.35, record.height * 0.60) * envelope, 160, 380);
        const angle = isTerminal ? -0.035 : -record.side * (mobile ? 0.25 : width <= 1000 ? 0.32 : 0.67);
        const baseOffset = isTerminal ? 0 : mobile ? 3 : width <= 1000 ? 6 : 11.5;
        // Bound the actual rotated lamina, including its belly, by the adjacent panel edge.
        const vertices = meshes.surface.getAttribute('position');
        let reach = 0;
        for (let point = 0; point < vertices.count; point++) {
          reach = Math.max(reach, record.side * (vertices.getX(point) * Math.cos(angle) - vertices.getY(point) * Math.sin(angle)) / 2.45);
        }
        const length = isTerminal ? desiredLength : Math.min(desiredLength, Math.max(8, record.space - baseOffset) / Math.max(reach * 1.04, 0.01));
        const scale = length / units / 2.45;
        group.position.set(rachisX(record.y) + record.side * baseOffset / units, -(record.y + (isTerminal ? 78 : 30)) / units, 0.07);
        group.rotation.z = angle;
        group.scale.set(scale, scale, scale);
        const blade = new THREE.Mesh(meshes.surface, record.activeStyle.palette === 'quiet' ? quietMaterial : sourceMaterials[record.source]);
        blade.userData.record = record; group.add(blade);
        group.add(new THREE.LineSegments(meshes.veins, veinMaterial));
        if (record.featured >= 0 || record.leading) group.add(new THREE.LineLoop(meshes.diamond, choiceMaterial));
        plant.add(group); blades.push(blade);
        if (!isTerminal) plant.add(tube([
          new THREE.Vector3(rachisX(record.y + 62), -(record.y + 62) / units, 0),
          new THREE.Vector3(rachisX(record.y + 44) + record.side * 0.10, -(record.y + 44) / units, 0.07),
          group.position.clone(),
        ], 0.014));
        pinnae.push({ group, record, scale, phase: index * 1.27 });
      }
      root.dataset.portfolioBladeCount = String(blades.length);
      root.dataset.portfolioTerminalId = terminal?.id ?? '';
      lastScroll = NaN;
      cancelAnimationFrame(frame); frame = 0;
      safeDraw(performance.now(), true);
    }
    function activate(record, announceRecord = false) {
      if (!record) return;
      if (activeId !== record.id) {
        activeId = record.id; root.dataset.portfolioActiveId = activeId;
        for (const row of rows) {
          const active = row.dataset.recordId === activeId;
          row.dataset.portfolioActive = String(active);
          row.querySelector('[data-focus-leaflet]')?.setAttribute('aria-pressed', String(active));
        }
      }
      if (graphicsAvailable) {
        const selectedBlade = blades.find(blade => blade.userData.record.id === activeId);
        if (outline.parent !== selectedBlade) { outline.removeFromParent(); selectedBlade?.add(outline); }
      }
      if (announceRecord) announce(record.title);
    }
    function focusRecord(record, openEvidence = false) {
      if (!record) return;
      focusedRecordId = record.id;
      activate(record, true);
      const evidence = openEvidence ? record.row.querySelector('details[data-portfolio-evidence],details.lp-evidence,details.pub-evidence') : null;
      if (evidence) evidence.open = true;
      const target = evidence?.querySelector(':scope > summary') ?? record.row;
      target.scrollIntoView({ block: 'center', behavior: preference.matches ? 'instant' : 'smooth' });
      if (evidence) target.focus({ preventScroll: true });
      root.dispatchEvent(new CustomEvent('foliage:portfolio-focus', { bubbles: true, detail: { id: record.id } }));
      requestDraw();
    }
    function draw(now, initial = false) {
      frame = 0;
      if (disposed || !graphicsAvailable || (!initial && document.hidden) || !width) return;
      const canvasTop = canvas.getBoundingClientRect().top;
      const rootBox = root.getBoundingClientRect();
      if (!initial && (rootBox.bottom <= 0 || rootBox.top >= innerHeight)) { lastTime = now; return; }
      const dt = Math.min((now - (lastTime || now)) / 1000, 0.06); lastTime = now;
      if (moving) wind += dt;
      const screenTop = scrollY + canvasTop, screenCenter = screenTop + height / 2;
      camera.position.y = -(screenCenter - journeyTop) / units;
      sun.position.y = camera.position.y + 5; sun.target.position.y = camera.position.y;
      rim.position.y = camera.position.y - 2; rim.target.position.y = camera.position.y;
      sun.target.updateMatrixWorld(); rim.target.updateMatrixWorld();
      const visible = measured.filter(record => record.bottom > screenTop && record.top < screenTop + height);
      root.dataset.portfolioVisibleCount = String(visible.length);
      if (lastScroll !== scrollY) {
        const nearest = visible.reduce((best, record) => !best || Math.abs(record.y + journeyTop - screenCenter) < Math.abs(best.y + journeyTop - screenCenter) ? record : best, null);
        activate(measured.find(record => record.id === focusedRecordId) ?? measured.find(record => record.id === restoreActive) ?? nearest); restoreActive = ''; lastScroll = scrollY;
      }
      for (const state of pinnae) {
        const center = state.record.y + journeyTop;
        if (center < screenTop - 350 || center > screenTop + height + 350) { state.group.visible = false; continue; }
        state.group.visible = true;
        const unfurl = smooth((screenTop + height * 0.93 - center) / Math.max(140, height * 0.46));
        const openness = preference.matches ? 1 : unfurl;
        state.group.scale.x = state.scale * (0.24 + openness * 0.76);
        state.group.rotation.y = state.record.side * (1 - openness) * 0.92 + Math.sin(wind * 0.46 + state.phase) * 0.045;
        state.group.rotation.x = Math.sin(wind * 0.37 + state.phase) * 0.028;
        state.record.row.style.setProperty('--lp-unfold', String(openness));
      }
      renderer.render(scene, camera);
      if (!root.classList.contains('lp-enhanced')) {
        root.classList.remove('lp-no-webgl'); root.classList.add('lp-enhanced'); root.dataset.portfolioReady = 'true';
      }
      if (moving) requestDraw();
    }
    function safeDraw(now, initial = false) { try { draw(now, initial); } catch (error) { fail(error); } }
    function requestDraw() { if (!disposed && graphicsAvailable && ordered.length && !frame && !document.hidden) frame = requestAnimationFrame(safeDraw); }
    queueLayout = () => { if (!disposed && !layoutFrame) layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; try { measure(); } catch (error) { fail(error); } }); };
    function hit(event) {
      const box = canvas.getBoundingClientRect();
      pointer.set((event.clientX - box.left) / box.width * 2 - 1, -(event.clientY - box.top) / box.height * 2 + 1);
      scene.updateMatrixWorld(); camera.updateMatrixWorld(); raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(blades, false).find(item => item.object.parent.visible)?.object.userData.record;
    }
    on(canvas, 'click', event => focusRecord(hit(event), true));
    on(canvas, 'pointermove', event => {
      if (event.pointerType === 'touch' || event.buttons) return;
      const record = hit(event); canvas.style.cursor = record ? 'pointer' : 'default';
      if (record) { activate(record, true); requestDraw(); }
    });
    on(canvas, 'keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const at = Math.max(0, measured.findIndex(record => record.id === activeId));
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? measured.length - 1 : clamp(at + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1), 0, measured.length - 1);
      focusRecord(measured[index], true);
    });
    on(motionControl, 'click', () => { moving = !moving; motionRequested = moving; motionLabel(); requestDraw(); });
    on(preference, 'change', () => { moving = !preference.matches; motionRequested = null; motionLabel(); requestDraw(); });
    // A clicked leaf keeps selection through its own scroll; manual movement resumes tracking.
    const followReading = () => { focusedRecordId = ''; };
    on(window, 'wheel', followReading, { passive: true });
    on(window, 'touchstart', followReading, { passive: true });
    on(window, 'keydown', event => {
      if (event.target !== canvas && ['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '].includes(event.key)) followReading();
    });
    on(window, 'scroll', requestDraw, { passive: true });
    on(window, 'resize', queueLayout, { passive: true });
    on(document, 'visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else requestDraw(); });
    on(canvas, 'webglcontextlost', event => { event.preventDefault(); fail(new Error('WebGL context lost.')); });
    observer = new ResizeObserver(queueLayout); observer.observe(journey); observer.observe(canvas);
    measure();
    if (graphicsAvailable) {
      motionLabel();
    }
    requestDraw();
  } catch (error) { fail(error); }
  return handle;
}

function mountAll() {
  for (const [root, handle] of mounted) if (!root.isConnected) handle.dispose();
  for (const root of document.querySelectorAll('[data-leaf-portfolio]')) {
    if (mounted.has(root)) mounted.get(root).refresh(); else mountPortfolioLeaf(root);
  }
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll, { once: true });
  else mountAll();
  document.addEventListener('foliage:portfolio-before-refresh', event => {
    const target = event.detail?.root;
    for (const [root, handle] of mounted) if (!target || root === target || target.contains?.(root)) handle.dispose();
  });
  document.addEventListener('foliage:portfolio-refresh', mountAll);
  window.addEventListener('pagehide', () => { for (const handle of mounted.values()) handle.dispose(); });
  window.addEventListener('pageshow', mountAll);
}
