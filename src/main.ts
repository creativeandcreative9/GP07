import "./style.css";
import { Viewer } from "./viewer";
import { LIMITS } from "./core/types";
import type { SceneData } from "./core/types";

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
let viewer: Viewer | undefined;
let viewerError: string | undefined;
try {
  viewer = new Viewer(el("viewport"));
} catch {
  viewerError =
    "WebGL 2 を初期化できませんでした。対応ブラウザと GPU 設定をご確認ください。";
}
let worker: Worker | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let request = 0;
let fetchController: AbortController | undefined;
const controls = ["color", "shadow", "outline", "width", "light"];
const fileInput = el<HTMLInputElement>("file");

function stop() {
  worker?.terminate();
  worker = undefined;
  clearTimeout(timer);
  fetchController?.abort();
  fetchController = undefined;
}
function setStatus(message: string) {
  el("status").textContent = message;
}
function controlsEnabled(value: boolean) {
  for (const id of controls) el<HTMLInputElement>(id).disabled = !value;
}
function clear(message = "クリアしました。メモリー上の素材を解放しました。") {
  request++;
  stop();
  viewer?.clear();
  fileInput.value = "";
  el("empty").hidden = false;
  el("loading").hidden = true;
  el("error").hidden = true;
  el("model-name").textContent = "プレビュー";
  el("mesh-stats").textContent = "モデル未選択";
  el("report").replaceChildren();
  el("report").textContent = "読み込んだアセットと警告がここに表示されます。";
  el("report").className = "report-empty";
  el<HTMLButtonElement>("clear").disabled = true;
  controlsEnabled(false);
  setStatus(message);
  el("status-dot").classList.remove("ready");
}
function fail(message: string, id: number) {
  if (id !== request) return;
  request++;
  stop();
  viewer?.clear();
  controlsEnabled(false);
  el("loading").hidden = true;
  el("empty").hidden = true;
  el("error").hidden = false;
  el("error-message").textContent = message;
  setStatus("読み込み失敗。対応条件をご確認ください。");
  el("status-dot").classList.remove("ready");
}
function report(data: SceneData) {
  const target = el("report");
  target.replaceChildren();
  target.className = "report-content";
  const warn = document.createElement("div");
  warn.className = "warnings";
  for (const message of data.warnings) {
    const p = document.createElement("p");
    p.textContent = "△  " + message;
    warn.append(p);
  }
  target.append(warn);
  const refs = document.createElement("p");
  refs.className = "reference";
  refs.textContent = `Mesh fileID ${data.source.mesh.fileID} → ${data.mesh.name} · ${data.materials.length} 素材スロットを GUID で解決`;
  target.append(refs);
  const disclosure = document.createElement("details"),
    summary = document.createElement("summary");
  summary.textContent = `${data.assets.length} アセットの参照を表示`;
  disclosure.append(summary);
  for (const asset of data.assets) {
    const row = document.createElement("div");
    row.className = "asset-row";
    const name = document.createElement("span"),
      guid = document.createElement("code");
    name.textContent = asset.path;
    guid.textContent = asset.guid;
    row.append(name, guid);
    disclosure.append(row);
  }
  target.append(disclosure);
}
async function load(file: File | "demo") {
  clear("パッケージを解析しています…");
  const id = request;
  if (viewerError) return fail(viewerError, id);
  el("empty").hidden = true;
  el("loading").hidden = false;
  el<HTMLButtonElement>("clear").disabled = false;
  timer = setTimeout(
    () =>
      fail(
        "処理時間が 15 秒の上限を超えました。小さなパッケージをお試しください。",
        id,
      ),
    LIMITS.timeout,
  );
  try {
    let bytes: ArrayBuffer, name: string;
    if (file === "demo") {
      fetchController = new AbortController();
      const response = await fetch("/fixtures/orbit.unitypackage", {
        signal: fetchController.signal,
      });
      if (!response.ok) throw new Error("デモを取得できませんでした。");
      bytes = await response.arrayBuffer();
      name = "Orbit / 自作フィクスチャ";
    } else {
      if (file.size > LIMITS.input)
        throw new Error("入力が 32 MiB の上限を超えています。");
      bytes = await file.arrayBuffer();
      name = file.name;
    }
    if (id !== request) return;
    worker = new Worker(new URL("./parse.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onerror = () =>
      fail("解析 Worker が停止しました。対応形式をご確認ください。", id);
    worker.onmessage = async (
      event: MessageEvent<{ ok: boolean; scene?: SceneData; error?: string }>,
    ) => {
      if (id !== request) return;
      worker?.terminate();
      worker = undefined;
      if (!event.data.ok || !event.data.scene)
        return fail(event.data.error || "解析に失敗しました。", id);
      try {
        const scene = event.data.scene;
        const shown = await viewer!.show(scene, () => id === request);
        if (!shown || id !== request) return;
        clearTimeout(timer);
        el("loading").hidden = true;
        el("model-name").textContent = name;
        el("mesh-stats").textContent =
          `${scene.vertices.toLocaleString()} vertices · ${scene.materials.length} materials`;
        controlsEnabled(true);
        report(scene);
        const rgb = scene.materials[0].color
          .map((c) =>
            Math.round(c * 255)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("");
        el<HTMLInputElement>("color").value = "#" + rgb;
        viewer!.setShadow(el<HTMLInputElement>("shadow").checked);
        viewer!.setOutline(el<HTMLInputElement>("outline").checked);
        viewer!.setOutlineScale(Number(el<HTMLInputElement>("width").value));
        viewer!.setLight(Number(el<HTMLInputElement>("light").value));
        setStatus("読み込み完了 · 限定近似で表示中");
        el("status-dot").classList.add("ready");
      } catch (error) {
        fail(
          error instanceof Error ? error.message : "描画に失敗しました。",
          id,
        );
      }
    };
    worker.postMessage(bytes, [bytes]);
  } catch (error) {
    if (id === request)
      fail(
        error instanceof Error ? error.message : "読み込みに失敗しました。",
        id,
      );
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void load(file);
});
for (const id of ["demo", "empty-demo"])
  el(id).onclick = () => void load("demo");
el("clear").onclick = () => clear();
el("cancel").onclick = () => clear("読み込みをキャンセルしました。");
el("dismiss").onclick = () => clear("別のファイルを選択してください。");
el("reset").onclick = () => viewer?.reset();
el("zoom-in").onclick = () => viewer?.zoom(0.85);
el("zoom-out").onclick = () => viewer?.zoom(1.15);
el("rotate-left").onclick = () => viewer?.rotate(-0.25);
el("rotate-right").onclick = () => viewer?.rotate(0.25);
el("color").oninput = () =>
  viewer?.setColor(el<HTMLInputElement>("color").value);
el("shadow").onchange = () =>
  viewer?.setShadow(el<HTMLInputElement>("shadow").checked);
el("outline").onchange = () =>
  viewer?.setOutline(el<HTMLInputElement>("outline").checked);
el("width").oninput = () =>
  viewer?.setOutlineScale(Number(el<HTMLInputElement>("width").value));
el("light").oninput = () =>
  viewer?.setLight(Number(el<HTMLInputElement>("light").value));
const drop = el("dropzone");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("dragging");
});
drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("dragging");
  const files = e.dataTransfer?.files;
  if (files?.length === 1) void load(files[0]);
  else if (files?.length) {
    clear();
    fail("単一の unitypackage を選択してください。", request);
  }
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());
window.addEventListener("beforeunload", () => {
  stop();
  viewer?.dispose();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el("loading").hidden)
    clear("読み込みをキャンセルしました。");
});
// Keep model data out of storage, analytics, and logs.
