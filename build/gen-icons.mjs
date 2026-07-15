import sharp from "/Users/barns/Ccode/thinkopen-net/node_modules/sharp/lib/index.js";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

// Root repo dir — pass as argv[2] so the same generator drives both the staff
// (minka-desktop) and client (thinkopen-support-desktop) Okvia builds.
const root = process.argv[2] || "/Users/barns/Ccode/minka-desktop";
const dockSvg = readFileSync(`${root}/build/icon-master.svg`);
const traySvg = readFileSync(`${root}/build/tray-master.svg`);

const render = (svg, n) =>
  sharp(svg, { density: Math.round((72 * n) / 1024) })
    .resize(n, n, { fit: "fill" })
    .png()
    .toBuffer();

// --- macOS iconset ---
const iconset = `${root}/build/icon.iconset`;
const set = [
  ["icon_16x16.png", 16], ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32], ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128], ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256], ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024],
];
for (const [name, n] of set) writeFileSync(`${iconset}/${name}`, await render(dockSvg, n));

// 1024 master png (referenced by electron-builder as build/icon.png)
writeFileSync(`${root}/build/icon.png`, await render(dockSvg, 1024));

// pack icns
execSync(`/usr/bin/iconutil -c icns "${iconset}" -o "${root}/build/icon.icns"`);

// --- tray template (black + alpha), both locations, 1x=22 / 2x=44 ---
for (const dir of ["assets", "build"]) {
  writeFileSync(`${root}/${dir}/trayTemplate.png`, await render(traySvg, 22));
  writeFileSync(`${root}/${dir}/trayTemplate@2x.png`, await render(traySvg, 44));
}

console.log("done: icns + iconset + icon.png + trayTemplate (assets/ + build/)");
