import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const state = {
  models: [],
  activeModelId: null,
  autoRotate: true,
  autoRotateSpeed: 1.5,
  wireframe: false,
  useVertexColors: true,
  showGrid: true,
  bgPreset: 'light-gray',
  exposure: 1.1,
  mixer: null,
  activeAction: null,
  isPlaying: true,
  playbackSpeed: 1.0,
  isScrubbing: false,
  cameraTransition: null,
  selectedTarget: null,
  gizmoMode: 'rotate',
  gizmoSpace: 'local',
  isDraggingGizmo: false,
  isOrbiting: false,
  manualDuration: 4.0,
  manualTracks: new Map(),
  restPoses: new WeakMap(),
  manualClipIndex: -1,
  pendingTextureMaterial: null,
  searchQuery: '',
};

const BG_PRESETS = {
  'light-gray':  { color: 0xf8f9fa, label: 'Light',       gridCenter: 0xa2a9b1, gridLine: 0xeaecf0 },
  'dark-studio': { color: 0x111216, label: 'Dark Studio', gridCenter: 0x3f3f46, gridLine: 0x202126 },
  'charcoal':    { color: 0x232730, label: 'Charcoal',    gridCenter: 0x525b70, gridLine: 0x323846 },
  'deep-navy':   { color: 0x0a1428, label: 'Deep Navy',   gridCenter: 0x2b4570, gridLine: 0x152544 },
};

const container = document.getElementById('viewport-container');
const canvas = document.getElementById('three-canvas');
const dropOverlay = document.getElementById('drop-overlay');
const fileInput = document.getElementById('file-input');
const textureInput = document.getElementById('texture-input');
const modelsPanel = document.getElementById('models-panel');
const studioPanel = document.getElementById('studio-panel');
const restoreModelsBtn = document.getElementById('restore-models-btn');
const modelsListEl = document.getElementById('models-list');
const materialsListEl = document.getElementById('materials-list');
const textureStatusBadge = document.getElementById('texture-status-badge');
const modelCountBadge = document.getElementById('model-count-badge');
const loadingPill = document.getElementById('loading-pill');
const loadingText = document.getElementById('loading-text');
const toastContainer = document.getElementById('toast-container');

const animationBar = document.getElementById('animation-bar');
const animPlayBtn = document.getElementById('anim-play-btn');
const iconPause = document.getElementById('icon-pause');
const iconPlay = document.getElementById('icon-play');
const animClipSelect = document.getElementById('anim-clip-select');
const animScrubber = document.getElementById('anim-scrubber');
const animTimecode = document.getElementById('anim-timecode');
const inspectorBadge = document.getElementById('inspector-badge');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = state.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG_PRESETS[state.bgPreset].color);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
const roomEnvTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = roomEnvTexture;
scene.environmentIntensity = 0.85;

const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.05, 500);
camera.position.set(3.2, 2.2, 3.8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.screenSpacePanning = true;
controls.minDistance = 0.2;
controls.maxDistance = 100;
controls.autoRotate = state.autoRotate;
controls.autoRotateSpeed = state.autoRotateSpeed;
controls.target.set(0, 1.0, 0);

controls.addEventListener('start', () => {
  state.cameraTransition = null;
  state.isOrbiting = true;
  if (!state.isDraggingGizmo) {
    canvas.classList.add('is-orbiting');
  }
});
controls.addEventListener('end', () => {
  state.isOrbiting = false;
  canvas.classList.remove('is-orbiting');
});

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setMode(state.gizmoMode);
transformControls.setSpace(state.gizmoSpace);
transformControls.setSize(window.innerWidth < 768 ? 1.05 : 0.8);
const gizmoHelper = transformControls.getHelper();
scene.add(gizmoHelper);

let skeletonHelper = null;
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const pointerDownPos = new THREE.Vector2();
let pointerDownTime = 0;

transformControls.addEventListener('dragging-changed', (event) => {
  state.isDraggingGizmo = event.value;
  controls.enabled = !event.value;
  canvas.classList.toggle('is-posing', event.value);
  if (event.value) {
    if (state.isPlaying && state.activeAction) {
      state.isPlaying = false;
      state.activeAction.paused = true;
      updatePlayPauseUI();
    }
  }
});

const hemiLight = new THREE.HemisphereLight(0xffffff, 0xd8dee9, 0.55);
hemiLight.position.set(0, 10, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
dirLight.position.set(4.5, 7.5, 5.5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 25;
const d = 4.5;
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);

const rimLight = new THREE.DirectionalLight(0xdbeafe, 0.65);
rimLight.position.set(-5, 3, -5);
scene.add(rimLight);

let gridHelper = new THREE.GridHelper(10, 20, BG_PRESETS['light-gray'].gridCenter, BG_PRESETS['light-gray'].gridLine);
gridHelper.material.opacity = 0.85;
gridHelper.material.transparent = true;
scene.add(gridHelper);

const shadowPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 16),
  new THREE.ShadowMaterial({ opacity: 0.18 })
);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://unpkg.com/three@0.170.0/examples/jsm/libs/draco/gltf/');

function setAnimationBarVisible(visible) {
  animationBar.classList.toggle('hidden', !visible);
}

function createShowcaseModel() {
  const root = new THREE.Group();
  root.name = 'StudioShowcaseCore';

  const slateMetalMat = new THREE.MeshStandardMaterial({
    name: 'Slate_Titanium',
    color: 0x202122,
    metalness: 0.82,
    roughness: 0.25,
  });
  const brushedSilverMat = new THREE.MeshStandardMaterial({
    name: 'Brushed_Aluminum',
    color: 0xc8ccd1,
    metalness: 0.88,
    roughness: 0.2,
  });
  const wikiBlueMat = new THREE.MeshStandardMaterial({
    name: 'Progressive_Blue',
    color: 0x3366cc,
    emissive: 0x1e3a8a,
    emissiveIntensity: 0.35,
    metalness: 0.4,
    roughness: 0.22,
  });
  const glassCoreMat = new THREE.MeshPhysicalMaterial({
    name: 'Optical_Core',
    color: 0xdbeafe,
    metalness: 0.05,
    roughness: 0.08,
    transmission: 0.72,
    thickness: 0.8,
    ior: 1.48,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 0.14, 64), slateMetalMat);
  base.position.y = 0.07;
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);

  const baseRing = new THREE.Mesh(new THREE.TorusGeometry(1.16, 0.02, 24, 64), wikiBlueMat);
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = 0.14;
  root.add(baseRing);

  const gimbalPivot = new THREE.Group();
  gimbalPivot.name = 'GimbalPivot';
  gimbalPivot.position.y = 1.35;
  root.add(gimbalPivot);

  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.055, 32, 80), brushedSilverMat);
  outerRing.castShadow = true;
  gimbalPivot.add(outerRing);

  const midRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.045, 28, 72), slateMetalMat);
  midRing.name = 'MidRing';
  midRing.rotation.y = Math.PI / 4;
  midRing.castShadow = true;
  gimbalPivot.add(midRing);

  const coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), glassCoreMat);
  coreMesh.name = 'CrystalCore';
  coreMesh.castShadow = true;
  gimbalPivot.add(coreMesh);

  const innerCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), wikiBlueMat);
  innerCore.name = 'InnerEnergyCore';
  gimbalPivot.add(innerCore);

  const times = [0, 3, 6];
  const midRingTrack = new THREE.QuaternionKeyframeTrack(
    'MidRing.quaternion',
    times,
    [
      ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)).toArray(),
      ...new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, Math.PI, 0)).toArray(),
      ...new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI * 2, Math.PI * 2, 0)).toArray(),
    ]
  );
  const coreTrack = new THREE.QuaternionKeyframeTrack(
    'CrystalCore.quaternion',
    times,
    [
      ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)).toArray(),
      ...new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI, Math.PI, Math.PI * 0.5)).toArray(),
      ...new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI * 2, Math.PI * 2, Math.PI)).toArray(),
    ]
  );
  const clip = new THREE.AnimationClip('Kinetic Idle Loop', 6, [midRingTrack, coreTrack]);

  return { group: root, animations: [clip] };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

