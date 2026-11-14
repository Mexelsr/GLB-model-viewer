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
  showGrid: true,
  bgPreset: 'dark-studio',
  exposure: 1.1,
  mixer: null,
  activeAction: null,
  isPlaying: true,
  isLooping: true,
  playbackSpeed: 1.0,
  isScrubbing: false,
  currentTime: 0,
  cameraTransition: null,
  selectedTarget: null,
  gizmoMode: 'rotate',
  gizmoSpace: 'local',
  isDraggingGizmo: false,
  isOrbiting: false,
  autoKey: false,
  timelineCollapsed: false,
  restPoses: new WeakMap(),
};

const BG_PRESETS = {
  'dark-studio': { color: 0x0f1218, label: 'Dark Studio', gridCenter: 0x3b4254, gridLine: 0x1e2330 },
  'charcoal':    { color: 0x232730, label: 'Charcoal',    gridCenter: 0x525b70, gridLine: 0x323846 },
  'light-gray':  { color: 0xdfe4ec, label: 'Light Gray',  gridCenter: 0x94a3b8, gridLine: 0xcbd5e1 },
  'deep-navy':   { color: 0x0a1428, label: 'Deep Navy',   gridCenter: 0x2b4570, gridLine: 0x152544 },
};

const container = document.getElementById('viewport-container');
const canvas = document.getElementById('three-canvas');
const dropOverlay = document.getElementById('drop-overlay');
const fileInput = document.getElementById('file-input');
const modelsPanel = document.getElementById('models-panel');
const studioPanel = document.getElementById('studio-panel');
const modelsListEl = document.getElementById('models-list');
const modelCountBadge = document.getElementById('model-count-badge');
const loadingPill = document.getElementById('loading-pill');
const loadingText = document.getElementById('loading-text');
const toastContainer = document.getElementById('toast-container');

const animationBar = document.getElementById('animation-bar');
const animPlayBtn = document.getElementById('anim-play-btn');
const animRestartBtn = document.getElementById('anim-restart-btn');
const animLoopBtn = document.getElementById('anim-loop-btn');
const iconPause = document.getElementById('icon-pause');
const iconPlay = document.getElementById('icon-play');
const animClipSelect = document.getElementById('anim-clip-select');
const newClipBtn = document.getElementById('new-clip-btn');
const animCurrentTimeEl = document.getElementById('anim-current-time');
const animDurationInput = document.getElementById('anim-duration-input');
const addKeyframeBtn = document.getElementById('add-keyframe-btn');
const deleteKeyframeBtn = document.getElementById('delete-keyframe-btn');
const clearTrackBtn = document.getElementById('clear-track-btn');
const autoKeyBtn = document.getElementById('auto-key-btn');
const autoKeyDot = document.getElementById('auto-key-dot');
const toggleTimelineCollapseBtn = document.getElementById('toggle-timeline-collapse-btn');
const timelineChevronIcon = document.getElementById('timeline-chevron-icon');
const timelineBody = document.getElementById('timeline-body');
const activeTrackNameEl = document.getElementById('active-track-name');
const trackKeyframeCountEl = document.getElementById('track-keyframe-count');
const timelineTrack = document.getElementById('timeline-track');
const timelineTicks = document.getElementById('timeline-ticks');
const timelineKeyframes = document.getElementById('timeline-keyframes');
const timelinePlayhead = document.getElementById('timeline-playhead');
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
transformControls.setSize(0.8);
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
  } else if (state.autoKey && state.selectedTarget) {
    recordManualKeyframe(true);
  }
});

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x262b38, 0.45);
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

const rimLight = new THREE.DirectionalLight(0x818cf8, 0.65);
rimLight.position.set(-5, 3, -5);
scene.add(rimLight);

let gridHelper = new THREE.GridHelper(10, 20, BG_PRESETS['dark-studio'].gridCenter, BG_PRESETS['dark-studio'].gridLine);
gridHelper.material.opacity = 0.55;
gridHelper.material.transparent = true;
scene.add(gridHelper);

const shadowPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 16),
  new THREE.ShadowMaterial({ opacity: 0.28 })
);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://unpkg.com/three@0.170.0/examples/jsm/libs/draco/gltf/');

