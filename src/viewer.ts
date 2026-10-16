import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { SceneData } from "./core/types";
import { check, LIMITS } from "./core/types";

const vertex = `
varying vec3 vN;
varying vec2 vUv;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const fragment = `
uniform vec3 base;
uniform vec3 shade;
uniform vec3 light;
uniform float border;
uniform bool hasMap;
uniform sampler2D mainMap;
uniform vec2 tiling;
uniform vec2 offset;
varying vec3 vN;
varying vec2 vUv;
void main() {
  float diffuse = dot(normalize(vN), normalize(light)) * 0.5 + 0.5;
  float band = step(border, diffuse);
  vec3 texel = hasMap ? texture2D(mainMap, vUv * tiling + offset).rgb : vec3(1.0);
  gl_FragColor = vec4(base * texel * mix(shade, vec3(1.0), band), 1.0);
  #include <colorspace_fragment>
}`;
const outlineVertex = `
uniform float width;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * width, 1.0);
}`;
const outlineFragment = `
uniform vec3 ink;
void main() {
  gl_FragColor = vec4(ink, 1.0);
  #include <colorspace_fragment>
}`;

export class Viewer {
  private renderer: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(34, 1, 0.01, 100);
  private controls: OrbitControls;
  private model?: T.Group;
  private textures: T.Texture[] = [];
  private materials: T.ShaderMaterial[] = [];
  private outlines: T.ShaderMaterial[] = [];
  private data?: SceneData;
  private resize: ResizeObserver;
  private angle = 0;
  private shadow = true;
  private outline = true;
  private outlineScale = 1;

  constructor(container: HTMLElement) {
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D キャラクタープレビュー。ドラッグで回転、スクロールでズーム",
    );
    this.renderer.domElement.tabIndex = 0;
    container.prepend(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.8;
    this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI * 0.9;
    const grid = new T.GridHelper(12, 48, "#c9c5d6", "#e4e0eb");
    grid.position.y = -0.015;
    const mat = grid.material as T.Material;
    mat.transparent = true;
    mat.opacity = 0.42;
    this.scene.add(grid);
    this.reset();
    this.resize = new ResizeObserver(() => {
      const w = container.clientWidth,
        h = container.clientHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    });
    this.resize.observe(container);
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
    this.renderer.domElement.addEventListener("keydown", (event) => {
      if (event.key === "Home") this.reset();
      if (event.key === "+" || event.key === "=") this.zoom(0.85);
      if (event.key === "-") this.zoom(1.15);
      if (event.key === "ArrowLeft") this.rotate(-0.15);
      if (event.key === "ArrowRight") this.rotate(0.15);
    });
  }

  async show(data: SceneData, valid: () => boolean): Promise<boolean> {
    const textures: T.Texture[] = [];
    try {
      const maps = new Map<string, T.Texture>();
      for (const input of data.textures) {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(input.bytes).buffer], { type: input.mime }),
          { imageOrientation: "flipY", premultiplyAlpha: "none" },
        );
        if (!valid()) {
          bitmap.close();
          return false;
        }
        if (
          bitmap.width > LIMITS.imageSide ||
          bitmap.height > LIMITS.imageSide
        ) {
          bitmap.close();
          throw new Error("デコード後の画像サイズが上限を超えています。");
        }
        const map = new T.Texture(bitmap);
        map.colorSpace = T.SRGBColorSpace;
        map.wrapS = map.wrapT = T.RepeatWrapping;
        map.needsUpdate = true;
        textures.push(map);
        maps.set(input.guid, map);
      }
      if (!valid()) return false;
      this.clear();
      this.data = data;
      this.textures = textures;
      const geometry = new T.BufferGeometry();
      geometry.setAttribute(
        "position",
        new T.BufferAttribute(data.mesh.positions, 3),
      );
      geometry.setAttribute(
        "normal",
        new T.BufferAttribute(data.mesh.normals, 3),
      );
      geometry.setAttribute("uv", new T.BufferAttribute(data.mesh.uvs, 2));
      for (const group of data.mesh.groups)
        geometry.addGroup(group.start, group.count, group.materialIndex);
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox!;
      const size = bounds.getSize(new T.Vector3());
      check(
        size.y > 0 && Math.max(size.x, size.y, size.z) > 0,
        "表示できる大きさのメッシュがありません。",
      );
      const center = bounds.getCenter(new T.Vector3());
      const scale = 2.5 / Math.max(size.x, size.y, size.z);
      geometry.translate(-center.x, -bounds.min.y, -center.z);
      geometry.scale(scale, scale, scale);
      const color = (rgb: [number, number, number]) =>
        new T.Color().setRGB(...rgb, T.SRGBColorSpace);
      this.materials = data.materials.map(
        (m) =>
          new T.ShaderMaterial({
            vertexShader: vertex,
            fragmentShader: fragment,
            uniforms: {
              base: { value: color(m.color) },
              shade: { value: color(m.shadow) },
              light: { value: new T.Vector3(-0.6, 1, 0.7) },
              border: { value: m.border },
              hasMap: { value: !!m.textureGuid && m.supported },
              mainMap: { value: maps.get(m.textureGuid ?? "") ?? null },
              tiling: { value: new T.Vector2(...m.scale) },
              offset: { value: new T.Vector2(...m.offset) },
            },
          }),
      );
      this.outlines = data.materials.map(
        (m) =>
          new T.ShaderMaterial({
            vertexShader: outlineVertex,
            fragmentShader: outlineFragment,
            side: T.BackSide,
            uniforms: {
              width: { value: m.outline * 0.15 },
              ink: { value: color(m.outlineColor) },
            },
          }),
      );
      this.model = new T.Group();
      const hull = new T.Mesh(geometry, this.outlines),
        body = new T.Mesh(geometry, this.materials);
      this.model.add(hull, body);
      this.scene.add(this.model);
      this.setShadow(this.shadow);
      this.setOutline(this.outline);
      this.setOutlineScale(this.outlineScale);
      this.setLight(this.angle);
      this.reset();
      return true;
    } catch (error) {
      if (valid()) this.clear();
      throw error;
    } finally {
      if (this.textures !== textures)
        for (const texture of textures) {
          (texture.image as ImageBitmap).close();
          texture.dispose();
        }
    }
  }
  clear() {
    if (this.model) {
      this.scene.remove(this.model);
      const geometry = (this.model.children[0] as T.Mesh).geometry;
      geometry.dispose();
    }
    for (const m of [...this.materials, ...this.outlines]) m.dispose();
    for (const t of this.textures) {
      (t.image as ImageBitmap).close();
      t.dispose();
    }
    this.model = undefined;
    this.materials = [];
    this.outlines = [];
    this.textures = [];
    this.data = undefined;
    this.renderer.renderLists.dispose();
  }
  reset() {
    this.camera.position.set(3.6, 2.5, 6);
    this.controls.target.set(0, 1.22, 0);
    this.controls.update();
  }
  zoom(factor: number) {
    const delta = this.camera.position
      .clone()
      .sub(this.controls.target)
      .multiplyScalar(factor);
    delta.clampLength(1.8, 12);
    this.camera.position.copy(this.controls.target).add(delta);
    this.controls.update();
  }
  rotate(angle: number) {
    const delta = this.camera.position
      .clone()
      .sub(this.controls.target)
      .applyAxisAngle(new T.Vector3(0, 1, 0), angle);
    this.camera.position.copy(this.controls.target).add(delta);
    this.controls.update();
  }
  setShadow(value: boolean) {
    this.shadow = value;
    this.materials.forEach((m, i) => {
      m.uniforms.border.value =
        value && this.data?.materials[i].supported
          ? this.data.materials[i].border
          : -1;
    });
  }
  setOutline(value: boolean) {
    this.outline = value;
    this.setOutlineScale(this.outlineScale);
  }
  setOutlineScale(value: number) {
    this.outlineScale = value;
    this.outlines.forEach((m, i) => {
      m.uniforms.width.value = this.outline
        ? (this.data?.materials[i].outline ?? 0) * 0.15 * value
        : 0;
    });
  }
  setLight(degrees: number) {
    this.angle = degrees;
    const a = (degrees * Math.PI) / 180;
    this.materials.forEach((m) =>
      m.uniforms.light.value.set(Math.sin(a) * 1.5, 1.5, Math.cos(a)),
    );
  }
  setColor(hex: string) {
    if (this.materials[0]) this.materials[0].uniforms.base.value.set(hex);
  }
  dispose() {
    this.clear();
    this.resize.disconnect();
    this.controls.dispose();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}
