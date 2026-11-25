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
  bgPreset: 'dark-studio',
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
};

const BG_PRESETS = {
  'dark-studio': { color: 0x09090b, label: 'Dark Studio', gridCenter: 0x3f3f46, gridLine: 0x18181b },
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

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x18181b, 0.45);
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

const rimLight = new THREE.DirectionalLight(0xe4e4e7, 0.65);
rimLight.position.set(-5, 3, -5);
scene.add(rimLight);

let gridHelper = new THREE.GridHelper(10, 20, BG_PRESETS['dark-studio'].gridCenter, BG_PRESETS['dark-studio'].gridLine);
gridHelper.material.opacity = 0.65;
gridHelper.material.transparent = true;
scene.add(gridHelper);

const shadowPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 16),
  new THREE.ShadowMaterial({ opacity: 0.32 })
);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://unpkg.com/three@0.170.0/examples/jsm/libs/draco/gltf/');

function setAnimationBarVisible(visible) {
  animationBar.classList.toggle('hidden', !visible);
  document.body.classList.toggle('has-anim-bar', visible);
}

function createShowcaseModel() {
  const root = new THREE.Group();
  root.name = 'StudioShowcaseCore';

  const darkTitaniumMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    metalness: 0.85,
    roughness: 0.26,
  });
  const brushedSilverMat = new THREE.MeshStandardMaterial({
    color: 0xe4e4e7,
    metalness: 0.92,
    roughness: 0.18,
  });
  const accentChromeMat = new THREE.MeshStandardMaterial({
    color: 0xfafafa,
    emissive: 0x3f3f46,
    emissiveIntensity: 0.45,
    metalness: 0.45,
    roughness: 0.18,
  });
  const glassCoreMat = new THREE.MeshPhysicalMaterial({
    color: 0xd4d4d8,
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

  const baseRing = new THREE.Mesh(new THREE.TorusGeometry(1.16, 0.02, 24, 64), accentChromeMat);
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

  const innerCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), accentChromeMat);
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