function createShowcaseModel() {
  const root = new THREE.Group();
  root.name = 'StudioShowcaseCore';

  const darkTitaniumMat = new THREE.MeshStandardMaterial({
    color: 0x1e2430,
    metalness: 0.85,
    roughness: 0.26,
  });
  const brushedSilverMat = new THREE.MeshStandardMaterial({
    color: 0xdbe2ef,
    metalness: 0.92,
    roughness: 0.18,
  });
  const accentIndigoMat = new THREE.MeshStandardMaterial({
    color: 0x6366f1,
    emissive: 0x312e81,
    emissiveIntensity: 0.55,
    metalness: 0.35,
    roughness: 0.2,
  });
  const glassCoreMat = new THREE.MeshPhysicalMaterial({
    color: 0xa5b4fc,
    metalness: 0.05,
    roughness: 0.08,
    transmission: 0.72,
    thickness: 0.8,
    ior: 1.48,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 0.14, 64), darkTitaniumMat);
  base.position.y = 0.07;
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);

  const baseRing = new THREE.Mesh(new THREE.TorusGeometry(1.16, 0.02, 24, 64), accentIndigoMat);
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

  const midRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.045, 28, 72), darkTitaniumMat);
  midRing.name = 'MidRing';
  midRing.rotation.y = Math.PI / 4;
  midRing.castShadow = true;
  gimbalPivot.add(midRing);

  const coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), glassCoreMat);
  coreMesh.name = 'CrystalCore';
  coreMesh.castShadow = true;
  gimbalPivot.add(coreMesh);

  const innerCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), accentIndigoMat);
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
      mats.forEach((mat) => {
        if (mat) {
          uniqueMaterials.add(mat);
          if (mat.userData.originalWireframe === undefined) {
            mat.userData.originalWireframe = Boolean(mat.wireframe);
          }
        }
      });
    }
  });

  wrapper.updateMatrixWorld(true);
  const normBox = new THREE.Box3().setFromObject(wrapper);
  const normSize = new THREE.Vector3();
  normBox.getSize(normSize);

  return {
    wrapper,
    normalizedHeight: normSize.y || 1.5,
    stats: {
      meshes: meshCount,
      materials: uniqueMaterials.size,
      triangles: triangleCount,
      vertices: vertexCount,
      dimensions: `${rawSize.x.toFixed(2)} × ${rawSize.y.toFixed(2)} × ${rawSize.z.toFixed(2)}`,
    }
  };
}

function applyWireframeToModel(group, enabled) {
  if (!group) return;
  group.traverse((child) => {
    if (child.isMesh && child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        mat.wireframe = enabled ? true : Boolean(mat.userData.originalWireframe);
      });
    }
  });
}

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

function getActiveModel() {
  return state.models.find((m) => m.id === state.activeModelId) || null;
}

function getSelectedClipDescriptor(model) {
  if (!model) return null;
  const val = animClipSelect.value;
  if (!val) return null;
  if (val.startsWith('custom:')) {
    const id = val.slice(7);
    const custom = model.customClips.find((c) => c.id === id);
    return custom ? { type: 'custom', custom } : null;
  }
  if (val.startsWith('embedded:')) {
    const idx = Number(val.slice(9));
    const clip = model.animations[idx];
    return clip ? { type: 'embedded', index: idx, clip } : null;
  }
  return null;
}

