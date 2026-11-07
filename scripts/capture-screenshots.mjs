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

  // Wait for canvas / pdf
  for (let i = 0; i < 40; i++) {
    const evalRes = await send("Runtime.evaluate", {
      expression: `Boolean(document.querySelector("canvas") || document.querySelector(".react-pdf__Page"))`,
    });
    if (evalRes.result?.value) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1000));

  // 1. Desktop 1440x900
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 500));
  let shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase3-desktop-1440x900.png`, Buffer.from(shot.data, "base64"));
  console.log("Captured phase3-desktop-1440x900.png");

  // 2. Tablet 820x1180
  await send("Emulation.setDeviceMetricsOverride", {
    width: 820,
    height: 1180,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 500));
  shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase3-tablet-820x1180.png`, Buffer.from(shot.data, "base64"));
  console.log("Captured phase3-tablet-820x1180.png");

  // 3. Phone 390x844 with bottom sheet More menu
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 500));
  shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase3-phone-390x844.png`, Buffer.from(shot.data, "base64"));
  console.log("Captured phase3-phone-390x844.png");

  // 4. Phone More menu bottom sheet
  await send("Runtime.evaluate", {
    expression: `document.querySelector('button[aria-label="More options"]')?.click()`,
  });
  await new Promise((r) => setTimeout(r, 400));
  shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase3-phone-bottom-sheet.png`, Buffer.from(shot.data, "base64"));
  console.log("Captured phase3-phone-bottom-sheet.png");

  // Close bottom sheet
  await send("Runtime.evaluate", {
    expression: `document.querySelector('.fixed.inset-0.z-40')?.click()`,
  });
  await new Promise((r) => setTimeout(r, 300));

  // 5. Desktop selection popover with swatches
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 500));

  // Select text on page using DOM Selection API to trigger floating popover
  await send("Runtime.evaluate", {
    expression: `
      (() => {
        const textLayer = document.querySelector('.react-pdf__Page__textContent') || document.querySelector('.react-pdf__Page');
        if (textLayer) {
          const range = document.createRange();
          range.selectNodeContents(textLayer);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
        }
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 600));
  shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase3-floating-popover.png`, Buffer.from(shot.data, "base64"));
  console.log("Captured phase3-floating-popover.png");

  // 6. Click Highlight to trigger toast with feedback
  await send("Runtime.evaluate", {
    expression: `
      const hlBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Highlight'));
      hlBtn?.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 400));
  shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase3-highlight-toast.png`, Buffer.from(shot.data, "base64"));
  console.log("Captured phase3-highlight-toast.png");

  // 7. Mark Read Till to trigger Toast with Undo
  await send("Runtime.evaluate", {
    expression: `
      const moreBtn = document.querySelector('button[aria-label="More options"]');
      moreBtn?.click();
      setTimeout(() => {
        const markBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Mark read till here'));
        markBtn?.click();
      }, 200);
    `,
  });
  await new Promise((r) => setTimeout(r, 800));
  shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase3-read-till-undo-toast.png`, Buffer.from(shot.data, "base64"));
  console.log("Captured phase3-read-till-undo-toast.png");

  // 8. Open Annotations Drawer showing Highlights tab
  await send("Runtime.evaluate", {
    expression: `
      document.querySelector('button[aria-label^="Annotations"]')?.click();
      setTimeout(() => {
        const hlTab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Highlights'));
        hlTab?.click();
      }, 200);
    `,
  });
  await new Promise((r) => setTimeout(r, 600));
  shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/phase3-drawer-highlights.png`, Buffer.from(shot.data, "base64"));
  console.log("Captured phase3-drawer-highlights.png");

  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
