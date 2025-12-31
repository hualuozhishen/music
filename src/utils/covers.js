/**
 * 统一管理音乐封面文件名与路径
 * 如需新增 / 调整封面，只需修改此文件
 */

// 封面文件名列表（位于 public/covers 下）
export const COVER_FILES = [
  'a.webp',
  'b.webp',
  'c.webp',
  'd.webp',
  'e.webp',
  'f.webp',
  'g.webp',
  'h.webp',
  'i.webp',
  'j.webp',
  'k.webp',
  'l.webp',
  'm.webp',
  'n.webp',
  'o.webp',
  'p.webp',
  'q.webp',
  'r.webp',
  's.webp',
  't.webp',
  'u.webp',
  'v.webp',
  'w.webp',
  'x.webp',
  'y.webp',
  'z.webp',
];

/**
 * 根据索引获取封面完整 URL（自动取模循环）
 * @param {number} index
 * @returns {string}
 */
export function getCoverUrlByIndex(index) {
  if (!COVER_FILES.length) return '';
  const safeIndex = (((index || 0) % COVER_FILES.length) + COVER_FILES.length) % COVER_FILES.length;
  const fileName = COVER_FILES[safeIndex];
  return `/covers/${fileName}`;
}

/**
 * 获取所有封面的完整 URL 列表
 * @returns {string[]}
 */
export function getAllCoverUrls() {
  return COVER_FILES.map((name) => `/covers/${name}`);
}