async function recoverEmbeddedTextures(gltf, root) {
  const uniqueMaterials = [];
  const seen = new Set();

  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((mat) => {
      if (mat && !seen.has(mat)) {
        seen.add(mat);
        uniqueMaterials.push(mat);
      }
    });
  });

  uniqueMaterials.forEach((mat) => {
    if (!mat.map && mat.emissiveMap) {
      mat.map = mat.emissiveMap;
      mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.emissiveMap = null;
      if (mat.emissive) mat.emissive.setHex(0x000000);
      mat.needsUpdate = true;
    }
  });

  const parser = gltf && gltf.parser;
  const json = parser && parser.json;
  if (!json || !Array.isArray(json.textures) || json.textures.length === 0) return;

  const missingMapMats = uniqueMaterials.filter((m) => !m.map);
  if (missingMapMats.length === 0) return;

  const diffuseCandidates = [];
  for (let texIdx = 0; texIdx < json.textures.length; texIdx++) {
    const texDef = json.textures[texIdx];
    const imgDef = json.images && texDef.source !== undefined ? json.images[texDef.source] : null;
    const rawName = (texDef.name || (imgDef && imgDef.name) || '').toLowerCase();

    if (/(normal|_n\b|_nrm|rough|metal|_m\b|_r\b|mask|_id\b|ramp|lightmap|ao\b)/i.test(rawName)) {
      continue;
    }
    try {
      const texture = await parser.getDependency('texture', texIdx);
      if (texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
        diffuseCandidates.push({ name: rawName, texture });
      }
    } catch {
      // Ignore unreadable entries
    }
  }

  if (diffuseCandidates.length === 0) return;

  missingMapMats.forEach((mat) => {
    const matName = (mat.name || '').toLowerCase();
    const tokens = matName.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !['mat', 'mi', 'material', 'inst'].includes(t));

    let matched = diffuseCandidates.find((c) => tokens.some((tok) => c.name.includes(tok)));
    if (!matched && diffuseCandidates.length === 1) {
      matched = diffuseCandidates[0];
    }

    if (matched) {
      mat.map = matched.texture;
      mat.color.setHex(0xffffff);
      mat.needsUpdate = true;
    }
  });
}

function detectAnimeShaderMasks(root) {
  let hasTexturedMask = false;

  root.traverse((child) => {
    if (hasTexturedMask || !child.isMesh || !child.geometry) return;
    const colorAttr = child.geometry.attributes.color;
    if (!colorAttr || colorAttr.count === 0) return;

    const mats = Array.isArray(child.material) ? child.material : [child.material];
    const hasDiffuseMap = mats.some((m) => m && m.map);

    if (hasDiffuseMap) {
      hasTexturedMask = true;
    }
  });

  return hasTexturedMask;
}

function normalizeAndInspectModel(rawScene) {
  rawScene.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(rawScene);
  const rawSize = new THREE.Vector3();
  const rawCenter = new THREE.Vector3();

  if (rawBox.isEmpty()) {
    rawSize.set(1, 1, 1);
    rawCenter.set(0, 0, 0);
  } else {
    rawBox.getSize(rawSize);
    rawBox.getCenter(rawCenter);
  }

  const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z) || 1;
  const targetSize = 2.4;
  const scaleFactor = targetSize / maxDim;

  const wrapper = new THREE.Group();
  rawScene.scale.multiplyScalar(scaleFactor);

  rawScene.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(rawScene);
  const scaledCenter = new THREE.Vector3();
  scaledBox.getCenter(scaledCenter);

  rawScene.position.x -= scaledCenter.x;
  rawScene.position.z -= scaledCenter.z;
  rawScene.position.y -= scaledBox.min.y;

  wrapper.add(rawScene);

  let meshCount = 0;
  let triangleCount = 0;
  let vertexCount = 0;
  const uniqueMaterials = new Set();

  wrapper.traverse((child) => {
    if (!child.name) {
      child.name = `Node_${child.id}`;
    }
    state.restPoses.set(child, {
      pos: child.position.clone(),
      quat: child.quaternion.clone(),
      scale: child.scale.clone(),
    });

    if (child.isMesh) {
      meshCount++;
      child.castShadow = true;
      child.receiveShadow = true;

      const geom = child.geometry;
      if (geom) {
        const posAttr = geom.attributes.position;
        if (posAttr) {
          vertexCount += posAttr.count;
        }
        if (geom.index) {
          triangleCount += Math.round(geom.index.count / 3);
        } else if (posAttr) {
          triangleCount += Math.round(posAttr.count / 3);
        }
      }

      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat, idx) => {
        if (mat) {
          if (!mat.name) {
            mat.name = `${child.name}_Mat${idx > 0 ? `_${idx}` : ''}`;
          }
          uniqueMaterials.add(mat);
          if (mat.userData.originalWireframe === undefined) {
            mat.userData.originalWireframe = Boolean(mat.wireframe);
          }
          if (mat.userData.originalVertexColors === undefined) {
            mat.userData.originalVertexColors = Boolean(mat.vertexColors);
          }
          if (mat.userData.originalColorHex === undefined && mat.color) {
            mat.userData.originalColorHex = mat.color.getHex();
          }
        }
      });
    }
  });

  wrapper.updateMatrixWorld(true);
  const normBox = new THREE.Box3().setFromObject(wrapper);
  const normSize = new THREE.Vector3();
  normBox.getSize(normSize);

  const materialsArray = Array.from(uniqueMaterials);
  const hasShaderMasks = detectAnimeShaderMasks(wrapper);
  const hasAnyTexture = materialsArray.some((m) => Boolean(m.map));

  return {
    wrapper,
    normalizedHeight: normSize.y || 1.5,
    hasShaderMasks,
    hasAnyTexture,
    materials: materialsArray,
    stats: {
      meshes: meshCount,
      materials: materialsArray.length,
      triangles: triangleCount,
      vertices: vertexCount,
      dimensions: `${rawSize.x.toFixed(2)} × ${rawSize.y.toFixed(2)} × ${rawSize.z.toFixed(2)}`,
    }
  };
}