function activateModel(modelId) {
  const targetModel = state.models.find((m) => m.id === modelId);
  if (!targetModel) return;

  selectObjectForPosing(null, true);

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
  applyWireframeToModel(targetModel.group, state.wireframe);

  document.getElementById('info-name').textContent = targetModel.name;
  document.getElementById('info-name').title = targetModel.name;
  document.getElementById('info-size').textContent = targetModel.sizeLabel;
  document.getElementById('info-meshes').textContent = targetModel.stats.meshes.toLocaleString();
  document.getElementById('info-materials').textContent = targetModel.stats.materials.toLocaleString();
  document.getElementById('info-triangles').textContent = targetModel.stats.triangles.toLocaleString();
  document.getElementById('info-vertices').textContent = targetModel.stats.vertices.toLocaleString();
  document.getElementById('info-dimensions').textContent = targetModel.stats.dimensions;

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

  state.models.forEach((model) => {
    const isActive = model.id === state.activeModelId;
    const totalAnimCount = model.animations.length + model.customClips.length;
    const item = document.createElement('div');
    item.className = `group flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 cursor-pointer transition ${
      isActive
        ? 'bg-indigo-600/20 border border-indigo-500/40 text-white'
        : 'border border-transparent hover:bg-white/[0.05] text-slate-300'
    }`;

    item.innerHTML = `
      <div class="flex items-center gap-2.5 min-w-0 flex-1">
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          isActive ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-400 group-hover:text-slate-200'
        }">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          </svg>
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-xs font-medium ${isActive ? 'text-white' : 'text-slate-200'}">${escapeHtml(model.name)}</div>
          <div class="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
            <span>${escapeHtml(model.sizeLabel)}</span>
            ${totalAnimCount > 0 ? `<span class="text-indigo-300">• ${totalAnimCount} anim</span>` : ''}
          </div>
        </div>
      </div>
      ${
        !model.isDefault
          ? `<button type="button" data-delete-id="${model.id}" title="Remove Model"
              class="delete-model-btn rounded-lg p-1.5 text-slate-400 opacity-70 hover:opacity-100 hover:bg-rose-500/20 hover:text-rose-300 transition">
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>`
          : `<span class="rounded bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-slate-400">Demo</span>`
      }
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.delete-model-btn')) return;
      activateModel(model.id);
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

function createCustomClipEntry(model, customName) {
  const index = model.customClips.length + 1;
  const name = customName || (index === 1 ? '★ Custom Manual Animation' : `★ Custom Clip ${index}`);
  const entry = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    duration: 4.0,
    tracks: new Map(),
    compiledClip: null,
  };
  model.customClips.push(entry);
  return entry;
}

function ensureActiveCustomClip(model) {
  const desc = getSelectedClipDescriptor(model);
  if (desc && desc.type === 'custom') {
    return desc.custom;
  }
  if (model.customClips.length > 0) {
    const existing = model.customClips[0];
    populateClipSelector(model, `custom:${existing.id}`);
    activateSelectedClip(model, 0);
    return existing;
  }
  const created = createCustomClipEntry(model);
  populateClipSelector(model, `custom:${created.id}`);
  activateSelectedClip(model, 0);
  renderModelsList();
  return created;
}

function populateClipSelector(model, preferredValue) {
  const prevVal = preferredValue || animClipSelect.value;
  animClipSelect.innerHTML = '';

  model.customClips.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = `custom:${c.id}`;
    opt.textContent = c.name;
    animClipSelect.appendChild(opt);
  });

  model.animations.forEach((clip, idx) => {
    const opt = document.createElement('option');
    opt.value = `embedded:${idx}`;
    opt.textContent = clip.name || `Animation ${idx + 1}`;
    animClipSelect.appendChild(opt);
  });

  if (prevVal && Array.from(animClipSelect.options).some((o) => o.value === prevVal)) {
    animClipSelect.value = prevVal;
  } else if (animClipSelect.options.length > 0) {
    animClipSelect.selectedIndex = 0;
  }
}

function setupAnimationsForModel(model) {
  const hasAnyClip = model.animations.length > 0 || model.customClips.length > 0;
  if (!hasAnyClip) {
    animationBar.classList.add('hidden');
    renderTimelineRuler(4.0);
    renderTimelineKeyframes();
    updateTrackStatusUI();
    return;
  }

  animationBar.classList.remove('hidden');
  if (!state.mixer) {
    state.mixer = new THREE.AnimationMixer(model.group);
  }
  state.mixer.timeScale = state.playbackSpeed;

  populateClipSelector(model);
  activateSelectedClip(model, 0);
}

function activateSelectedClip(model, seekTime = 0) {
  if (!model) return;
  if (!state.mixer) {
    state.mixer = new THREE.AnimationMixer(model.group);
    state.mixer.timeScale = state.playbackSpeed;
  }

  state.mixer.stopAllAction();
  state.activeAction = null;

  const desc = getSelectedClipDescriptor(model);
  if (!desc) return;

  let duration = 4.0;
  let clipToPlay = null;

  if (desc.type === 'custom') {
    duration = desc.custom.duration;
    clipToPlay = desc.custom.compiledClip;
  } else {
    clipToPlay = desc.clip;
    duration = clipToPlay.duration || 4.0;
  }

  animDurationInput.value = duration.toFixed(1);
  animDurationInput.disabled = desc.type !== 'custom';
  renderTimelineRuler(duration);

  if (clipToPlay) {
    const action = state.mixer.clipAction(clipToPlay);
    action.reset();
    action.setLoop(state.isLooping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !state.isLooping;
    action.play();
    action.time = Math.max(0, Math.min(seekTime, duration));
    action.paused = !state.isPlaying;
    state.activeAction = action;
    state.mixer.update(0);
    state.currentTime = action.time;
  } else {
    state.currentTime = Math.max(0, Math.min(seekTime, duration));
  }

  updatePlayPauseUI();
  updatePlayheadPosition(state.currentTime, duration);
  renderTimelineKeyframes();
  updateTrackStatusUI();
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

function updateLoopUI() {
  animLoopBtn.setAttribute('aria-pressed', String(state.isLooping));
  if (state.isLooping) {
    animLoopBtn.classList.add('border-indigo-500/50', 'bg-indigo-500/15', 'text-indigo-300');
    animLoopBtn.classList.remove('border-white/10', 'bg-white/[0.04]', 'text-slate-400');
  } else {
    animLoopBtn.classList.remove('border-indigo-500/50', 'bg-indigo-500/15', 'text-indigo-300');
    animLoopBtn.classList.add('border-white/10', 'bg-white/[0.04]', 'text-slate-400');
  }
  if (state.activeAction) {
    state.activeAction.setLoop(state.isLooping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    state.activeAction.clampWhenFinished = !state.isLooping;
  }
}

function updateAutoKeyUI() {
  autoKeyBtn.setAttribute('aria-pressed', String(state.autoKey));
  if (state.autoKey) {
    autoKeyBtn.classList.add('border-amber-500/50', 'bg-amber-500/15', 'text-amber-300');
    autoKeyBtn.classList.remove('border-white/10', 'bg-white/[0.04]', 'text-slate-300');
    autoKeyDot.classList.remove('bg-slate-500');
    autoKeyDot.classList.add('bg-amber-400', 'animate-pulse');
  } else {
    autoKeyBtn.classList.remove('border-amber-500/50', 'bg-amber-500/15', 'text-amber-300');
    autoKeyBtn.classList.add('border-white/10', 'bg-white/[0.04]', 'text-slate-300');
    autoKeyDot.classList.remove('bg-amber-400', 'animate-pulse');
    autoKeyDot.classList.add('bg-slate-500');
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
    updateTrackStatusUI();
    renderTimelineKeyframes();
    return;
  }

  controls.autoRotate = false;
  transformControls.attach(obj);
  animationBar.classList.add('posing-active');
  inspectorBadge.classList.add('posing-badge');
  inspectorBadge.textContent = obj.isBone ? `BONE: ${obj.name}` : `PART: ${obj.name}`;

  const activeModel = getActiveModel();
  if (obj.isBone && activeModel) {
    skeletonHelper = new THREE.SkeletonHelper(activeModel.group);
    scene.add(skeletonHelper);
  }

  if (activeModel) {
    if (activeModel.animations.length === 0 && activeModel.customClips.length === 0) {
      const created = createCustomClipEntry(activeModel);
      populateClipSelector(activeModel, `custom:${created.id}`);
      state.isPlaying = false;
      activateSelectedClip(activeModel, 0);
      renderModelsList();
    }
    animationBar.classList.remove('hidden');
  }

  updateTrackStatusUI();
  renderTimelineKeyframes();

  if (!silent) {
    showToast(
      `Selected "${obj.name}" — [W] Move, [E] Rotate, [S] Scale, [K] Keyframe, [Esc] Done`,
      'info'
    );
  }
}

function updateTrackStatusUI() {
  const model = getActiveModel();
  const obj = state.selectedTarget;
  activeTrackNameEl.textContent = obj ? obj.name : 'None selected';

  if (!model) {
    trackKeyframeCountEl.textContent = '0 keyframes';
    return;
  }

  const desc = getSelectedClipDescriptor(model);
  if (!desc || desc.type !== 'custom') {
    const clipCount = desc && desc.clip ? desc.clip.tracks.length : 0;
    trackKeyframeCountEl.textContent = `${clipCount} embedded tracks`;
    return;
  }

  if (obj && desc.custom.tracks.has(obj.uuid)) {
    const count = desc.custom.tracks.get(obj.uuid).keyframes.length;
    trackKeyframeCountEl.textContent = `${count} ${count === 1 ? 'keyframe' : 'keyframes'}`;
  } else {
    let total = 0;
    desc.custom.tracks.forEach((t) => {
      total += t.keyframes.length;
    });
    trackKeyframeCountEl.textContent = `${total} ${total === 1 ? 'keyframe' : 'keyframes'}`;
  }
}

function getActiveDuration(model) {
  const desc = getSelectedClipDescriptor(model);
  if (!desc) return 4.0;
  if (desc.type === 'custom') return desc.custom.duration;
  return desc.clip.duration || 4.0;
}

function seekTimelineToSeconds(seconds) {
  const model = getActiveModel();
  if (!model) return;
  const duration = getActiveDuration(model);
  const clamped = Math.max(0, Math.min(seconds, duration));
  state.currentTime = clamped;

  if (state.activeAction && state.mixer) {
    state.activeAction.time = clamped;
    state.mixer.update(0);
  }
  updatePlayheadPosition(clamped, duration);
}

function updatePlayheadPosition(current, total) {
  const safeTotal = total > 0 ? total : 4.0;
  const pct = Math.max(0, Math.min(100, (current / safeTotal) * 100));
  timelinePlayhead.style.left = `${pct}%`;
  animCurrentTimeEl.textContent = `${current.toFixed(2)}s`;
}

function renderTimelineRuler(duration) {
  timelineTicks.innerHTML = '';
  const safeDur = Math.max(0.5, duration);
  const step = safeDur <= 2 ? 0.25 : safeDur <= 6 ? 0.5 : safeDur <= 15 ? 1 : 2;
  const subDivs = 4;
  const totalSteps = Math.floor(safeDur / step);

  for (let i = 0; i <= totalSteps; i++) {
    const t = Number((i * step).toFixed(3));
    if (t > safeDur) break;
    const pct = (t / safeDur) * 100;

    const major = document.createElement('div');
    major.className = 'timeline-tick-major';
    major.style.left = `${pct}%`;

    if (t < safeDur - step * 0.25) {
      const label = document.createElement('span');
      label.className = 'timeline-tick-label';
      label.textContent = Number.isInteger(t) ? `${t}s` : `${t.toFixed(1)}s`;
      major.appendChild(label);
    }
    timelineTicks.appendChild(major);

    for (let s = 1; s < subDivs; s++) {
      const subT = t + (step / subDivs) * s;
      if (subT >= safeDur) break;
      const sub = document.createElement('div');
      sub.className = 'timeline-tick-minor';
      sub.style.left = `${(subT / safeDur) * 100}%`;
      timelineTicks.appendChild(sub);
    }
  }
}

function renderTimelineKeyframes() {
  timelineKeyframes.innerHTML = '';
  const model = getActiveModel();
  if (!model) return;
  const desc = getSelectedClipDescriptor(model);
  if (!desc || desc.type !== 'custom') return;

  const duration = desc.custom.duration || 4.0;
  const selectedUuid = state.selectedTarget ? state.selectedTarget.uuid : null;

  desc.custom.tracks.forEach(({ object, keyframes }, uuid) => {
    const isPrimary = !selectedUuid || uuid === selectedUuid;
    keyframes.forEach((kf) => {
      const pct = Math.max(0, Math.min(100, (kf.time / duration) * 100));
      const diamond = document.createElement('button');
      diamond.type = 'button';
      diamond.className = isPrimary ? 'timeline-diamond' : 'timeline-diamond is-secondary';
      diamond.style.left = `${pct}%`;
      diamond.title = `${object.name} @ ${kf.time.toFixed(2)}s`;

      diamond.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
      });
      diamond.addEventListener('click', (e) => {
        e.stopPropagation();
        state.isPlaying = false;
        if (state.activeAction) state.activeAction.paused = true;
        updatePlayPauseUI();
        if (state.selectedTarget !== object) {
          selectObjectForPosing(object, true);
        }
        seekTimelineToSeconds(kf.time);
      });

      timelineKeyframes.appendChild(diamond);
    });
  });
}

function recordManualKeyframe(silent = false) {
  const obj = state.selectedTarget;
  const model = getActiveModel();
  if (!obj || !model) {
    if (!silent) {
      showToast('Click any mesh or bone on the 3D model first to pose and keyframe.', 'info');
    }
    return;
  }

  const custom = ensureActiveCustomClip(model);
  const time = Number(Math.max(0, Math.min(state.currentTime, custom.duration)).toFixed(2));

  let entry = custom.tracks.get(obj.uuid);
  if (!entry) {
    entry = { object: obj, keyframes: [] };
    custom.tracks.set(obj.uuid, entry);
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

  rebuildCustomAnimationClip(model, custom, time);
  if (!silent) {
    showToast(`Keyframe saved for "${obj.name}" at ${time.toFixed(2)}s`, 'success');
  }
}

function deleteManualKeyframe() {
  const obj = state.selectedTarget;
  const model = getActiveModel();
  if (!obj || !model) return;
  const desc = getSelectedClipDescriptor(model);
  if (!desc || desc.type !== 'custom') return;

  const entry = desc.custom.tracks.get(obj.uuid);
  if (!entry || entry.keyframes.length === 0) return;

  const time = state.currentTime;
  const before = entry.keyframes.length;
  entry.keyframes = entry.keyframes.filter((kf) => Math.abs(kf.time - time) >= 0.08);

  if (entry.keyframes.length !== before) {
    if (entry.keyframes.length === 0) {
      desc.custom.tracks.delete(obj.uuid);
    }
    rebuildCustomAnimationClip(model, desc.custom, time);
    showToast(`Deleted keyframe on "${obj.name}" at ${time.toFixed(2)}s`, 'info');
  }
}

function clearSelectedTrack() {
  const obj = state.selectedTarget;
  const model = getActiveModel();
  if (!obj || !model) {
    showToast('Select a mesh or bone first to clear its track.', 'info');
    return;
  }
  const desc = getSelectedClipDescriptor(model);
  if (!desc || desc.type !== 'custom') return;

  if (desc.custom.tracks.delete(obj.uuid)) {
    rebuildCustomAnimationClip(model, desc.custom, state.currentTime);
    showToast(`Cleared all keyframes for "${obj.name}"`, 'info');
  }
}

function rebuildCustomAnimationClip(model, custom, seekTime = 0) {
  const tracks = [];
  const duration = custom.duration;

  custom.tracks.forEach(({ object, keyframes }) => {
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
    });

    if (times.length === 1) {
      const holdT = times[0] < duration ? duration : times[0] + 0.1;
      times.push(holdT);
      positions.push(...keyframes[0].pos);
      quaternions.push(...keyframes[0].quat);
      scales.push(...keyframes[0].scale);
    }

    const nodeName = object.name;
    tracks.push(new THREE.VectorKeyframeTrack(`${nodeName}.position`, times, positions));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${nodeName}.quaternion`, times, quaternions));
    tracks.push(new THREE.VectorKeyframeTrack(`${nodeName}.scale`, times, scales));
  });

  custom.compiledClip = tracks.length > 0
    ? new THREE.AnimationClip(custom.name.replace(/^★\s*/, ''), duration, tracks)
    : null;

  state.isPlaying = false;
  activateSelectedClip(model, seekTime);
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
  const model = getActiveModel();
  if (!model) return;

  const prevSelected = state.selectedTarget;
  if (prevSelected) transformControls.detach();

  const allClips = [
    ...model.animations,
    ...model.customClips.map((c) => c.compiledClip).filter(Boolean),
  ];

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
    { binary: true, animations: allClips }
  );
}

