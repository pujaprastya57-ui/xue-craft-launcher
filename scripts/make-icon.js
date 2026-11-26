'use strict';

/* 用 Electron 将矢量图标渲染为 512x512 PNG：npx electron scripts/make-icon.js */

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const SVG = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#16241b"/>
      <stop offset="1" stop-color="#070d0a"/>
    </linearGradient>
    <linearGradient id="green" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#63f5ab"/>
      <stop offset="1" stop-color="#17a866"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.75" cy="0.15" r="0.8">
      <stop offset="0" stop-color="#3ddc84" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#3ddc84" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0H0V32" fill="none" stroke="#ffffff" stroke-opacity="0.045" stroke-width="1"/>
    </pattern>
  </defs>
  <rect x="12" y="12" width="488" height="488" rx="112" fill="url(#bg)" stroke="#2c4436" stroke-width="6"/>
  <rect x="12" y="12" width="488" height="488" rx="112" fill="url(#grid)"/>
  <rect x="12" y="12" width="488" height="488" rx="112" fill="url(#glow)"/>
  <g fill="url(#green)">
    <rect x="96" y="96" width="26" height="26" rx="6" opacity="0.9"/>
    <rect x="132" y="96" width="26" height="26" rx="6" opacity="0.45"/>
    <rect x="96" y="132" width="26" height="26" rx="6" opacity="0.45"/>
    <rect x="390" y="390" width="26" height="26" rx="6" opacity="0.9"/>
    <rect x="354" y="390" width="26" height="26" rx="6" opacity="0.45"/>
    <rect x="390" y="354" width="26" height="26" rx="6" opacity="0.45"/>
  </g>
  <text x="256" y="334" text-anchor="middle" font-family="Segoe UI, Microsoft YaHei, Arial, sans-serif" font-weight="800" font-size="196" letter-spacing="-6" fill="url(#green)">TC</text>
  <rect x="186" y="374" width="140" height="10" rx="5" fill="url(#green)" opacity="0.55"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: false },
  });
  const html = `<!DOCTYPE html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:512px;height:512px}
  </style></head><body>${SVG}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 800));
  const image = await win.webContents.capturePage();
  const outDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'icon.png');
  fs.writeFileSync(outFile, image.toPNG());
  console.log('icon written:', outFile, image.getSize());
  app.exit(0);
});
