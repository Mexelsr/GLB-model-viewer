# Prism 3D — GLB / GLTF Studio Viewer

A fast, zero-build, browser-based 3D model viewer, mesh inspector, and keyframe poser for **`.glb`** and **`.gltf`** assets powered by **Three.js**.

**[Live Demo → glb-model-viewer-phi.vercel.app](https://glb-model-viewer-phi.vercel.app/)**

---

## Features

### 1. Drag-and-Drop Asset Loading
- **Multi-Format Support:** Load self-contained `.glb` files or multi-file `.gltf` packages (drop the `.gltf`, `.bin`, and external textures together).
- **Draco Compression:** Built-in `DRACOLoader` support for compressed geometry.
- **Auto-Normalization:** Automatically scales and centers imported models onto the ground plane with calibrated camera framing.
- **Multi-Model Scene Switcher:** Load multiple models in a single session and switch between them effortlessly from the **Models** drawer.

### 2. Studio Rendering & Shading Controls
- **PBR Studio Lighting:** Image-based lighting via `RoomEnvironment` (PMREM), directional key/rim lights, soft PCF shadows, and ACES Filmic tone mapping.
- **Environment & Exposure:** Switch between 4 studio backdrops (**Dark Studio**, **Charcoal**, **Light Gray**, **Deep Navy**) and adjust tone exposure (`0.20 EV` – `2.50 EV`).
- **Wireframe Overlay:** Toggle triangle wireframe inspection on any loaded model.
- **Vertex Colors (`COLOR_0`) Toggle:** Disable embedded `COLOR_0` vertex attributes on the fly—ideal for inspecting anime or game character models that store shader masks in vertex color channels.
- **Turntable Auto-Rotate:** Smooth orbital damping with adjustable turntable rotation speed.

### 3. Real-Time Model Inspector
- Displays live telemetry for the active asset:
  - File Name & File Size
  - Mesh Count & Unique Material Count
  - Triangle & Vertex Counts
  - Raw Bounding Box Dimensions (`W × H × D`)

### 4. Animation Timeline, Bone Posing & GLB Export
- **Animation Playback:** Play, pause, scrub, switch between embedded animation clips, and adjust playback speed (`0.5x`, `1x`, `2x`).
- **Interactive Mesh & Bone Posing:** Click any mesh part—or the nearest skeleton bone on a `SkinnedMesh` (with automatic `SkeletonHelper` visualization)—to attach a 3D transform gizmo.
- **Custom Keyframe Editor:** Record and delete position, rotation, and scale keyframes directly on the timeline to create custom animations.
- **Binary `.glb` Export:** Export your posed or newly animated model back to a self-contained `.glb` file (`Ctrl + E` / `Cmd + E`).

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `R` | Reset & fit camera to model |
| `1` / `2` / `3` / `4` | Switch camera view (`Front` / `Right` / `Top` / `Isometric`) |
| `Space` | Play / Pause active animation |
| `W` / `E` / `S` | Switch gizmo mode (`Move` / `Rotate` / `Scale`) when a part or bone is selected |
| `X` | Toggle gizmo coordinate space (`Local` / `World`) |
| `K` | Record keyframe at current timeline position for selected part/bone |
| `Delete` / `Backspace` | Delete keyframe at current timeline position |
| `Alt + R` | Reset selected part/bone to its rest pose |
| `Esc` | Deselect current part/bone |
| `Ctrl + E` / `Cmd + E` | Export current model and animations as `.glb` |

---

## Project Structure

```text
├── index.html   # Responsive studio layout, drawers, and importmap
├── style.css    # Custom scrollbars, sliders, viewport cursors, and safe-area rules
└── app.js       # Three.js scene, GLTF/Draco loader, inspector, poser, and exporter
```

---

## Getting Started

Because Prism 3D uses native ES Modules (`<script type="importmap">`), no bundler or `npm install` step is required—just serve the directory over a local HTTP server:

```bash
# 1. Clone the repository
git clone https://github.com/your-username/glb-model-viewer.git
cd glb-model-viewer

# 2. Start any static server (pick one)
npx serve .
# or with Python 3:
python -m http.server 8080
```

Then open `http://localhost:8080` (or the URL printed in your terminal) in any modern browser.

---

## Tech Stack

- **[Three.js](https://threejs.org/)** (`v0.170.0`) — WebGL rendering, `GLTFLoader`, `DRACOLoader`, `OrbitControls`, `TransformControls`, `RoomEnvironment`, and `GLTFExporter`
- **[Tailwind CSS](https://tailwindcss.com/)** — Responsive dark UI styling
- **[Inter](https://fonts.google.com/specimen/Inter) & [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono)** — UI and telemetry typography

---

## License

MIT License — feel free to use, modify, and deploy for your own 3D workflows.