function scrubFromPointerEvent(e) {
  const model = getActiveModel();
  if (!model) return;
  const rect = timelineTrack.getBoundingClientRect();
  if (rect.width <= 0) return;
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const duration = getActiveDuration(model);
  seekTimelineToSeconds(ratio * duration);
}

timelineTrack.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  state.isScrubbing = true;
  if (state.isPlaying && state.activeAction) {
    state.isPlaying = false;
    state.activeAction.paused = true;
    updatePlayPauseUI();
  }
  timelineTrack.setPointerCapture(e.pointerId);
  scrubFromPointerEvent(e);
});

timelineTrack.addEventListener('pointermove', (e) => {
  if (!state.isScrubbing) return;
  scrubFromPointerEvent(e);
});

timelineTrack.addEventListener('pointerup', (e) => {
  if (!state.isScrubbing) return;
  state.isScrubbing = false;
  if (timelineTrack.hasPointerCapture(e.pointerId)) {
    timelineTrack.releasePointerCapture(e.pointerId);
  }
});

newClipBtn.addEventListener('click', () => {
  const model = getActiveModel();
  if (!model) return;
  const created = createCustomClipEntry(model);
  populateClipSelector(model, `custom:${created.id}`);
  state.isPlaying = false;
  activateSelectedClip(model, 0);
  renderModelsList();
  showToast(`Created "${created.name}"`, 'success');
});