function applyMaterialSettingsToModel(group) {
  if (!group) return;
  group.traverse((child) => {
    if (child.isMesh && child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        mat.wireframe = state.wireframe ? true : Boolean(mat.userData.originalWireframe);
        const targetVC = state.useVertexColors ? Boolean(mat.userData.originalVertexColors) : false;
        if (mat.vertexColors !== targetVC) {
          mat.vertexColors = targetVC;
          mat.needsUpdate = true;
        }
        if (mat.color && mat.userData.originalColorHex !== undefined) {
          if (!mat.map && !targetVC && mat.userData.originalColorHex === 0xffffff) {
            mat.color.setHex(0xd4d4d8);
          } else {
            mat.color.setHex(mat.userData.originalColorHex);
          }
        }
      });
    }
  });
}

function syncToolbarAndCheckboxes() {
  const wireCb = document.getElementById('wireframe-checkbox');
  const wireTab = document.getElementById('tab-wireframe-btn');
  if (wireCb) wireCb.checked = state.wireframe;
  if (wireTab) {
    wireTab.className = state.wireframe
      ? 'py-1.5 border-b-2 border-[var(--ui-accent)] font-medium text-[var(--ui-text)] transition'
      : 'py-1.5 border-b-2 border-transparent text-[var(--ui-accent)] hover:text-[var(--ui-accent-hover)] transition';
  }

  const vcCb = document.getElementById('vertex-colors-checkbox');
  const vcTab = document.getElementById('tab-vertex-colors-btn');
  if (vcCb) vcCb.checked = state.useVertexColors;
  if (vcTab) {
    vcTab.className = state.useVertexColors
      ? 'py-1.5 border-b-2 border-[var(--ui-accent)] font-medium text-[var(--ui-text)] transition'
      : 'py-1.5 border-b-2 border-transparent text-[var(--ui-accent)] hover:text-[var(--ui-accent-hover)] transition';
  }

  const rotCb = document.getElementById('auto-rotate-checkbox');
  const rotTab = document.getElementById('tab-autorotate-btn');
  if (rotCb) rotCb.checked = state.autoRotate;
  if (rotTab) {
    rotTab.className = state.autoRotate
      ? 'py-1.5 border-b-2 border-[var(--ui-accent)] font-medium text-[var(--ui-text)] transition'
      : 'py-1.5 border-b-2 border-transparent text-[var(--ui-accent)] hover:text-[var(--ui-accent-hover)] transition';
  }

  const gridCb = document.getElementById('grid-checkbox');
  const gridTab = document.getElementById('tab-grid-btn');
  if (gridCb) gridCb.checked = state.showGrid;
  if (gridTab) {
    gridTab.className = state.showGrid
      ? 'hidden sm:inline-block py-1.5 border-b-2 border-[var(--ui-accent)] font-medium text-[var(--ui-text)] transition'
      : 'hidden sm:inline-block py-1.5 border-b-2 border-transparent text-[var(--ui-accent)] hover:text-[var(--ui-accent-hover)] transition';
  }
}

function renderMaterialsList(model) {
  if (!materialsListEl || !model) return;
  const q = state.searchQuery.trim().toLowerCase();
  const allMats = model.materials || [];
  const mats = q ? allMats.filter((m) => (m.name || '').toLowerCase().includes(q)) : allMats;

  const texturedCount = allMats.filter((m) => Boolean(m.map)).length;
  if (textureStatusBadge) {
    textureStatusBadge.textContent = `${texturedCount}/${allMats.length} TEX`;
  }

  materialsListEl.innerHTML = '';
  if (mats.length === 0) {
    materialsListEl.innerHTML = `<div class="text-[11px] text-[var(--ui-muted)] py-1">No matching material slots.</div>`;
    return;
  }

  mats.forEach((mat) => {
    const hasMap = Boolean(mat.map);
    const swatchHex = mat.color ? `#${mat.color.getHexString()}` : '#d4d4d8';
    const row = document.createElement('button');
    row.type = 'button';
    row.title = 'Click to assign diffuse texture (.png / .jpg)';
    row.className = 'w-full flex items-center justify-between gap-2 rounded-[2px] border border-[var(--ui-divider)] bg-[var(--ui-subtle)] hover:bg-[var(--ui-hover)] hover:border-[var(--ui-border)] px-2 py-1 text-left transition';
    row.innerHTML = `
      <div class="flex items-center gap-2 min-w-0">
        <span class="h-3 w-3 shrink-0 rounded-[2px] border border-[var(--ui-border)]" style="background-color: ${swatchHex}"></span>
        <span class="truncate text-[11.5px] text-[var(--ui-text)]">${escapeHtml(mat.name || 'Material')}</span>
      </div>
      <span class="shrink-0 font-mono text-[10px] ${
        hasMap ? 'font-semibold text-[var(--ui-text)]' : 'text-[var(--ui-accent)] hover:underline'
      }">${hasMap ? 'MAPPED' : '+ TEX'}</span>
    `;

    row.addEventListener('click', () => {
      state.pendingTextureMaterial = mat;
      textureInput.click();
    });

    materialsListEl.appendChild(row);
  });
}

function applyImageFileToMaterial(file, targetMat, model) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    if (model && model.blobUrls) model.blobUrls.push(url);

    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (texture) => {
        texture.flipY = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;

        targetMat.map = texture;
        targetMat.userData.originalColorHex = 0xffffff;
        if (targetMat.color) targetMat.color.setHex(0xffffff);
        targetMat.needsUpdate = true;
        resolve(true);
      },
      undefined,
      () => resolve(false)
    );
  });
}

async function applyTextureFilesToActiveModel(imageFiles) {
  const model = state.models.find((m) => m.id === state.activeModelId);
  if (!model || !model.materials || model.materials.length === 0) return;

  let appliedCount = 0;

  for (const file of imageFiles) {
    const baseName = file.name.replace(/\.[^/.]+$/, '').toLowerCase();
    if (/(_n$|_nrm|normal|_m$|_r$|rough|metal|mask|_id$|ramp|ao$)/i.test(baseName) && imageFiles.length > 1) {
      continue;
    }

    const tokens = baseName
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !['tex', 'texture', 'diff', 'diffuse', 'albedo', 'basecolor', 'color', 'png', 'jpg'].includes(t));

    let matchedMats = model.materials.filter((mat) => {
      const mName = (mat.name || '').toLowerCase();
      return tokens.some((tok) => mName.includes(tok));
    });

    if (matchedMats.length === 0 && model.materials.length === 1) {
      matchedMats = [model.materials[0]];
    }

    for (const mat of matchedMats) {
      const ok = await applyImageFileToMaterial(file, mat, model);
      if (ok) appliedCount++;
    }
  }

  if (appliedCount > 0) {
    model.hasAnyTexture = true;
    if (detectAnimeShaderMasks(model.group)) {
      state.useVertexColors = false;
      syncToolbarAndCheckboxes();
    }
    applyMaterialSettingsToModel(model.group);
    renderMaterialsList(model);
    showToast(`Applied textures to ${appliedCount} material slot(s)`, 'success');
  } else {
    showToast('Click a Material Slot in the Appearance sidebar to assign this texture.', 'info');
  }
}

textureInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  const mat = state.pendingTextureMaterial;
  const model = state.models.find((m) => m.id === state.activeModelId);
  state.pendingTextureMaterial = null;
  textureInput.value = '';

  if (!file || !mat || !model) return;
  const ok = await applyImageFileToMaterial(file, mat, model);
  if (ok) {
    model.hasAnyTexture = true;
    applyMaterialSettingsToModel(model.group);
    renderMaterialsList(model);
    showToast(`Applied "${file.name}" to ${mat.name}`, 'success');
  }
});

function disposeObject(obj) {
  if (!obj) return;
  obj.traverse((child) => {
    if (child.isMesh) {
      if (child.geometry) child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        if (!mat) return;
        for (const key in mat) {
          const val = mat[key];
          if (val && typeof val === 'object' && val.isTexture) {
            val.dispose();
          }
        }
        mat.dispose();
      });
    }
  });
}

function activateModel(modelId) {
  const targetModel = state.models.find((m) => m.id === modelId);
  if (!targetModel) return;

  selectObjectForPosing(null, true);
  state.manualTracks.clear();
  state.manualClipIndex = -1;
  updateScrubberKeyframeMarkers();

  state.models.forEach((m) => {
    if (m.group.parent === scene) {
      scene.remove(m.group);
    }
  });

  if (state.mixer) {
    state.mixer.stopAllAction();
    state.mixer = null;
    state.activeAction = null;
  }

  state.activeModelId = targetModel.id;
  scene.add(targetModel.group);

  state.useVertexColors = !(targetModel.hasShaderMasks && targetModel.hasAnyTexture);
  syncToolbarAndCheckboxes();
  applyMaterialSettingsToModel(targetModel.group);
  renderMaterialsList(targetModel);

  document.getElementById('info-name').textContent = targetModel.name;
  document.getElementById('info-name').title = targetModel.name;
  document.getElementById('info-size').textContent = targetModel.sizeLabel;
  document.getElementById('info-meshes').textContent = targetModel.stats.meshes.toLocaleString();
  document.getElementById('info-materials').textContent = targetModel.stats.materials.toLocaleString();
  document.getElementById('info-triangles').textContent = targetModel.stats.triangles.toLocaleString();
  document.getElementById('info-vertices').textContent = targetModel.stats.vertices.toLocaleString();
  document.getElementById('info-dimensions').textContent = targetModel.stats.dimensions;

  const headerNameEl = document.getElementById('header-active-name');
  const headerTrisEl = document.getElementById('header-tris-badge');
  if (headerNameEl) headerNameEl.textContent = targetModel.name;
  if (headerTrisEl) {
    const tris = targetModel.stats.triangles;
    headerTrisEl.textContent = tris >= 1000 ? `${(tris / 1000).toFixed(1)}k triangles` : `${tris} triangles`;
  }

  setupAnimationsForModel(targetModel);

  setCameraPreset('fit', true);
  renderModelsList();
}

function removeModel(modelId) {
  const idx = state.models.findIndex((m) => m.id === modelId);
  if (idx === -1) return;
  const model = state.models[idx];
  if (model.isDefault) return;

  if (model.group.parent === scene) {
    scene.remove(model.group);
  }
  disposeObject(model.group);
  if (model.blobUrls) {
    model.blobUrls.forEach((u) => URL.revokeObjectURL(u));
  }

  state.models.splice(idx, 1);
  showToast(`Removed "${model.name}"`, 'info');

  if (state.activeModelId === modelId) {
    const fallback = state.models[state.models.length - 1];
    if (fallback) activateModel(fallback.id);
  } else {
    renderModelsList();
  }
}

