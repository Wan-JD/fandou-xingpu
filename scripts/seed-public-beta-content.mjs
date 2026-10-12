import { deflateSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const accessFile = path.join(root, "backups", "public-beta-access.json");
if (!existsSync(accessFile)) throw new Error("Run pnpm db:seed:public-beta first; the ignored local credential file is missing.");
const access = JSON.parse(readFileSync(accessFile, "utf8"));
const account = access.accounts?.find((item) => item.personId === "public-beta-2024-01");
if (!account?.email || !account?.password) throw new Error("The 2024 public-beta leader credential is missing.");

const base = (process.env.API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const jsonRequest = async (pathName, init = {}) => {
  const response = await fetch(`${base}${pathName}`, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${pathName} failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload.data;
};
const login = await jsonRequest("/api/session/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: account.email, password: account.password }),
});
const headers = { Authorization: `Bearer ${login.token}` };

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function png(width, height, seed) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const stride = width * 4 + 1;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      pixels[offset] = (25 + seed * 17 + x * 120 / width) % 256;
      pixels[offset + 1] = (75 + seed * 29 + y * 130 / height) % 256;
      pixels[offset + 2] = (145 + seed * 11 + (x + y) * 70 / (width + height)) % 256;
      pixels[offset + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(pixels, { level: 6 })), chunk("IEND"),
  ]);
}

async function createPost({ title, kind, content, dimensions }) {
  const form = new FormData();
  form.append("kind", kind);
  form.append("title", title);
  form.append("content", content);
  form.append("visibility", "public");
  dimensions.forEach(([width, height], index) => {
    form.append("images", new Blob([png(width, height, index + 1)], { type: "image/png" }), `public-beta-${width}x${height}-${String(index + 1).padStart(2, "0")}.png`);
  });
  const response = await fetch(`${base}/api/me/posts`, { method: "POST", headers, body: form });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`post seed failed (${response.status}): ${JSON.stringify(payload)}`);
  if (payload.data.images.length !== dimensions.length) throw new Error(`Expected ${dimensions.length} images, received ${payload.data.images.length}.`);
}

const posts = await jsonRequest(`/api/people/${encodeURIComponent(account.personId)}/posts`, { headers });
const byTitle = new Map(posts.map((post) => [post.title, post]));
const noteTitle = "【公测】横图、竖图与长图";
const experienceTitle = "【公测】24 图经验分享";
if (!byTitle.has(noteTitle)) {
  await createPost({
    title: noteTitle, kind: "note",
    content: "三种比例的配图，用于验证动态图片完整展示、留白与响应式高度。",
    dimensions: [[960, 540], [540, 960], [360, 1400]],
  });
} else if (byTitle.get(noteTitle).images.length !== 3) throw new Error("Existing public-beta ratio post is incomplete; inspect it before retrying.");

if (!byTitle.has(experienceTitle)) {
  await createPost({
    title: experienceTitle, kind: "experience",
    content: "# 24 图公测记录\n\n用于验证经验分享的 Markdown 和大图集布局。\n\n## 检查项\n\n- 图片完整显示\n- 移动端不重叠\n- 图集数量正确\n- 正文标题与列表正常解析",
    dimensions: Array.from({ length: 24 }, (_, index) => index % 3 === 0 ? [640, 360] : index % 3 === 1 ? [480, 640] : [520, 520]),
  });
} else if (byTitle.get(experienceTitle).images.length !== 24) throw new Error("Existing public-beta experience post is incomplete; inspect it before retrying.");

console.log("Public-beta post content is ready: 3 ratio images and one 24-image experience post.");