function detectAnimeShaderMasks(root) {
  let hasNonColorMask = false;

  root.traverse((child) => {
    if (hasNonColorMask || !child.isMesh || !child.geometry) return;
    const colorAttr = child.geometry.attributes.color;
    if (!colorAttr || colorAttr.count === 0) return;

    const mats = Array.isArray(child.material) ? child.material : [child.material];
    const hasDiffuseMap = mats.some((m) => m && m.map);

    // If a textured mesh carries COLOR_0, game rips almost always use it for shader masks
    if (hasDiffuseMap) {
      hasNonColorMask = true;
      return;
    }

    // Sample vertex colors to detect single-channel green/cyan shader mask packing
    const sampleCount = Math.min(colorAttr.count, 160);
    const step = Math.max(1, Math.floor(colorAttr.count / sampleCount));
    let maskChannelHits = 0;

    for (let i = 0; i < colorAttr.count; i += step) {
      const r = colorAttr.getX(i);
      const g = colorAttr.getY(i);
      const b = colorAttr.getZ(i);
      if ((g > 0.65 && r < 0.25) || (b > 0.65 && r < 0.25)) {
        maskChannelHits++;
      }
    }

    if (maskChannelHits / sampleCount > 0.2) {
      hasNonColorMask = true;
    }
  });

  return hasNonColorMask;
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
          if (mat.userData.originalVertexColors === undefined) {
            mat.userData.originalVertexColors = Boolean(mat.vertexColors);
          }
        }
      });
    }
  });

  wrapper.updateMatrixWorld(true);
  const normBox = new THREE.Box3().setFromObject(wrapper);
  const normSize = new THREE.Vector3();
  normBox.getSize(normSize);

  const hasShaderMasks = detectAnimeShaderMasks(wrapper);

  return {
    wrapper,
    normalizedHeight: normSize.y || 1.5,
    hasShaderMasks,
    stats: {
      meshes: meshCount,
      materials: uniqueMaterials.size,
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

  // Automatically disable COLOR_0 when anime/game shader masks are detected
  state.useVertexColors = !targetModel.hasShaderMasks;
  setSwitchState(vertexColorsToggle, state.useVertexColors);
  applyMaterialSettingsToModel(targetModel.group);

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
    headerTrisEl.textContent = tris >= 1000 ? `${(tris / 1000).toFixed(1)}k tris` : `${tris} tris`;
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

  state.models.forEach((model) => {
    const isActive = model.id === state.activeModelId;
    const item = document.createElement('div');
    item.className = `group flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition ${
      isActive
        ? 'bg-zinc-900 border border-zinc-700 text-zinc-50'
        : 'border border-transparent hover:bg-zinc-900/60 text-zinc-400'
    }`;

    item.innerHTML = `
      <div class="flex items-center gap-2.5 min-w-0 flex-1">
        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${
          isActive ? 'border-zinc-50 bg-zinc-50 text-zinc-950' : 'border-zinc-800 bg-zinc-900 text-zinc-400 group-hover:text-zinc-200'
        }">
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          </svg>
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-xs font-medium ${isActive ? 'text-zinc-50' : 'text-zinc-200'}">${escapeHtml(model.name)}</div>
          <div class="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono">
            <span>${escapeHtml(model.sizeLabel)}</span>
            ${model.animations.length > 0 ? `<span class="text-zinc-300">• ${model.animations.length} anim</span>` : ''}
          </div>
        </div>
      </div>
      ${
        !model.isDefault
          ? `<button type="button" data-delete-id="${model.id}" title="Remove Model"
              class="delete-model-btn rounded-md p-1 text-zinc-500 opacity-75 hover:opacity-100 hover:bg-zinc-800 hover:text-zinc-100 transition">
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>`
          : `<span class="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[9px] font-medium text-zinc-400">Demo</span>`
      }
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.delete-model-btn')) return;
      activateModel(model.id);
      if (window.innerWidth < 768) {
        modelsPanel.classList.add('hidden');
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
  const stops = ['#27272a 0%'];
  const sorted = Array.from(allTimes).sort((a, b) => a - b);

  sorted.forEach((t) => {
    const pct = Math.max(0, Math.min(100, (t / (duration || 1)) * 100));
    const start = Math.max(0, pct - 0.8).toFixed(2);
    const end = Math.min(100, pct + 0.8).toFixed(2);
    stops.push(`#27272a ${start}%`);
    stops.push(`#fafafa ${start}%`);
    stops.push(`#fafafa ${end}%`);
    stops.push(`#27272a ${end}%`);
  });
  stops.push('#27272a 100%');

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
        ? 'anim-speed-btn rounded bg-zinc-50 px-2 py-1 font-mono text-[11px] font-semibold text-zinc-950 transition'
        : 'anim-speed-btn rounded px-2 py-1 font-mono text-[11px] text-zinc-400 hover:text-zinc-100 transition';
    });
  });
});

function updateTimecodeUI(current, total) {
  animTimecode.textContent = `${current.toFixed(1)}s / ${total.toFixed(1)}s`;
}

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
          const { wrapper, normalizedHeight, hasShaderMasks, stats } = normalizeAndInspectModel(gltf.scene);
          const newModel = {
            id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name,
            sizeLabel: formatBytes(file.size),
            group: wrapper,
            normalizedHeight,
            hasShaderMasks,
            animations: gltf.animations || [],
            stats,
            isDefault: false,
            blobUrls: sharedBlobUrls,
          };

          state.models.push(newModel);
          activateModel(newModel.id);
          setLoading(false);
          showToast(
            hasShaderMasks
              ? `Loaded "${file.name}" (COLOR_0 shader masks auto-disabled)`
              : `Loaded "${file.name}"`,
            'success'
          );
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