function renderModelsList() {
  modelCountBadge.textContent = state.models.length;
  modelsListEl.innerHTML = '';

  const q = state.searchQuery.trim().toLowerCase();
  const visibleModels = q
    ? state.models.filter((m) => m.name.toLowerCase().includes(q))
    : state.models;

  if (visibleModels.length === 0) {
    modelsListEl.innerHTML = `<div class="py-1 text-xs text-[var(--ui-muted)]">No matching models.</div>`;
    return;
  }

  visibleModels.forEach((model) => {
    const isActive = model.id === state.activeModelId;
    const item = document.createElement('div');
    item.className = `group flex items-center justify-between gap-1.5 rounded-[2px] px-2 py-1 cursor-pointer transition ${
      isActive ? 'bg-[var(--ui-subtle)]' : 'hover:bg-[var(--ui-subtle)]'
    }`;

    item.innerHTML = `
      <div class="min-w-0 flex-1">
        <div class="truncate text-[12.5px] ${
          isActive ? 'font-bold text-[var(--ui-text)]' : 'text-[var(--ui-accent)] group-hover:text-[var(--ui-accent-hover)] group-hover:underline'
        }">${escapeHtml(model.name)}</div>
        <div class="text-[10.5px] text-[var(--ui-muted)] font-mono">
          ${escapeHtml(model.sizeLabel)}${model.animations.length > 0 ? ` · ${model.animations.length} anim` : ''}
        </div>
      </div>
      ${
        !model.isDefault
          ? `<button type="button" data-delete-id="${model.id}" title="Remove Model"
              class="delete-model-btn rounded-[2px] px-1.5 py-0.5 text-xs text-[var(--ui-muted)] hover:bg-[var(--ui-hover)] hover:text-[var(--ui-text)] transition">
              ×
            </button>`
          : `<span class="text-[10px] text-[var(--ui-muted)]">demo</span>`
      }
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.delete-model-btn')) return;
      activateModel(model.id);
      if (window.innerWidth < 768) {
        setModelsPanelOpen(false);
      }
    });

    const delBtn = item.querySelector('.delete-model-btn');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeModel(model.id);
      });
    }

    modelsListEl.appendChild(item);
  });
}

function setupAnimationsForModel(model) {
  const clips = model.animations || [];
  if (clips.length === 0) {
    setAnimationBarVisible(false);
    return;
  }

  setAnimationBarVisible(true);
  if (!state.mixer) {
    state.mixer = new THREE.AnimationMixer(model.group);
  }
  state.mixer.timeScale = state.playbackSpeed;

  animClipSelect.innerHTML = '';
  clips.forEach((clip, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = clip.name || `Animation ${idx + 1}`;
    animClipSelect.appendChild(opt);
  });

  playClipAtIndex(0);
}

function playClipAtIndex(index) {
  const model = state.models.find((m) => m.id === state.activeModelId);
  if (!model || !state.mixer || !model.animations[index]) return;

  state.mixer.stopAllAction();
  const clip = model.animations[index];
  const action = state.mixer.clipAction(clip);
  action.reset();
  action.play();
  action.paused = !state.isPlaying;

  state.activeAction = action;
  animScrubber.value = 0;
  updatePlayPauseUI();
  updateScrubberKeyframeMarkers();
}

function updatePlayPauseUI() {
  if (state.isPlaying) {
    iconPause.classList.remove('hidden');
    iconPlay.classList.add('hidden');
  } else {
    iconPause.classList.add('hidden');
    iconPlay.classList.remove('hidden');
  }
}

function resolveNearestBone(skinnedMesh, hitPointWorld) {
  const skeleton = skinnedMesh.skeleton;
  if (!skeleton || !skeleton.bones || skeleton.bones.length === 0) return skinnedMesh;

  let closestBone = skeleton.bones[0];
  let minDistSq = Infinity;
  const boneWorldPos = new THREE.Vector3();

  for (const bone of skeleton.bones) {
    bone.getWorldPosition(boneWorldPos);
    const distSq = boneWorldPos.distanceToSquared(hitPointWorld);
    if (distSq < minDistSq) {
      minDistSq = distSq;
      closestBone = bone;
    }
  }
  return closestBone;
}

function selectObjectForPosing(obj, silent = false) {
  if (skeletonHelper) {
    scene.remove(skeletonHelper);
    skeletonHelper.dispose();
    skeletonHelper = null;
  }

  state.selectedTarget = obj;

  if (!obj) {
    transformControls.detach();
    animationBar.classList.remove('posing-active');
    inspectorBadge.classList.remove('posing-badge');
    inspectorBadge.textContent = 'READY';
    controls.autoRotate = state.autoRotate;
    const activeModel = state.models.find((m) => m.id === state.activeModelId);
    if (activeModel && (!activeModel.animations || activeModel.animations.length === 0)) {
      setAnimationBarVisible(false);
    }
    return;
  }

  controls.autoRotate = false;
  transformControls.attach(obj);
  animationBar.classList.add('posing-active');
  inspectorBadge.classList.add('posing-badge');
  inspectorBadge.textContent = obj.isBone ? `BONE: ${obj.name}` : `PART: ${obj.name}`;

  const activeModel = state.models.find((m) => m.id === state.activeModelId);
  if (obj.isBone && activeModel) {
    skeletonHelper = new THREE.SkeletonHelper(activeModel.group);
    scene.add(skeletonHelper);
  }

  setAnimationBarVisible(true);
  if (!state.activeAction) {
    const curTime = parseFloat(animScrubber.value || '0') * state.manualDuration;
    updateTimecodeUI(curTime, state.manualDuration);
  }

  if (!silent) {
    showToast(
      `Selected "${obj.name}" — [W] Move, [E] Rotate, [S] Scale, [K] Keyframe, [Esc] Done`,
      'info'
    );
  }
}

function getCurrentTimelineSeconds() {
  if (state.activeAction) {
    const clip = state.activeAction.getClip();
    if (clip && clip.duration > 0) {
      return Number((state.activeAction.time % clip.duration).toFixed(2));
    }
  }
  return Number((parseFloat(animScrubber.value || '0') * state.manualDuration).toFixed(2));
}

function recordManualKeyframe() {
  const obj = state.selectedTarget;
  const model = state.models.find((m) => m.id === state.activeModelId);
  if (!obj || !model) {
    showToast('Click any mesh or bone on the 3D model first to pose and keyframe.', 'info');
    return;
  }

  const time = getCurrentTimelineSeconds();
  if (time > state.manualDuration) {
    state.manualDuration = Math.ceil(time);
  }

  let entry = state.manualTracks.get(obj.uuid);
  if (!entry) {
    entry = { object: obj, keyframes: [] };
    state.manualTracks.set(obj.uuid, entry);
  }

  const snapshot = {
    time,
    pos: obj.position.toArray(),
    quat: obj.quaternion.toArray(),
    scale: obj.scale.toArray(),
  };

  const existingIdx = entry.keyframes.findIndex((kf) => Math.abs(kf.time - time) < 0.04);
  if (existingIdx !== -1) {
    entry.keyframes[existingIdx] = snapshot;
  } else {
    entry.keyframes.push(snapshot);
    entry.keyframes.sort((a, b) => a.time - b.time);
  }

  rebuildManualAnimationClip(model, time);
  showToast(`Keyframe saved for "${obj.name}" at ${time.toFixed(2)}s (Ctrl+E to export GLB)`, 'success');
}

function deleteManualKeyframe() {
  const obj = state.selectedTarget;
  const model = state.models.find((m) => m.id === state.activeModelId);
  if (!obj || !model) return;

  const entry = state.manualTracks.get(obj.uuid);
  if (!entry || entry.keyframes.length === 0) return;

  const time = getCurrentTimelineSeconds();
  const before = entry.keyframes.length;
  entry.keyframes = entry.keyframes.filter((kf) => Math.abs(kf.time - time) >= 0.08);

  if (entry.keyframes.length !== before) {
    if (entry.keyframes.length === 0) {
      state.manualTracks.delete(obj.uuid);
    }
    rebuildManualAnimationClip(model, time);
    showToast(`Deleted keyframe on "${obj.name}" at ${time.toFixed(2)}s`, 'info');
  }
}

function rebuildManualAnimationClip(model, seekTime = 0) {
  const tracks = [];
  let maxTime = state.manualDuration;

  state.manualTracks.forEach(({ object, keyframes }) => {
    if (keyframes.length === 0) return;
    const times = [];
    const positions = [];
    const quaternions = [];
    const scales = [];

    keyframes.forEach((kf) => {
      times.push(kf.time);
      positions.push(...kf.pos);
      quaternions.push(...kf.quat);
      scales.push(...kf.scale);
      if (kf.time > maxTime) maxTime = kf.time;
    });

    if (times.length === 1) {
      const endT = Math.max(maxTime, times[0] + 0.5);
      times.push(endT);
      positions.push(...keyframes[0].pos);
      quaternions.push(...keyframes[0].quat);
      scales.push(...keyframes[0].scale);
    }

    const nodeName = object.name;
    tracks.push(new THREE.VectorKeyframeTrack(`${nodeName}.position`, times, positions));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${nodeName}.quaternion`, times, quaternions));
    tracks.push(new THREE.VectorKeyframeTrack(`${nodeName}.scale`, times, scales));
  });

  if (!state.mixer) {
    state.mixer = new THREE.AnimationMixer(model.group);
    state.mixer.timeScale = state.playbackSpeed;
  }

  if (tracks.length === 0) {
    if (state.manualClipIndex !== -1) {
      model.animations.splice(state.manualClipIndex, 1);
      state.manualClipIndex = -1;
      setupAnimationsForModel(model);
      renderModelsList();
    }
    updateScrubberKeyframeMarkers();
    return;
  }

  const manualClip = new THREE.AnimationClip('Manual Animation', maxTime, tracks);
  if (state.manualClipIndex === -1) {
    model.animations.push(manualClip);
    state.manualClipIndex = model.animations.length - 1;
  } else {
    model.animations[state.manualClipIndex] = manualClip;
  }

  animClipSelect.innerHTML = '';
  model.animations.forEach((clip, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = clip.name || `Animation ${idx + 1}`;
    animClipSelect.appendChild(opt);
  });
  animClipSelect.value = String(state.manualClipIndex);

  state.isPlaying = false;
  playClipAtIndex(state.manualClipIndex);
  if (state.activeAction) {
    state.activeAction.time = Math.min(seekTime, maxTime);
    state.mixer.update(0);
    animScrubber.value = (state.activeAction.time / maxTime).toFixed(4);
    updateTimecodeUI(state.activeAction.time, maxTime);
  }

  updateScrubberKeyframeMarkers();
  renderModelsList();
}

