import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const iconsDir = path.join(root, "public", "icons");
const assetsMaster = path.join(root, "assets-src", "icon-master.png");
const masterPath = fs.existsSync(assetsMaster) ? assetsMaster : path.join(iconsDir, "icon-master.png");

if (!fs.existsSync(masterPath)) {
  console.error("Missing icon-master.png at", masterPath);
  process.exit(1);
}

const targets = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
  ["favicon.png", 64],
];

for (const [name, size] of targets) {
  await sharp(masterPath)
    .resize(size, size, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toFile(path.join(iconsDir, name));
  console.log("Generated", name, `${size}x${size}`);
}
