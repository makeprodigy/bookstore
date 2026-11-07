import { spawn } from "node:child_process";
import fs from "node:fs";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ARTIFACT_DIR = "/Users/pushpendraaa/.gemini/antigravity/brain/44df1e21-a596-43c3-82b7-28a34e8bf613";

async function main() {
  const chrome = spawn(CHROME_PATH, [
    "--headless=new",
    "--remote-debugging-port=9222",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
  ]);

  let listRes;
  for (let i = 0; i < 20; i++) {
    try {
      listRes = await fetch("http://127.0.0.1:9222/json/new?http://localhost:3000/preview", { method: "PUT" });
      if (listRes.ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!listRes) throw new Error("Could not connect to Chrome CDP");

  const pageTarget = await listRes.json();
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  let idCounter = 1;
  const pending = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  await new Promise((r) => (ws.onopen = r));

  await send("Page.enable");
  await send("Runtime.enable");

  // Wait for canvas / page ready
  for (let i = 0; i < 40; i++) {
    const evalRes = await send("Runtime.evaluate", {
      expression: `Boolean(document.querySelector("canvas") || document.querySelector(".react-pdf__Page"))`,
    });
    if (evalRes.result?.value) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1000));

  // --- 1. Desktop 1440x900: Test Fullscreen & Auto-Hide ---
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 500));

  // Click fullscreen toggle button
  const fsBtn = await send("Runtime.evaluate", {
    expression: `
      const btn = document.querySelector('button[aria-label="Enter fullscreen"]');
      if (btn) { btn.click(); true; } else { false; }
    `,
  });
  console.log("Clicked Fullscreen button:", fsBtn.result?.value);
  await new Promise((r) => setTimeout(r, 400));

  // Screenshot 1: Desktop in Fullscreen with bars visible (overlay mode)
  let shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase4-desktop-fullscreen-bars-visible.png`, Buffer.from(shot.data, "base64"));
  console.log("Saved phase4-desktop-fullscreen-bars-visible.png");

  // Wait 2.7s for idle timer to auto-hide chrome
  console.log("Waiting 2.7s for auto-hide idle timer...");
  await new Promise((r) => setTimeout(r, 2700));

  // Check if header has -translate-y-full
  const isHidden = await send("Runtime.evaluate", {
    expression: `document.querySelector('header')?.classList.contains('-translate-y-full')`,
  });
  console.log("Is header auto-hidden after 2.5s idle:", isHidden.result?.value);

  // Screenshot 2: Desktop in Fullscreen with bars hidden (immersive pure reading)
  shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase4-desktop-fullscreen-immersive-hidden.png`, Buffer.from(shot.data, "base64"));
  console.log("Saved phase4-desktop-fullscreen-immersive-hidden.png");

  // Mouse move brings bars back
  await send("Runtime.evaluate", {
    expression: `window.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 500 }))`,
  });
  await new Promise((r) => setTimeout(r, 250));

  const isRestored = await send("Runtime.evaluate", {
    expression: `document.querySelector('header')?.classList.contains('translate-y-0')`,
  });
  console.log("Is header restored after mousemove:", isRestored.result?.value);

  // Test Esc key priority: open annotations drawer first, then press Esc -> closes drawer, does NOT exit fullscreen yet
  await send("Runtime.evaluate", {
    expression: `document.querySelector('button[aria-label^="Annotations"]')?.click()`,
  });
  await new Promise((r) => setTimeout(r, 300));
  await send("Input.dispatchKeyEvent", { type: "keyDown", code: "Escape", key: "Escape" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code: "Escape", key: "Escape" });
  await new Promise((r) => setTimeout(r, 300));

  const drawerClosed = await send("Runtime.evaluate", {
    expression: `document.querySelector('aside')?.classList.contains('translate-x-full')`,
  });
  console.log("Did Esc close drawer first:", drawerClosed.result?.value);

  // Press Esc again -> exits fullscreen
  await send("Input.dispatchKeyEvent", { type: "keyDown", code: "Escape", key: "Escape" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code: "Escape", key: "Escape" });
  await new Promise((r) => setTimeout(r, 300));

  // --- 2. Tablet 820x1180: Pseudo-fullscreen with PWA hint ---
  await send("Emulation.setDeviceMetricsOverride", {
    width: 820,
    height: 1180,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 500));

  // Trigger fullscreen (fallback on simulated mobile Safari)
  await send("Runtime.evaluate", {
    expression: `
      // Simulate pseudo-fullscreen with hint
      const btn = document.querySelector('button[aria-label="Enter fullscreen"]');
      btn?.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 400));

  shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase4-tablet-fullscreen.png`, Buffer.from(shot.data, "base64"));
  console.log("Saved phase4-tablet-fullscreen.png");

  // --- 3. Phone 390x844: Fullscreen Reading ---
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 500));

  // In phone, tap center 50% toggles chrome
  await send("Runtime.evaluate", {
    expression: `
      (() => {
        const wrapper = document.querySelector('.react-pdf__Page') || document.querySelector('main');
        const downEvent = new TouchEvent('touchstart', { touches: [{ clientX: 195, clientY: 422 }], bubbles: true });
        const upEvent = new TouchEvent('touchend', { changedTouches: [{ clientX: 195, clientY: 422 }], bubbles: true });
        wrapper.dispatchEvent(downEvent);
        wrapper.dispatchEvent(upEvent);
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 400));

  shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase4-phone-fullscreen.png`, Buffer.from(shot.data, "base64"));
  console.log("Saved phase4-phone-fullscreen.png");

  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
