import { expect, test } from "@playwright/test";
import {
  fixture,
  fixtureEntries,
  binaryFixture,
  binaryMesh,
  hierarchyFixture,
  hierarchyNodes,
  GUID,
  tar,
} from "../../scripts/generate-fixture.mjs";
import { gzipSync } from "node:zlib";
import { writeFile } from "node:fs/promises";

const upload = (buffer = fixture(), name = "orbit.unitypackage") => ({
  name,
  mimeType: "application/octet-stream",
  buffer: Buffer.from(buffer),
});

test("demo renders, controls change the pixels, reset/clear/reload work", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto("/");
  await expect(page.getByText("最初のキャラクターを迎えよう。")).toBeVisible();
  await page.getByRole("button", { name: "デモを体験する" }).click();
  await expect(page.getByRole("status")).toContainText("読み込み完了");
  await expect(page.locator("#report")).toContainText(
    "Mesh fileID 4300000 → Orbit",
  );
  await expect(page.locator("#mesh-stats")).toContainText(
    "4 materials · 3 parts",
  );
  await expect(page.locator("#report")).toContainText(
    "OrbitRig/Accessories/RightBeacon",
  );
  const canvas = page.locator("canvas");
  await page.waitForTimeout(400);
  const original = await canvas.screenshot();
  await canvas.screenshot({ path: "docs/evidence/toon-default.png" });
  await page.locator("#shadow").uncheck();
  await page.waitForTimeout(100);
  expect((await canvas.screenshot()).equals(original)).toBe(false);
  await canvas.screenshot({ path: "docs/evidence/toon-no-shadow.png" });
  await page.locator("#shadow").check();
  await page.locator("#outline").uncheck();
  await page.waitForTimeout(100);
  expect((await canvas.screenshot()).equals(original)).toBe(false);
  await canvas.screenshot({ path: "docs/evidence/toon-no-outline.png" });
  await page.locator("#outline").check();
  await page.locator("#color").fill("#ff9955");
  await page.waitForTimeout(100);
  expect((await canvas.screenshot()).equals(original)).toBe(false);
  await canvas.screenshot({ path: "docs/evidence/toon-orange.png" });
  await page.locator("#color").fill("#a382db");
  await page.waitForTimeout(100);
  const beforeCamera = await canvas.screenshot();
  await page.getByRole("button", { name: "左に回転", exact: true }).click();
  await page.getByRole("button", { name: "拡大", exact: true }).click();
  await page.waitForTimeout(300);
  expect((await canvas.screenshot()).equals(original)).toBe(false);
  await page.getByRole("button", { name: "カメラをリセット" }).click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  expect((await canvas.screenshot()).equals(beforeCamera)).toBe(true);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 80,
    box!.y + box!.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.mouse.wheel(0, -150);
  await page.waitForTimeout(500);
  expect((await canvas.screenshot()).equals(beforeCamera)).toBe(false);
  await page.getByRole("button", { name: "カメラをリセット" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({
    path: "docs/evidence/orbit-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "クリア", exact: true }).click();
  await expect(page.locator("#empty")).toBeVisible();
  await expect(page.locator("#color")).toBeDisabled();
  await page.getByRole("button", { name: "Orbit を読み込む" }).click();
  await expect(page.getByRole("status")).toContainText("読み込み完了");
  expect(errors).toEqual([]);
});

test("local upload uses only in-memory assets and does not send material data", async ({
  page,
}) => {
  await page.goto("/");
  // Warm the worker module before recording runtime input processing.
  await page.getByRole("button", { name: "デモを体験する" }).click();
  await expect(page.getByRole("status")).toContainText("読み込み完了");
  await page.getByRole("button", { name: "クリア", exact: true }).click();
  const requests: { method: string; url: string; body: string | null }[] = [];
  page.on("request", (r) =>
    requests.push({ method: r.method(), url: r.url(), body: r.postData() }),
  );
  await page.locator("#file").setInputFiles(upload());
  await expect(page.getByRole("status")).toContainText("読み込み完了");
  expect(
    requests.every(
      (r) =>
        r.method === "GET" &&
        r.body === null &&
        r.url.startsWith("http://127.0.0.1:4173/assets/"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  await page.locator("#report summary").click();
  await expect(page.locator("#report")).toContainText(GUID.mesh);
  await writeFile(
    "docs/evidence/local-import-network.json",
    JSON.stringify(
      {
        fixture: "original Orbit fixture (no private material)",
        phase: "local upload after application/worker modules were loaded",
        requests,
        storage: { localStorage: 0, sessionStorage: 0 },
        note: "Observed in this Chromium run only; no material request body or external destination was observed.",
      },
      null,
      2,
    ) + "\n",
  );
});

test("corrupt and unsupported packages show errors and recover on the same file selection", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("#file")
    .setInputFiles(
      upload(new Uint8Array([1, 2, 3]), "<img onerror=alert(1)>.unitypackage"),
    );
  await expect(page.getByRole("alert")).toContainText("gzip");
  await page.locator("#file").setInputFiles(upload());
  await expect(page.getByRole("status")).toContainText("読み込み完了");
  const bad = gzipSync(
    tar(
      fixtureEntries().map(([name, data]) => [
        name,
        name === `${GUID.prefab}/asset`
          ? String(data).replace(GUID.mesh, "ffffffffffffffffffffffffffffffff")
          : data,
      ]),
    ),
  );
  await page.locator("#file").setInputFiles(upload(bad));
  await expect(page.getByRole("alert")).toContainText("参照先");
  await expect(page.locator("#color")).toBeDisabled();
  await page.locator("#file").setInputFiles(upload());
  await expect(page.getByRole("status")).toContainText("読み込み完了");
});

test("cancel and newer selections invalidate old asynchronous results", async ({
  page,
}) => {
  await page.goto("/");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/fixtures/orbit*.unitypackage", async (route) => {
    await pending;
    await route.fulfill({ body: Buffer.from(fixture()) }).catch(() => {});
  });
  await page.getByRole("button", { name: "デモを体験する" }).click();
  await expect(page.locator("#loading")).toBeVisible();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(page.locator("#empty")).toBeVisible();
  await page
    .locator("#file")
    .setInputFiles(upload(fixture(), "newest.unitypackage"));
  await expect(page.getByRole("status")).toContainText("読み込み完了");
  release();
  await page.waitForTimeout(200);
  await expect(page.locator("#model-name")).toHaveText("newest.unitypackage");
});

test("15 second processing deadline is visible and cancellable", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await page.route("**/fixtures/orbit*.unitypackage", (route) =>
    route.abort("timedout"),
  );
  // Delay fetch in the browser so the deadline, not a network error, wins.
  await page.evaluate(() => {
    window.fetch = () => new Promise(() => {});
  });
  await page.getByRole("button", { name: "デモを体験する" }).click();
  await page.clock.fastForward(15_001);
  await expect(page.getByRole("alert")).toContainText("15 秒");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(page.locator("#empty")).toBeVisible();
});

test("compressed binary FBX matches the ASCII render and malformed binary can recover", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("#file").setInputFiles(upload());
  await expect(page.getByRole("status")).toContainText("読み込み完了");
  await expect(page.locator("#report")).toContainText("ASCII FBX 7.4");
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const ascii = await page.locator("canvas").screenshot();
  const requests: string[] = [];
  page.on("request", (r) =>
    requests.push(`${r.method()} ${r.url()} ${r.postData() ?? ""}`),
  );
  await page
    .locator("#file")
    .setInputFiles(upload(binaryFixture(), "binary.unitypackage"));
  await expect(page.getByRole("status")).toContainText("読み込み完了");
  await expect(page.locator("#report")).toContainText("Binary FBX 7.4");
  await page.waitForTimeout(300);
  expect((await page.locator("canvas").screenshot()).equals(ascii)).toBe(true);
  await page.screenshot({
    path: "docs/evidence/orbit-binary.png",
    fullPage: true,
  });
  expect(
    requests.every((r) => r.startsWith("GET http://127.0.0.1:4173/assets/")),
  ).toBe(true);
  const broken = new Uint8Array(binaryMesh());
  new DataView(broken.buffer).setUint32(27, 0xffffffff, true);
  await page
    .locator("#file")
    .setInputFiles(upload(gzipSync(tar(fixtureEntries(broken)))));
  await expect(page.getByRole("alert")).toContainText("境界");
  await page.locator("#file").setInputFiles(upload(binaryFixture(false)));
  await expect(page.getByRole("status")).toContainText("読み込み完了");
  expect(errors).toEqual([]);
});

test("mobile layout fits the viewport and can load a model", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Orbit を読み込む" }).click();
  await expect(page.getByRole("status")).toContainText("読み込み完了");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({
    path: "docs/evidence/orbit-mobile.png",
    fullPage: true,
  });
});