animRestartBtn.addEventListener('click', () => {
  seekTimelineToSeconds(0);
});

animPlayBtn.addEventListener('click', () => {
  const model = getActiveModel();
  if (!model) return;
  const duration = getActiveDuration(model);
  if (!state.isPlaying && state.currentTime >= duration - 0.01) {
    seekTimelineToSeconds(0);
  }
  state.isPlaying = !state.isPlaying;
  if (state.activeAction) {
    state.activeAction.paused = !state.isPlaying;
    if (state.isPlaying && !state.activeAction.isRunning()) {
      state.activeAction.reset();
      state.activeAction.play();
    }
  }
  updatePlayPauseUI();
});

animLoopBtn.addEventListener('click', () => {
  state.isLooping = !state.isLooping;
  updateLoopUI();
});

animClipSelect.addEventListener('change', () => {
  const model = getActiveModel();
  if (!model) return;
  activateSelectedClip(model, 0);
});

animDurationInput.addEventListener('change', () => {
  const model = getActiveModel();
  if (!model) return;
  const desc = getSelectedClipDescriptor(model);
  if (!desc || desc.type !== 'custom') return;
  const val = Math.max(0.5, Math.min(120, parseFloat(animDurationInput.value) || 4.0));
  animDurationInput.value = val.toFixed(1);
  desc.custom.duration = val;
  rebuildCustomAnimationClip(model, desc.custom, Math.min(state.currentTime, val));
});