function updateScrubberKeyframeMarkers() {
  const allTimes = new Set();
  state.manualTracks.forEach(({ keyframes }) => {
    keyframes.forEach((kf) => allTimes.add(kf.time));
  });

  if (allTimes.size === 0) {
    animScrubber.classList.remove('has-manual-keys');
    animScrubber.style.removeProperty('--kf-track');
    return;
  }

  const duration = state.activeAction ? state.activeAction.getClip().duration : state.manualDuration;
  const stops = ['var(--ui-track) 0%'];
  const sorted = Array.from(allTimes).sort((a, b) => a - b);

  sorted.forEach((t) => {
    const pct = Math.max(0, Math.min(100, (t / (duration || 1)) * 100));
    const start = Math.max(0, pct - 0.8).toFixed(2);
    const end = Math.min(100, pct + 0.8).toFixed(2);
    stops.push(`var(--ui-track) ${start}%`);
    stops.push(`var(--ui-accent) ${start}%`);
    stops.push(`var(--ui-accent) ${end}%`);
    stops.push(`var(--ui-track) ${end}%`);
  });
  stops.push('var(--ui-track) 100%');

  animScrubber.classList.add('has-manual-keys');
  animScrubber.style.setProperty('--kf-track', `linear-gradient(90deg, ${stops.join(', ')})`);
}

function resetSelectedPose() {
  const obj = state.selectedTarget;
  if (!obj) return;
  const rest = state.restPoses.get(obj);
  if (rest) {
    obj.position.copy(rest.pos);
    obj.quaternion.copy(rest.quat);
    obj.scale.copy(rest.scale);
    showToast(`Reset pose for "${obj.name}"`, 'info');
  }
}

function exportAnimatedGLB() {
  const model = state.models.find((m) => m.id === state.activeModelId);
  if (!model) return;

  const prevSelected = state.selectedTarget;
  if (prevSelected) transformControls.detach();

  setLoading(true, 'Exporting animated .GLB...');
  const exporter = new GLTFExporter();
  exporter.parse(
    model.group,
    (result) => {
      setLoading(false);
      if (prevSelected) transformControls.attach(prevSelected);

      const blob = new Blob([result], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const baseName = model.name.replace(/\.(glb|gltf)$/i, '');
      link.href = url;
      link.download = `${baseName}_animated.glb`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast(`Exported "${baseName}_animated.glb"`, 'success');
    },
    (error) => {
      console.error('GLB Export Error:', error);
      setLoading(false);
      if (prevSelected) transformControls.attach(prevSelected);
      showToast('Failed to export GLB file.', 'error');
    },
    { binary: true, animations: model.animations }
  );
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || state.isDraggingGizmo) return;
  pointerDownPos.set(e.clientX, e.clientY);
  pointerDownTime = performance.now();
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' || state.isDraggingGizmo || state.isOrbiting) return;
  const activeModel = state.models.find((m) => m.id === state.activeModelId);
  if (!activeModel) return;

  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObject(activeModel.group, true);
  canvas.classList.toggle('can-select', hits.length > 0);
});

canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || state.isDraggingGizmo) return;
  const moveDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
  const elapsed = performance.now() - pointerDownTime;
  const maxTapDist = e.pointerType === 'touch' ? 12 : 5;
  if (moveDist > maxTapDist || elapsed > 380) return;

  const activeModel = state.models.find((m) => m.id === state.activeModelId);
  if (!activeModel) return;

  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObject(activeModel.group, true);

  if (hits.length > 0) {
    const hit = hits[0];
    const targetObj = hit.object.isSkinnedMesh
      ? resolveNearestBone(hit.object, hit.point)
      : hit.object;
    selectObjectForPosing(targetObj);
  } else if (state.selectedTarget) {
    selectObjectForPosing(null);
  }
});

animPlayBtn.addEventListener('click', () => {
  if (!state.activeAction) return;
  state.isPlaying = !state.isPlaying;
  state.activeAction.paused = !state.isPlaying;
  updatePlayPauseUI();
});

animClipSelect.addEventListener('change', (e) => {
  playClipAtIndex(Number(e.target.value));
});

animScrubber.addEventListener('input', (e) => {
  state.isScrubbing = true;
  const ratio = parseFloat(e.target.value);
  if (state.activeAction && state.mixer) {
    const clip = state.activeAction.getClip();
    state.activeAction.time = ratio * clip.duration;
    state.mixer.update(0);
    updateTimecodeUI(state.activeAction.time, clip.duration);
  } else {
    updateTimecodeUI(ratio * state.manualDuration, state.manualDuration);
  }
});

animScrubber.addEventListener('change', () => {
  state.isScrubbing = false;
});

document.querySelectorAll('.anim-speed-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const speed = parseFloat(btn.dataset.speed);
    state.playbackSpeed = speed;
    if (state.mixer) {
      state.mixer.timeScale = speed;
    }
    document.querySelectorAll('.anim-speed-btn').forEach((b) => {
      const active = parseFloat(b.dataset.speed) === speed;
      b.className = active
        ? 'anim-speed-btn rounded-[2px] bg-[var(--ui-accent)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--ui-btn-text)] transition'
        : 'anim-speed-btn rounded-[2px] px-2 py-0.5 font-mono text-[11px] text-[var(--ui-muted)] hover:text-[var(--ui-text)] transition';
    });
  });
});

function updateTimecodeUI(current, total) {
  animTimecode.textContent = `${current.toFixed(1)}s / ${total.toFixed(1)}s`;
}

async function handleUploadedFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  const modelFiles = files.filter((f) => /\.(glb|gltf)$/i.test(f.name));
  const imageFiles = files.filter((f) => /^image\//i.test(f.type) || /\.(png|jpe?g|webp|tga)$/i.test(f.name));

  if (modelFiles.length === 0) {
    if (imageFiles.length > 0) {
      await applyTextureFilesToActiveModel(imageFiles);
      return;
    }
    showToast('Unsupported file format. Upload .glb, .gltf, or .png/.jpg textures.', 'error');
    return;
  }

  const resourceMap = new Map();
  const blobUrls = [];
  files.forEach((f) => {
    const url = URL.createObjectURL(f);
    blobUrls.push(url);
    resourceMap.set(f.name, url);
  });

  for (const file of modelFiles) {
    await loadSingleModelFile(file, resourceMap, blobUrls);
  }
}

function loadSingleModelFile(file, resourceMap, sharedBlobUrls) {
  return new Promise((resolve) => {
    setLoading(true, `Loading ${file.name}...`);

    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      const cleanName = decodeURIComponent(url.split('/').pop().split('?')[0]);
      if (resourceMap.has(cleanName)) {
        return resourceMap.get(cleanName);
      }
      return url;
    });

    const loader = new GLTFLoader(manager);
    loader.setDRACOLoader(dracoLoader);

    const mainUrl = resourceMap.get(file.name) || URL.createObjectURL(file);

    loader.load(
      mainUrl,
      async (gltf) => {
        try {
          await recoverEmbeddedTextures(gltf, gltf.scene);
          const { wrapper, normalizedHeight, hasShaderMasks, hasAnyTexture, materials, stats } = normalizeAndInspectModel(gltf.scene);
          const newModel = {
            id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name,
            sizeLabel: formatBytes(file.size),
            group: wrapper,
            normalizedHeight,
            hasShaderMasks,
            hasAnyTexture,
            materials,
            animations: gltf.animations || [],
            stats,
            isDefault: false,
            blobUrls: sharedBlobUrls,
          };

          state.models.push(newModel);
          activateModel(newModel.id);
          setLoading(false);

          if (!hasAnyTexture) {
            showToast(
              `Loaded "${file.name}" (no embedded textures — drop .PNG textures onto viewport to apply)`,
              'info'
            );
          } else {
            showToast(`Loaded "${file.name}"`, 'success');
          }
        } catch (err) {
          console.error(err);
          setLoading(false);
          showToast(`Failed to process "${file.name}".`, 'error');
        }
        resolve();
      },
      undefined,
      (error) => {
        console.error('GLTF Load Error:', error);
        setLoading(false);
        const isGltf = /\.gltf$/i.test(file.name);
        showToast(
          isGltf
            ? `Could not load "${file.name}". If it references external .bin/textures, drop all files together or use a self-contained .glb.`
            : `Failed to parse "${file.name}". Ensure it is a valid GLB file.`,
          'error'
        );
        resolve();
      }
    );
  });
}