test("hierarchical parts move, hide, render names safely and recover from broken links", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .locator("#file")
    .setInputFiles(upload(hierarchyFixture(), "parts.unitypackage"));
  await expect(page.getByRole("status")).toContainText("読み込み完了");
  await expect(page.locator("#mesh-stats")).toContainText(
    "9,468 vertices · 4 materials · 3 parts",
  );
  await expect(page.locator("#report")).toContainText(
    "Mesh fileID 4300001 → Beacon",
  );
  await page.waitForTimeout(300);
  await page.mouse.move(0, 0);
  const original = await page.locator("canvas").screenshot();
  const moved = hierarchyNodes();
  moved[4].position = [1.4, 0, 0];
  await page.locator("#file").setInputFiles(upload(hierarchyFixture(moved)));
  await expect(page.getByRole("status")).toContainText("読み込み完了");
  await page.waitForTimeout(300);
  expect((await page.locator("canvas").screenshot()).equals(original)).toBe(
    false,
  );
  const hidden = hierarchyNodes();
  hidden[2].active = false;
  await page.locator("#file").setInputFiles(upload(hierarchyFixture(hidden)));
  await expect(page.getByRole("status")).toContainText("読み込み完了");
  await expect(page.locator("#mesh-stats")).toContainText(
    "9,396 vertices · 3 materials · 1 parts",
  );
  await expect(page.locator("#report")).toContainText("2 部品を非アクティブ");
  const named = hierarchyNodes();
  named[4].name = "<img src=x onerror=alert(1)>";
  await page.locator("#file").setInputFiles(upload(hierarchyFixture(named)));
  await expect(page.getByRole("status")).toContainText("読み込み完了");
  await expect(page.locator("#report")).toContainText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator("#report img")).toHaveCount(0);
  const broken = hierarchyNodes();
  broken[3].parent = 99;
  await page.locator("#file").setInputFiles(upload(hierarchyFixture(broken)));
  await expect(page.getByRole("alert")).toContainText("親子参照");
  await page.locator("#file").setInputFiles(upload(hierarchyFixture()));
  await expect(page.getByRole("status")).toContainText("読み込み完了");
  await page.screenshot({
    path: "docs/evidence/orbit-hierarchy.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