addKeyframeBtn.addEventListener('click', () => recordManualKeyframe(false));
deleteKeyframeBtn.addEventListener('click', () => deleteManualKeyframe());
clearTrackBtn.addEventListener('click', () => clearSelectedTrack());

autoKeyBtn.addEventListener('click', () => {
  state.autoKey = !state.autoKey;
  updateAutoKeyUI();
  showToast(`Auto-Key ${state.autoKey ? 'enabled' : 'disabled'}`, 'info');
});

toggleTimelineCollapseBtn.addEventListener('click', () => {
  state.timelineCollapsed = !state.timelineCollapsed;
  timelineBody.classList.toggle('hidden', state.timelineCollapsed);
  timelineChevronIcon.classList.toggle('rotate-180', state.timelineCollapsed);
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
        ? 'anim-speed-btn rounded-lg bg-indigo-600 px-2 py-1 font-mono text-[11px] font-semibold text-white transition'
        : 'anim-speed-btn rounded-lg px-2 py-1 font-mono text-[11px] text-slate-400 hover:text-white transition';
    });
  });
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || state.isDraggingGizmo) return;
  pointerDownPos.set(e.clientX, e.clientY);
  pointerDownTime = performance.now();
});

canvas.addEventListener('pointermove', (e) => {
  if (state.isDraggingGizmo || state.isOrbiting) return;
  const activeModel = getActiveModel();
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
  if (moveDist > 5 || elapsed > 350) return;

  const activeModel = getActiveModel();
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

async function handleUploadedFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  const resourceMap = new Map();
  const blobUrls = [];
  files.forEach((f) => {
    const url = URL.createObjectURL(f);
    blobUrls.push(url);
    resourceMap.set(f.name, url);
  });

  const modelFiles = files.filter((f) => /\.(glb|gltf)$/i.test(f.name));
  if (modelFiles.length === 0) {
    blobUrls.forEach((u) => URL.revokeObjectURL(u));
    showToast('Unsupported file format. Please upload .glb or .gltf files.', 'error');
    return;
  }

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
      (gltf) => {
        try {
          const { wrapper, normalizedHeight, stats } = normalizeAndInspectModel(gltf.scene);
          const newModel = {
            id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name,
            sizeLabel: formatBytes(file.size),
            group: wrapper,
            normalizedHeight,
            animations: gltf.animations || [],
            customClips: [],
            stats,
            isDefault: false,
            blobUrls: sharedBlobUrls,
          };

          state.models.push(newModel);
          activateModel(newModel.id);
          setLoading(false);
          showToast(`Loaded "${file.name}"`, 'success');
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
  const activeModel = getActiveModel();
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

function setSwitchState(btnEl, isOn) {
  btnEl.setAttribute('aria-checked', String(isOn));
  const knob = btnEl.querySelector('span');
  if (isOn) {
    btnEl.classList.remove('bg-slate-700');
    btnEl.classList.add('bg-indigo-600');
    knob.classList.remove('translate-x-0');
    knob.classList.add('translate-x-4');
  } else {
    btnEl.classList.remove('bg-indigo-600');
    btnEl.classList.add('bg-slate-700');
    knob.classList.remove('translate-x-4');
    knob.classList.add('translate-x-0');
  }
}

const autoRotateToggle = document.getElementById('auto-rotate-toggle');
const rotateSpeedSlider = document.getElementById('rotate-speed-slider');
const rotateSpeedVal = document.getElementById('rotate-speed-val');

autoRotateToggle.addEventListener('click', () => {
  state.autoRotate = !state.autoRotate;
  controls.autoRotate = state.autoRotate;
  setSwitchState(autoRotateToggle, state.autoRotate);
});

rotateSpeedSlider.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  state.autoRotateSpeed = val;
  controls.autoRotateSpeed = val;
  rotateSpeedVal.textContent = `${val.toFixed(1)}x`;
});

const wireframeToggle = document.getElementById('wireframe-toggle');
wireframeToggle.addEventListener('click', () => {
  state.wireframe = !state.wireframe;
  setSwitchState(wireframeToggle, state.wireframe);
  const activeModel = getActiveModel();
  if (activeModel) {
    applyWireframeToModel(activeModel.group, state.wireframe);
  }
});

const gridToggle = document.getElementById('grid-toggle');
gridToggle.addEventListener('click', () => {
  state.showGrid = !state.showGrid;
  setSwitchState(gridToggle, state.showGrid);
  gridHelper.visible = state.showGrid;
  shadowPlane.visible = state.showGrid;
});

document.querySelectorAll('.bg-preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.bg;
    const preset = BG_PRESETS[key];
    if (!preset) return;

    state.bgPreset = key;
    scene.background = new THREE.Color(preset.color);
    document.getElementById('bg-label').textContent = preset.label;

    scene.remove(gridHelper);
    gridHelper.geometry.dispose();
    gridHelper.material.dispose();
    gridHelper = new THREE.GridHelper(10, 20, preset.gridCenter, preset.gridLine);
    gridHelper.material.opacity = 0.55;
    gridHelper.material.transparent = true;
    gridHelper.visible = state.showGrid;
    scene.add(gridHelper);

    document.querySelectorAll('.bg-preset-btn').forEach((b) => {
      const active = b.dataset.bg === key;
      b.classList.toggle('border-indigo-500', active);
      b.classList.toggle('border-transparent', !active);
    });
  });
});