document.getElementById('upload-btn').addEventListener('click', () => fileInput.click());
document.getElementById('panel-upload-btn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  handleUploadedFiles(e.target.files);
  fileInput.value = '';
});

document.getElementById('header-export-btn').addEventListener('click', exportAnimatedGLB);
document.getElementById('sidebar-export-btn').addEventListener('click', exportAnimatedGLB);
document.getElementById('header-fit-btn').addEventListener('click', () => setCameraPreset('fit', true));
document.getElementById('sidebar-keyframe-btn').addEventListener('click', recordManualKeyframe);
document.getElementById('sidebar-reset-pose-btn').addEventListener('click', resetSelectedPose);

const searchForm = document.getElementById('header-search-form');
const searchInput = document.getElementById('header-search-input');

searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  renderModelsList();
  const activeModel = state.models.find((m) => m.id === state.activeModelId);
  if (activeModel) renderMaterialsList(activeModel);
});

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = state.searchQuery.trim().toLowerCase();
  if (!q) return;

  if (['fit', 'front', 'right', 'top', 'iso'].includes(q)) {
    setCameraPreset(q, true);
    showToast(`Camera switched to ${q} view`, 'info');
    return;
  }

  const matchedModel = state.models.find((m) => m.name.toLowerCase().includes(q));
  if (matchedModel && matchedModel.id !== state.activeModelId) {
    activateModel(matchedModel.id);
    showToast(`Switched to "${matchedModel.name}"`, 'info');
  } else {
    setModelsPanelOpen(true);
    setStudioPanelOpen(true);
  }
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
    dropOverlay.classList.remove('hidden');
    dropOverlay.classList.add('flex');
  }
});

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy';
  }
});

window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    dropOverlay.classList.add('hidden');
    dropOverlay.classList.remove('flex');
  }
});

window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.add('hidden');
  dropOverlay.classList.remove('flex');

  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleUploadedFiles(e.dataTransfer.files);
  }
});

function setCameraPreset(preset, smooth = true) {
  const activeModel = state.models.find((m) => m.id === state.activeModelId);
  const centerY = activeModel ? (activeModel.normalizedHeight * 0.48) : 1.0;
  const target = new THREE.Vector3(0, centerY, 0);
  const dist = 3.9;

  let endPos = new THREE.Vector3();
  switch (preset) {
    case 'front':
      endPos.set(0, centerY, dist);
      break;
    case 'right':
      endPos.set(dist, centerY, 0);
      break;
    case 'top':
      endPos.set(0, centerY + dist * 1.15, 0.001);
      break;
    case 'iso':
    case 'fit':
    default:
      endPos.set(dist * 0.72, centerY + dist * 0.52, dist * 0.78);
      break;
  }

  if (!smooth) {
    camera.position.copy(endPos);
    controls.target.copy(target);
    controls.update();
    return;
  }

  state.cameraTransition = {
    startPos: camera.position.clone(),
    endPos,
    startTarget: controls.target.clone(),
    endTarget: target,
    progress: 0,
    duration: 0.45,
  };
}

document.querySelectorAll('.camera-preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    setCameraPreset(btn.dataset.view, true);
  });
});

function toggleAutoRotate() {
  state.autoRotate = !state.autoRotate;
  controls.autoRotate = state.autoRotate;
  syncToolbarAndCheckboxes();
}

function toggleWireframe() {
  state.wireframe = !state.wireframe;
  syncToolbarAndCheckboxes();
  const activeModel = state.models.find((m) => m.id === state.activeModelId);
  if (activeModel) applyMaterialSettingsToModel(activeModel.group);
}

function toggleVertexColors() {
  state.useVertexColors = !state.useVertexColors;
  syncToolbarAndCheckboxes();
  const activeModel = state.models.find((m) => m.id === state.activeModelId);
  if (activeModel) {
    applyMaterialSettingsToModel(activeModel.group);
    renderMaterialsList(activeModel);
  }
}

function toggleGrid() {
  state.showGrid = !state.showGrid;
  syncToolbarAndCheckboxes();
  gridHelper.visible = state.showGrid;
  shadowPlane.visible = state.showGrid;
}

document.getElementById('auto-rotate-checkbox').addEventListener('change', toggleAutoRotate);
document.getElementById('tab-autorotate-btn').addEventListener('click', toggleAutoRotate);

document.getElementById('wireframe-checkbox').addEventListener('change', toggleWireframe);
document.getElementById('tab-wireframe-btn').addEventListener('click', toggleWireframe);

document.getElementById('vertex-colors-checkbox').addEventListener('change', toggleVertexColors);
document.getElementById('tab-vertex-colors-btn').addEventListener('click', toggleVertexColors);

document.getElementById('grid-checkbox').addEventListener('change', toggleGrid);
document.getElementById('tab-grid-btn').addEventListener('click', toggleGrid);

const rotateSpeedSlider = document.getElementById('rotate-speed-slider');
const rotateSpeedVal = document.getElementById('rotate-speed-val');
rotateSpeedSlider.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  state.autoRotateSpeed = val;
  controls.autoRotateSpeed = val;
  rotateSpeedVal.textContent = `${val.toFixed(1)}x`;
});

function applyStudioTheme(key) {
  const preset = BG_PRESETS[key];
  if (!preset) return;

  state.bgPreset = key;
  document.documentElement.dataset.theme = key;
  scene.background = new THREE.Color(preset.color);
  document.getElementById('bg-label').textContent = preset.label;

  scene.remove(gridHelper);
  gridHelper.geometry.dispose();
  gridHelper.material.dispose();
  gridHelper = new THREE.GridHelper(10, 20, preset.gridCenter, preset.gridLine);
  gridHelper.material.opacity = key === 'light-gray' ? 0.85 : 0.65;
  gridHelper.material.transparent = true;
  gridHelper.visible = state.showGrid;
  scene.add(gridHelper);

  shadowPlane.material.opacity = key === 'light-gray' ? 0.18 : 0.35;

  document.querySelectorAll('.bg-preset-btn').forEach((b) => {
    const active = b.dataset.bg === key;
    const radio = b.querySelector('.wiki-radio');
    if (radio) {
      radio.classList.toggle('is-checked', active);
    }
  });
}

