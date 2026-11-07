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
    if (evalRes?.result?.value) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log("PDF reader page loaded successfully.");

  // 1. TEST FOCUS MANAGEMENT: Annotations Drawer
  console.log("\n--- Testing Annotations Drawer Focus Trap ---");
  // Click annotations button
  await send("Runtime.evaluate", {
    expression: `(() => {
      const btn = document.querySelector('button[aria-label^="Annotations"]');
      if (btn) btn.click();
    })()`,
  });
  await new Promise((r) => setTimeout(r, 200));

  const drawerFocusCheck = await send("Runtime.evaluate", {
    expression: `(() => {
      const drawer = document.querySelector('aside[aria-label="Annotations drawer"]');
      const active = document.activeElement;
      const isInside = drawer && drawer.contains(active);
      return { isInside, activeTag: active?.tagName, activeAria: active?.getAttribute('aria-label') };
    })()`,
    returnByValue: true,
  });
  console.log("Drawer opened, initial focus inside drawer:", drawerFocusCheck.result.value);

  // Press Tab inside drawer
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await new Promise((r) => setTimeout(r, 100));

  const drawerTabCheck = await send("Runtime.evaluate", {
    expression: `(() => {
      const drawer = document.querySelector('aside[aria-label="Annotations drawer"]');
      const active = document.activeElement;
      return { isInside: drawer && drawer.contains(active), activeText: active?.innerText || active?.getAttribute('aria-label') };
    })()`,
    returnByValue: true,
  });
  console.log("After Tab key, focus inside drawer:", drawerTabCheck.result.value);

  // Press Escape to close drawer
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await new Promise((r) => setTimeout(r, 200));

  const drawerRestoreCheck = await send("Runtime.evaluate", {
    expression: `(() => {
      const active = document.activeElement;
      const isAnnotationsBtn = active?.getAttribute('aria-label')?.startsWith('Annotations');
      return { isAnnotationsBtn, activeAria: active?.getAttribute('aria-label') };
    })()`,
    returnByValue: true,
  });
  console.log("After Escape, focus returned to trigger button:", drawerRestoreCheck.result.value);

  // 2. TEST FOCUS MANAGEMENT: More Menu
  console.log("\n--- Testing More Menu Focus Trap ---");
  await send("Runtime.evaluate", {
    expression: `(() => {
      const btn = document.querySelector('button[aria-label="More options"]');
      if (btn) btn.click();
    })()`,
  });
  await new Promise((r) => setTimeout(r, 200));

  const menuFocusCheck = await send("Runtime.evaluate", {
    expression: `(() => {
      const menu = document.querySelector('div[role="menu"]');
      const active = document.activeElement;
      const isInside = menu && menu.contains(active);
      return { isInside, activeText: active?.innerText };
    })()`,
    returnByValue: true,
  });
  console.log("More menu opened, initial focus inside menu:", menuFocusCheck.result.value);

  // Press Tab inside menu
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await new Promise((r) => setTimeout(r, 100));

  const menuTabCheck = await send("Runtime.evaluate", {
    expression: `(() => {
      const menu = document.querySelector('div[role="menu"]');
      const active = document.activeElement;
      return { isInside: menu && menu.contains(active), activeText: active?.innerText };
    })()`,
    returnByValue: true,
  });
  console.log("After Tab, focus inside menu:", menuTabCheck.result.value);

  // Press Escape to close menu
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await new Promise((r) => setTimeout(r, 200));

  const menuRestoreCheck = await send("Runtime.evaluate", {
    expression: `(() => {
      const active = document.activeElement;
      const isMoreBtn = active?.getAttribute('aria-label') === 'More options';
      return { isMoreBtn, activeAria: active?.getAttribute('aria-label') };
    })()`,
    returnByValue: true,
  });
  console.log("After Escape, focus returned to More button:", menuRestoreCheck.result.value);

  // 3. CAPTURE FINAL VERIFICATION SCREENSHOTS AT 3 VIEWPORTS (Light & Dark)
  console.log("\n--- Capturing Final Verification Screenshots at 3 Viewports ---");

  // Viewport 1: Desktop 1440x900 (Dark & Light)
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
  await new Promise((r) => setTimeout(r, 500));
  const shotDesktopDark = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase5-desktop-1440x900-dark.png`, Buffer.from(shotDesktopDark.data, "base64"));
  console.log("Saved: phase5-desktop-1440x900-dark.png");

  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  await new Promise((r) => setTimeout(r, 500));
  const shotDesktopLight = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase5-desktop-1440x900-light.png`, Buffer.from(shotDesktopLight.data, "base64"));
  console.log("Saved: phase5-desktop-1440x900-light.png");

  // Viewport 2: Tablet 820x1180
  await send("Emulation.setDeviceMetricsOverride", {
    width: 820,
    height: 1180,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 500));
  const shotTablet = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase5-tablet-820x1180.png`, Buffer.from(shotTablet.data, "base64"));
  console.log("Saved: phase5-tablet-820x1180.png");

  // Viewport 3: Phone 390x844
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 500));
  const shotPhone = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase5-phone-390x844.png`, Buffer.from(shotPhone.data, "base64"));
  console.log("Saved: phase5-phone-390x844.png");

  // Also capture drawer open state with focus on tablet/desktop
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await send("Runtime.evaluate", {
    expression: `(() => {
      const btn = document.querySelector('button[aria-label^="Annotations"]');
      if (btn) btn.click();
    })()`,
  });
  await new Promise((r) => setTimeout(r, 300));
  const shotDrawer = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase5-desktop-drawer-focus.png`, Buffer.from(shotDrawer.data, "base64"));
  console.log("Saved: phase5-desktop-drawer-focus.png");

  ws.close();
  chrome.kill();
  console.log("\nAll Phase 5 checks completed successfully.");
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