const exposureSlider = document.getElementById('exposure-slider');
const exposureVal = document.getElementById('exposure-val');
exposureSlider.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  state.exposure = val;
  renderer.toneMappingExposure = val;
  exposureVal.textContent = `${val.toFixed(2)} EV`;
});

function togglePanel(panelEl) {
  panelEl.classList.toggle('hidden');
}

document.getElementById('toggle-models-btn').addEventListener('click', () => togglePanel(modelsPanel));
document.getElementById('close-models-btn').addEventListener('click', () => modelsPanel.classList.add('hidden'));
document.getElementById('toggle-studio-btn').addEventListener('click', () => togglePanel(studioPanel));
document.getElementById('close-studio-btn').addEventListener('click', () => studioPanel.classList.add('hidden'));

if (window.innerWidth < 768) {
  modelsPanel.classList.add('hidden');
  studioPanel.classList.add('hidden');
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
    recordManualKeyframe(false);
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedTarget) {
    e.preventDefault();
    deleteManualKeyframe();
  } else if (e.key === 'Home') {
    seekTimelineToSeconds(0);
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
  } else if (e.code === 'Space' && !animationBar.classList.contains('hidden')) {
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
  const colors = {
    success: 'border-emerald-500/40 bg-studio-900/95 text-emerald-200',
    error:   'border-rose-500/40 bg-studio-900/95 text-rose-200',
    info:    'border-indigo-500/40 bg-studio-900/95 text-slate-200',
  };
  const dotColors = {
    success: 'bg-emerald-400',
    error:   'bg-rose-400',
    info:    'bg-indigo-400',
  };

  const toast = document.createElement('div');
  toast.className = `pointer-events-auto flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-xs font-medium backdrop-blur-xl shadow-2xl transition-all duration-300 translate-y-2 opacity-0 ${colors[type] || colors.info}`;
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
}