document.querySelectorAll('.bg-preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => applyStudioTheme(btn.dataset.bg));
});

const exposureSlider = document.getElementById('exposure-slider');
const exposureVal = document.getElementById('exposure-val');
exposureSlider.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  state.exposure = val;
  renderer.toneMappingExposure = val;
  exposureVal.textContent = `${val.toFixed(2)} EV`;
});

function setModelsPanelOpen(open) {
  modelsPanel.classList.toggle('hidden', !open);
  if (restoreModelsBtn) {
    restoreModelsBtn.classList.toggle('hidden', open);
  }
  requestAnimationFrame(handleResize);
}

function setStudioPanelOpen(open) {
  studioPanel.classList.toggle('hidden', !open);
  requestAnimationFrame(handleResize);
}

document.getElementById('toggle-models-btn').addEventListener('click', () => {
  const willOpen = modelsPanel.classList.contains('hidden');
  if (willOpen && window.innerWidth < 768) setStudioPanelOpen(false);
  setModelsPanelOpen(willOpen);
});
document.getElementById('close-models-btn').addEventListener('click', () => setModelsPanelOpen(false));
restoreModelsBtn.addEventListener('click', () => setModelsPanelOpen(true));

document.getElementById('toggle-studio-btn').addEventListener('click', () => {
  const willOpen = studioPanel.classList.contains('hidden');
  if (willOpen && window.innerWidth < 768) setModelsPanelOpen(false);
  setStudioPanelOpen(willOpen);
});
document.getElementById('header-stats-pill').addEventListener('click', () => {
  setStudioPanelOpen(studioPanel.classList.contains('hidden'));
});
document.getElementById('close-studio-btn').addEventListener('click', () => setStudioPanelOpen(false));

if (window.innerWidth < 768) {
  setModelsPanelOpen(false);
  setStudioPanelOpen(false);
}

window.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    exportAnimatedGLB();
    return;
  }

  if (e.altKey && e.key.toLowerCase() === 'r' && state.selectedTarget) {
    e.preventDefault();
    resetSelectedPose();
    return;
  }

  if (e.key === 'Escape' && state.selectedTarget) {
    selectObjectForPosing(null);
  } else if ((e.key === 'w' || e.key === 'W') && state.selectedTarget) {
    state.gizmoMode = 'translate';
    transformControls.setMode('translate');
    showToast('Gizmo Mode: Move (Translate)', 'info');
  } else if ((e.key === 'e' || e.key === 'E') && state.selectedTarget) {
    state.gizmoMode = 'rotate';
    transformControls.setMode('rotate');
    showToast('Gizmo Mode: Rotate', 'info');
  } else if ((e.key === 's' || e.key === 'S') && state.selectedTarget) {
    state.gizmoMode = 'scale';
    transformControls.setMode('scale');
    showToast('Gizmo Mode: Scale', 'info');
  } else if ((e.key === 'x' || e.key === 'X') && state.selectedTarget) {
    state.gizmoSpace = state.gizmoSpace === 'local' ? 'world' : 'local';
    transformControls.setSpace(state.gizmoSpace);
    showToast(`Gizmo Space: ${state.gizmoSpace.toUpperCase()}`, 'info');
  } else if (e.key === 'k' || e.key === 'K') {
    recordManualKeyframe();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedTarget) {
    e.preventDefault();
    deleteManualKeyframe();
  } else if (e.key === 'r' || e.key === 'R') {
    setCameraPreset('fit', true);
  } else if (e.key === '1') {
    setCameraPreset('front', true);
  } else if (e.key === '2') {
    setCameraPreset('right', true);
  } else if (e.key === '3') {
    setCameraPreset('top', true);
  } else if (e.key === '4') {
    setCameraPreset('iso', true);
  } else if (e.code === 'Space' && state.activeAction) {
    e.preventDefault();
    animPlayBtn.click();
  }
});

function setLoading(isLoading, message = 'Loading...') {
  if (isLoading) {
    loadingText.textContent = message;
    loadingPill.classList.remove('hidden');
    loadingPill.classList.add('flex');
  } else {
    loadingPill.classList.add('hidden');
    loadingPill.classList.remove('flex');
  }
}

function showToast(message, type = 'info') {
  const styles = {
    success: 'border-[var(--ui-accent)] bg-[var(--ui-bg)] text-[var(--ui-text)]',
    error:   'border-[#d33] bg-[var(--ui-bg)] text-[var(--ui-text)]',
    info:    'border-[var(--ui-border)] bg-[var(--ui-bg)] text-[var(--ui-text)]',
  };
  const dotColors = {
    success: 'bg-[var(--ui-accent)]',
    error:   'bg-[#d33]',
    info:    'bg-[var(--ui-muted)]',
  };

  const toast = document.createElement('div');
  toast.className = `pointer-events-auto flex items-start gap-2.5 rounded-[2px] border px-3.5 py-2.5 text-xs font-medium shadow-lg transition-all duration-300 translate-y-2 opacity-0 ${styles[type] || styles.info}`;
  toast.innerHTML = `
    <span class="mt-1 h-2 w-2 shrink-0 rounded-full ${dotColors[type] || dotColors.info}"></span>
    <span class="leading-relaxed">${escapeHtml(message)}</span>
  `;

  toastContainer.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 4200);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function handleResize() {
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width === 0 || height === 0) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  transformControls.setSize(width < 768 ? 1.05 : 0.8);
}

const resizeObserver = new ResizeObserver(handleResize);
resizeObserver.observe(container);
window.addEventListener('resize', handleResize);

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (state.mixer && state.activeAction) {
    if (!state.isScrubbing && state.isPlaying && !state.isDraggingGizmo) {
      state.mixer.update(delta);
    }
    const clip = state.activeAction.getClip();
    if (clip && clip.duration > 0) {
      const wrappedTime = state.activeAction.time % clip.duration;
      if (!state.isScrubbing) {
        animScrubber.value = (wrappedTime / clip.duration).toFixed(4);
      }
      updateTimecodeUI(wrappedTime, clip.duration);
    }
  }

  if (state.cameraTransition) {
    const t = state.cameraTransition;
    t.progress = Math.min(1, t.progress + delta / t.duration);
    const ease = 1 - Math.pow(1 - t.progress, 3);

    camera.position.lerpVectors(t.startPos, t.endPos, ease);
    controls.target.lerpVectors(t.startTarget, t.endTarget, ease);

    if (t.progress >= 1) {
      state.cameraTransition = null;
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener('load', () => {
  applyStudioTheme(state.bgPreset);

  const showcase = createShowcaseModel();
  const { wrapper, normalizedHeight, hasShaderMasks, hasAnyTexture, materials, stats } = normalizeAndInspectModel(showcase.group);

  const defaultModel = {
    id: 'default-showcase',
    name: 'Studio Showcase Core',
    sizeLabel: 'Procedural',
    group: wrapper,
    normalizedHeight,
    hasShaderMasks,
    hasAnyTexture,
    materials,
    animations: showcase.animations,
    stats,
    isDefault: true,
    blobUrls: [],
  };

  state.models.push(defaultModel);
  activateModel(defaultModel.id);
  setCameraPreset('fit', false);
  animate();
});