function setSwitchState(btnEl, isOn) {
  btnEl.setAttribute('aria-checked', String(isOn));
  const knob = btnEl.querySelector('span');
  if (isOn) {
    btnEl.classList.remove('bg-zinc-800');
    btnEl.classList.add('bg-zinc-50');
    knob.classList.remove('translate-x-0', 'bg-zinc-400');
    knob.classList.add('translate-x-4', 'bg-zinc-950');
  } else {
    btnEl.classList.remove('bg-zinc-50');
    btnEl.classList.add('bg-zinc-800');
    knob.classList.remove('translate-x-4', 'bg-zinc-950');
    knob.classList.add('translate-x-0', 'bg-zinc-400');
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
  const activeModel = state.models.find((m) => m.id === state.activeModelId);
  if (activeModel) {
    applyMaterialSettingsToModel(activeModel.group);
  }
});

const vertexColorsToggle = document.getElementById('vertex-colors-toggle');
vertexColorsToggle.addEventListener('click', () => {
  state.useVertexColors = !state.useVertexColors;
  setSwitchState(vertexColorsToggle, state.useVertexColors);
  const activeModel = state.models.find((m) => m.id === state.activeModelId);
  if (activeModel) {
    applyMaterialSettingsToModel(activeModel.group);
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
    gridHelper.material.opacity = 0.65;
    gridHelper.material.transparent = true;
    gridHelper.visible = state.showGrid;
    scene.add(gridHelper);

    document.querySelectorAll('.bg-preset-btn').forEach((b) => {
      const active = b.dataset.bg === key;
      const dot = b.querySelector('.bg-radio-dot');
      if (active) {
        b.classList.remove('border-zinc-800', 'bg-zinc-900/40');
        b.classList.add('border-zinc-400', 'bg-zinc-900');
        if (dot) {
          dot.classList.remove('border', 'border-zinc-700', 'bg-transparent');
          dot.classList.add('bg-zinc-50');
        }
      } else {
        b.classList.remove('border-zinc-400', 'bg-zinc-900');
        b.classList.add('border-zinc-800', 'bg-zinc-900/40');
        if (dot) {
          dot.classList.remove('bg-zinc-50');
          dot.classList.add('border', 'border-zinc-700', 'bg-transparent');
        }
      }
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

function togglePanel(panelEl, otherPanelEl) {
  const isHidden = panelEl.classList.contains('hidden');
  if (isHidden) {
    if (window.innerWidth < 768 && otherPanelEl) {
      otherPanelEl.classList.add('hidden');
    }
    panelEl.classList.remove('hidden');
  } else {
    panelEl.classList.add('hidden');
  }
}

document.getElementById('toggle-models-btn').addEventListener('click', () => togglePanel(modelsPanel, studioPanel));
document.getElementById('close-models-btn').addEventListener('click', () => modelsPanel.classList.add('hidden'));
document.getElementById('toggle-studio-btn').addEventListener('click', () => togglePanel(studioPanel, modelsPanel));
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
  const colors = {
    success: 'border-zinc-700 bg-zinc-950/95 text-zinc-100',
    error:   'border-red-900/80 bg-zinc-950/95 text-red-200',
    info:    'border-zinc-800 bg-zinc-950/95 text-zinc-200',
  };
  const dotColors = {
    success: 'bg-zinc-50',
    error:   'bg-red-400',
    info:    'bg-zinc-400',
  };

  const toast = document.createElement('div');
  toast.className = `pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs font-medium backdrop-blur-xl shadow-2xl transition-all duration-300 translate-y-2 opacity-0 ${colors[type] || colors.info}`;
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
  const showcase = createShowcaseModel();
  const { wrapper, normalizedHeight, hasShaderMasks, stats } = normalizeAndInspectModel(showcase.group);

  const defaultModel = {
    id: 'default-showcase',
    name: 'Studio Showcase Core',
    sizeLabel: 'Procedural',
    group: wrapper,
    normalizedHeight,
    hasShaderMasks,
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
