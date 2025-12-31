import { preloadCoverImages, preloadDefaultCovers } from './image';
import { getCoverUrlByIndex } from './covers';

export const loadManifest = async () => {
  try {
    const tryServerList = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const ts = Date.now();
        const r = await fetch(`/api/music/list?t=${ts}`, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!r.ok) {
          if (r.status === 503) {
            const errorData = await r.json().catch(() => ({}));
            if (errorData.error && errorData.error.includes('proxy')) {
              console.warn('检测到代理环境，GitHub API访问被阻止:', errorData);
              return null;
            }
          }
          return null;
        }

        const ct = r.headers.get('content-type') || '';
        if (!/json/i.test(ct)) return null;
        const j = await r.json();
        if (!j || !Array.isArray(j.tracks)) return null;
        return { tracks: j.tracks };
      } catch (error) {
        if (error.name === 'AbortError' || error.message.includes('fetch')) {
          console.warn('网络请求失败，可能是代理环境导致:', error.message);
        }
        return null;
      } finally {
        clearTimeout(timer);
      }
    };

    const serverData = await tryServerList();
    let data = serverData;
    if (!data) {
      console.log('服务端列表获取失败，使用静态manifest作为备用方案');
      const ts2 = Date.now();
      const res = await fetch(`/manifest.json?t=${ts2}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`加载清单失败: ${res.status}`);
      data = await res.json();
      console.info('当前使用静态歌单，如需实时更新请检查网络连接或代理设置');
    }

    return data;
  } catch (e) {
    throw new Error(e.message || '清单加载错误');
  }
};

export const processTracks = (data) => {
  const overrideRaw = localStorage.getItem('overrideTracks');
  let override = [];
  try {
    override = JSON.parse(overrideRaw || '[]');
  } catch {}

  const baseTracks = Array.isArray(data.tracks) ? data.tracks : [];
  const extraRaw = localStorage.getItem('extraTracks');
  let extra = [];
  try {
    extra = JSON.parse(extraRaw || '[]');
  } catch {}

  const assignCovers = (list) => {
    let idx = 0;
    return (list || []).map((t) => {
      if (t && t.cover) return t;
      const assigned = { ...(t || {}) };
      assigned.cover = getCoverUrlByIndex(idx);
      idx++;
      return assigned;
    });
  };

  const applyDeletionFilter = (list) => {
    try {
      const delRaw = localStorage.getItem('deletedUrls');
      const del = Array.isArray(JSON.parse(delRaw || '[]')) ? JSON.parse(delRaw || '[]') : [];
      if (!Array.isArray(list) || !list.length || !del.length) return list;
      const present = new Set((list || []).map((it) => it?.url).filter(Boolean));
      const pruned = del.filter((u) => !present.has(u));
      if (pruned.length !== del.length) {
        localStorage.setItem('deletedUrls', JSON.stringify(pruned));
      }
      if (!pruned.length) return list;
      const prunedSet = new Set(pruned);
      return list.filter((it) => !prunedSet.has(it?.url));
    } catch {
      return list;
    }
  };

  if (Array.isArray(override) && override.length) {
    const extraRaw2 = localStorage.getItem('extraTracks');
    let extra2 = [];
    try {
      extra2 = JSON.parse(extraRaw2 || '[]');
    } catch {}
    const titleToExtra = new Map();
    for (const et of extra2) {
      if (et && et.title) titleToExtra.set(et.title, et);
    }
    const withCovers = assignCovers(override);
    const enriched = withCovers.map((t) => {
      const title = t?.title || '';
      const ext = titleToExtra.get(title);
      if (!ext) return t;
      const merged = { ...t };
      if (!merged.mvUrl && ext.mvUrl) merged.mvUrl = ext.mvUrl;
      if (!merged.cover && ext.cover) merged.cover = ext.cover;
      return merged;
    });
    return applyDeletionFilter(enriched);
  } else {
    const titleToIndex = new Map();
    const merged = [];
    let coverIdx = 0;
    const pushWithCover = (item) => {
      if (!item.cover) {
        const cover = getCoverUrlByIndex(coverIdx);
        merged.push({ ...item, cover });
        coverIdx++;
      } else {
        merged.push(item);
      }
      titleToIndex.set(item.title || '', merged.length - 1);
    };

    for (const t of baseTracks) {
      if (!t || !t.url) continue;
      const title = t.title || '';
      if (titleToIndex.has(title)) continue;
      pushWithCover(t);
    }

    for (const t of extra) {
      if (!t || !t.url) continue;
      const title = t.title || '';
      if (!titleToIndex.has(title)) {
        pushWithCover(t);
      } else {
        const idx = titleToIndex.get(title);
        const prev = merged[idx] || {};
        const enriched = { ...prev };
        if (!enriched.mvUrl && t.mvUrl) enriched.mvUrl = t.mvUrl;
        if (!enriched.cover && t.cover) enriched.cover = t.cover;
        merged[idx] = enriched;
      }
    }

    const patchedExtra = [];
    let extraCoverIdx = 0;
    for (const et of extra) {
      if (!et || !et.url) continue;
      if (!et.cover) {
        patchedExtra.push({
          ...et,
          cover: getCoverUrlByIndex(extraCoverIdx),
        });
        extraCoverIdx++;
      } else {
        patchedExtra.push(et);
      }
    }
    if (patchedExtra.length === extra.length) {
      localStorage.setItem('extraTracks', JSON.stringify(patchedExtra));
    }

    return applyDeletionFilter(merged);
  }
};

export const preloadAssets = async (tracks) => {
  try {
    await preloadCoverImages(tracks);
    await preloadDefaultCovers();
  } catch (error) {
    console.warn('资源预加载失败:', error);
  }
};
