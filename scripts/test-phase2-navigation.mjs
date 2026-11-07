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
  await send("Input.enable").catch(() => {});

  // Wait for canvas / page ready
  for (let i = 0; i < 40; i++) {
    const evalRes = await send("Runtime.evaluate", {
      expression: `Boolean(document.querySelector("canvas") || document.querySelector(".react-pdf__Page"))`,
    });
    if (evalRes.result?.value) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1000));

  // --- Test 1: Desktop Keyboard Navigation ---
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 400));

  // Press Space to advance to Page 2
  await send("Input.dispatchKeyEvent", { type: "keyDown", code: "Space", key: " " });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code: "Space", key: " " });
  await new Promise((r) => setTimeout(r, 600));

  let pageVal = await send("Runtime.evaluate", {
    expression: `document.getElementById('reader-page-input')?.value`,
  });
  console.log("After Space key, current page is:", pageVal.result?.value);

  // Capture screenshot on Page 2 via keyboard
  let shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase2-desktop-page2-keyboard.png`, Buffer.from(shot.data, "base64"));
  console.log("Saved phase2-desktop-page2-keyboard.png");

  // Press Home key to go back to Page 1
  await send("Input.dispatchKeyEvent", { type: "keyDown", code: "Home", key: "Home" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code: "Home", key: "Home" });
  await new Promise((r) => setTimeout(r, 400));

  pageVal = await send("Runtime.evaluate", {
    expression: `document.getElementById('reader-page-input')?.value`,
  });
  console.log("After Home key, current page is:", pageVal.result?.value);

  // Press 'g' key to focus page input
  await send("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyG", key: "g" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyG", key: "g" });
  await new Promise((r) => setTimeout(r, 300));
  const isInputFocused = await send("Runtime.evaluate", {
    expression: `document.activeElement?.id === 'reader-page-input'`,
  });
  console.log("Is page input focused after 'g' key:", isInputFocused.result?.value);

  // Blur page input
  await send("Runtime.evaluate", {
    expression: `document.activeElement?.blur()`,
  });
  await new Promise((r) => setTimeout(r, 200));

  // --- Test 2: Tablet Touch Tap Navigation (820x1180) ---
  await send("Emulation.setDeviceMetricsOverride", {
    width: 820,
    height: 1180,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 500));

  // Ensure selection is clear
  await send("Runtime.evaluate", {
    expression: `window.getSelection()?.removeAllRanges();`,
  });
  await new Promise((r) => setTimeout(r, 200));

  // Tap right 25% of page (x = 700, y = 500)
  await send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 700, y: 500 }],
  });
  await new Promise((r) => setTimeout(r, 50));
  await send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await new Promise((r) => setTimeout(r, 600));

  pageVal = await send("Runtime.evaluate", {
    expression: `document.getElementById('reader-page-input')?.value`,
  });
  console.log("After Touch Tap Right 25%, current page is:", pageVal.result?.value);

  shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase2-tablet-page2-touch.png`, Buffer.from(shot.data, "base64"));
  console.log("Saved phase2-tablet-page2-touch.png");

  // Tap left 25% of page (x = 120, y = 500)
  await send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 120, y: 500 }],
  });
  await new Promise((r) => setTimeout(r, 50));
  await send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await new Promise((r) => setTimeout(r, 600));

  pageVal = await send("Runtime.evaluate", {
    expression: `document.getElementById('reader-page-input')?.value`,
  });
  console.log("After Touch Tap Left 25%, current page is:", pageVal.result?.value);

  // --- Test 3: Phone Swipe Gesture (390x844) ---
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 500));

  // Swipe left: x = 280 -> 140 (next page)
  await send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 280, y: 400 }],
  });
  await new Promise((r) => setTimeout(r, 50));
  await send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 140, y: 405 }],
  });
  await new Promise((r) => setTimeout(r, 50));
  await send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await new Promise((r) => setTimeout(r, 600));

  pageVal = await send("Runtime.evaluate", {
    expression: `document.getElementById('reader-page-input')?.value`,
  });
  console.log("After Phone Swipe Left, current page is:", pageVal.result?.value);

  shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase2-phone-page2-swipe.png`, Buffer.from(shot.data, "base64"));
  console.log("Saved phase2-phone-page2-swipe.png");

  // Verify adjacent page prefetch elements exist in DOM
  const prefetchCount = await send("Runtime.evaluate", {
    expression: `document.querySelectorAll('.sr-only .react-pdf__Page').length`,
  });
  console.log("Adjacent prefetch pages in DOM:", prefetchCount.result?.value);

  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