const resizeObserver = new ResizeObserver(handleResize);
resizeObserver.observe(container);
window.addEventListener('resize', handleResize);

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  const model = getActiveModel();
  if (model) {
    const duration = getActiveDuration(model);
    if (state.mixer && state.activeAction) {
      if (!state.isScrubbing && state.isPlaying && !state.isDraggingGizmo) {
        state.mixer.update(delta);
        if (!state.isLooping && state.activeAction.time >= duration) {
          state.isPlaying = false;
          state.activeAction.paused = true;
          updatePlayPauseUI();
        }
      }
      const rawTime = state.activeAction.time;
      const displayTime = state.isLooping && duration > 0 ? (rawTime % duration) : Math.min(rawTime, duration);
      state.currentTime = displayTime;
      updatePlayheadPosition(displayTime, duration);
    } else if (!state.isScrubbing && state.isPlaying) {
      let next = state.currentTime + delta * state.playbackSpeed;
      if (next >= duration) {
        if (state.isLooping) {
          next = next % duration;
        } else {
          next = duration;
          state.isPlaying = false;
          updatePlayPauseUI();
        }
      }
      state.currentTime = next;
      updatePlayheadPosition(next, duration);
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
  const showcase = createShowcaseModel();
  const { wrapper, normalizedHeight, stats } = normalizeAndInspectModel(showcase.group);

  const defaultModel = {
    id: 'default-showcase',
    name: 'Studio Showcase Core',
    sizeLabel: 'Procedural',
    group: wrapper,
    normalizedHeight,
    animations: showcase.animations,
    customClips: [],
    stats,
    isDefault: true,
    blobUrls: [],
  };

  state.models.push(defaultModel);
  activateModel(defaultModel.id);
  setCameraPreset('fit', false);
  animate();
});
