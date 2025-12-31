class AudioCacheService {
  constructor() {
    this.cache = new Map();
    this.preloadQueue = [];
    this.maxCacheSize = 50;
    this.maxPreloadSize = 5;
    this.cacheSize = 0;
    this.isPreloading = false;
    this.preloadTimeout = null;
    this.preloadStartTime = 0;
    this.preloadCount = 0;
    // 与 Service Worker 使用相同的缓存名称（版本号需要与 sw.js 中的 CACHE_VERSION 同步）
    this.cacheStoreName = 'audio-cache-v2';
  }

  getAudioUrl(track) {
    if (!track || !track.url) return '';

    // 如果是 music-dl.sayqz.com 的 URL（搜索结果），需要通过代理
    // 因为 music-dl.sayqz.com 会返回 302 重定向到音乐平台的 CDN
    // 这些 CDN 可能有 SSL 证书问题，通过代理可以处理重定向和证书问题
    if (track.url.includes('music-dl.sayqz.com')) {
      return `/api/audio?url=${encodeURIComponent(track.url)}`;
    }

    const customProxyUrl = localStorage.getItem('ui.customProxyUrl') || '';
    if (customProxyUrl) {
      return `${customProxyUrl}?url=${encodeURIComponent(track.url)}`;
    }

    if (track.url.includes('github.com') || track.url.includes('raw.githubusercontent.com')) {
      return `/api/audio?url=${encodeURIComponent(track.url)}`;
    }

    try {
      const url = new URL(track.url, window.location.origin);
      const currentOrigin = window.location.origin;

      if (url.origin !== currentOrigin && url.protocol.startsWith('http')) {
        const pathname = url.pathname;
        if (pathname) {
          const key = decodeURIComponent(pathname.replace(/^\/+/, ''));
          if (key) {
            return `/api/r2?key=${encodeURIComponent(key)}`;
          }
        }
      }
    } catch {}

    return track.url;
  }

  async preloadAudio(track, priority = 'normal') {
    if (!track || !track.url) return null;

    // const audioUrl = this.getAudioUrl(track) // 保留以备将来使用
    const cacheKey = this.getCacheKey(track);

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    this.addToPreloadQueue(track, priority);

    this.startPreloading();

    return null;
  }

  getCachedAudio(track) {
    if (!track || !track.url) return null;

    const cacheKey = this.getCacheKey(track);
    const entry = this.cache.get(cacheKey);
    if (entry) {
      const audio = entry?.audio || entry;
      if (audio) audio.lastUsed = Date.now();
      return audio;
    }

    // 内存中没有，但可能 Cache Storage 中有，返回 null 让调用方处理
    // 调用方应该尝试从 Cache Storage 恢复或触发预加载
    return null;
  }

  async getCachedAudioAsync(track) {
    if (!track || !track.url) return null;

    const cacheKey = this.getCacheKey(track);
    const entry = this.cache.get(cacheKey);
    if (entry) {
      const audio = entry?.audio || entry;
      if (audio) audio.lastUsed = Date.now();
      return audio;
    }

    // 内存中没有，尝试从 Cache Storage 恢复
    const audioUrl = this.getAudioUrl(track);
    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(this.cacheStoreName);
        const cachedResponse = await cache.match(audioUrl);
        if (cachedResponse) {
          // 从 Cache Storage 恢复
          const blob = await cachedResponse.blob();
          const objectUrl = URL.createObjectURL(blob);

          const audio = new Audio();
          audio.crossOrigin = 'anonymous';
          audio.preload = 'auto';
          audio.src = objectUrl;
          audio.lastUsed = Date.now();

          this.setCache(cacheKey, { audio, objectUrl, source: audioUrl });
          return audio;
        }
      } catch (err) {
        console.warn('从 Cache Storage 恢复音频失败:', err);
      }
    }

    return null;
  }

  async cacheAudio(track) {
    if (!track || !track.url) return null;

    const audioUrl = this.getAudioUrl(track);
    const cacheKey = this.getCacheKey(track);

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      // 先尝试从 Cache Storage 读已有离线副本
      let objectUrl = null;
      let cachedResponse = null;
      if (typeof caches !== 'undefined') {
        try {
          const cache = await caches.open(this.cacheStoreName);
          cachedResponse = await cache.match(audioUrl);
          if (cachedResponse) {
            const blob = await cachedResponse.blob();
            objectUrl = URL.createObjectURL(blob);
          }
        } catch (err) {
          console.warn('读取音频缓存失败:', err);
        }
      }

      // 没有离线副本则拉取整首音频并落盘
      if (!objectUrl) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        const resp = await fetch(audioUrl, {
          redirect: 'follow',
          signal: controller.signal,
          cache: 'no-store',
        });
        clearTimeout(timeoutId);

        if (!resp.ok || !resp.body) {
          throw new Error(`音频拉取失败: ${resp.status}`);
        }

        // 保存到 Cache Storage 供刷新/离线复用
        if (typeof caches !== 'undefined') {
          try {
            const cache = await caches.open(this.cacheStoreName);
            await cache.put(audioUrl, resp.clone());
          } catch (err) {
            console.warn('写入音频缓存失败:', err);
          }
        }

        const blob = await resp.blob();
        objectUrl = URL.createObjectURL(blob);
      }

      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      audio.src = objectUrl;
      audio.lastUsed = Date.now();

      this.setCache(cacheKey, { audio, objectUrl, source: audioUrl });

      return audio;
    } catch (error) {
      console.warn('音频缓存失败:', error);
      return null;
    }
  }

  async preloadNext(tracks, currentIndex) {
    if (!tracks || !Array.isArray(tracks)) return;

    const nextIndex = (currentIndex + 1) % tracks.length;
    const nextTrack = tracks[nextIndex];

    if (nextTrack) {
      await this.preloadAudio(nextTrack, 'high');
    }
  }

  async preloadPrev(tracks, currentIndex) {
    if (!tracks || !Array.isArray(tracks)) return;

    const prevIndex = (currentIndex - 1 + tracks.length) % tracks.length;
    const prevTrack = tracks[prevIndex];

    if (prevTrack) {
      await this.preloadAudio(prevTrack, 'high');
    }
  }

  async preloadBatch(tracks, startIndex, count = 3) {
    if (!tracks || !Array.isArray(tracks)) return;

    const preloadPromises = [];

    for (let i = 0; i < count; i++) {
      const index = (startIndex + i) % tracks.length;
      const track = tracks[index];

      if (track) {
        // 检查是否已经缓存，避免重复预加载
        const cacheKey = this.getCacheKey(track);
        if (!this.cache.has(cacheKey)) {
          preloadPromises.push(this.preloadAudio(track, 'normal'));
        }
      }
    }

    await Promise.allSettled(preloadPromises);
  }

  async preloadUntilFull(tracks, startIndex) {
    if (!tracks || !Array.isArray(tracks)) return;

    // 持续预加载，直到达到最大缓存数量
    let currentIndex = startIndex;
    let addedCount = 0;
    let restoredCount = 0;
    const maxAttempts = tracks.length * 2; // 防止无限循环

    // 检查 Cache Storage 中已有的缓存
    const cacheStoreCheck =
      typeof caches !== 'undefined'
        ? await caches.open(this.cacheStoreName).catch(() => null)
        : null;

    while (this.cacheSize < this.maxCacheSize && addedCount + restoredCount < maxAttempts) {
      const track = tracks[currentIndex];
      if (track) {
        const cacheKey = this.getCacheKey(track);
        // 检查内存缓存
        if (!this.cache.has(cacheKey)) {
          // 检查 Cache Storage 缓存
          let isCached = false;
          if (cacheStoreCheck) {
            try {
              const audioUrl = this.getAudioUrl(track);
              const cachedResponse = await cacheStoreCheck.match(audioUrl);
              if (cachedResponse) {
                isCached = true;
                // Cache Storage 中有缓存，直接恢复到内存缓存（异步，不阻塞）
                this.getCachedAudioAsync(track)
                  .then(() => {
                    restoredCount++;
                  })
                  .catch(() => {});
              }
            } catch {
              // 检查失败，继续预加载
            }
          }

          // 如果 Cache Storage 中也没有，才添加到预加载队列
          if (!isCached) {
            this.addToPreloadQueue(track, 'normal');
            addedCount++;
          } else {
            restoredCount++;
          }
        }
      }

      currentIndex = (currentIndex + 1) % tracks.length;

      // 如果已经遍历完所有歌曲，停止
      if (currentIndex === startIndex && addedCount === 0 && restoredCount === 0) {
        break;
      }
    }

    // 启动预加载
    if (this.preloadQueue.length > 0) {
      this.startPreloading();
    }
  }

  clearCache() {
    this.cache.forEach((entry) => {
      const audio = entry?.audio || entry;
      if (audio && audio.src) {
        audio.src = '';
        audio.load();
      }
      if (entry?.objectUrl) {
        try {
          URL.revokeObjectURL(entry.objectUrl);
        } catch {}
      }
    });
    this.cache.clear();
    this.cacheSize = 0;

    this.preloadQueue = [];

    if ('caches' in window) {
      caches.keys().then((cacheNames) => {
        cacheNames.forEach((cacheName) => {
          if (cacheName.includes('audio-cache')) {
            caches.delete(cacheName);
          }
        });
      });
    }
  }

  getCacheStats() {
    return {
      cacheSize: this.cacheSize,
      maxCacheSize: this.maxCacheSize,
      preloadQueueLength: this.preloadQueue.length,
      isPreloading: this.isPreloading,
      preloadCount: this.preloadCount,
      preloadStartTime: this.preloadStartTime,
    };
  }

  setMaxCacheSize(size) {
    this.maxCacheSize = Math.max(1, size);
    this.cleanupCache();
  }

  getCacheKey(track) {
    return `${track.url}_${track.title || ''}`;
  }

  addToPreloadQueue(track, priority) {
    const existing = this.preloadQueue.find((item) => item.track.url === track.url);
    if (existing) return;

    this.preloadQueue.push({
      track,
      priority,
      timestamp: Date.now(),
    });

    this.preloadQueue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  async startPreloading() {
    if (this.isPreloading || this.preloadQueue.length === 0) return;

    this.isPreloading = true;
    this.preloadStartTime = Date.now();
    this.preloadCount = 0;

    try {
      while (this.preloadQueue.length > 0 && this.cacheSize < this.maxCacheSize) {
        const { track } = this.preloadQueue.shift();
        this.preloadCount++;
        await this.cacheAudio(track);
      }
    } catch (error) {
      console.warn('预加载失败:', error);
    } finally {
      const preloadDuration = Date.now() - this.preloadStartTime;
      const minDisplayTime = 3000;
      const remainingTime = Math.max(minDisplayTime, minDisplayTime - preloadDuration);

      setTimeout(() => {
        this.isPreloading = false;
        this.preloadCount = 0;
      }, remainingTime);
    }
  }

  setCache(key, audio) {
    if (this.cacheSize >= this.maxCacheSize) {
      this.cleanupCache();
    }

    this.cache.set(key, audio);
    this.cacheSize++;
  }

  cleanupCache() {
    if (this.cacheSize <= this.maxCacheSize) return;

    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => {
      const aEntry = a[1];
      const bEntry = b[1];
      const aAudio = aEntry?.audio || aEntry;
      const bAudio = bEntry?.audio || bEntry;
      const aTime = aAudio?.lastUsed || 0;
      const bTime = bAudio?.lastUsed || 0;
      return aTime - bTime;
    });

    const toDelete = entries.slice(0, this.cacheSize - this.maxCacheSize);
    toDelete.forEach(([key, entry]) => {
      const audio = entry?.audio || entry;
      if (audio && audio.src) {
        audio.src = '';
        audio.load();
      }
      if (entry?.objectUrl) {
        try {
          URL.revokeObjectURL(entry.objectUrl);
        } catch {}
      }
      this.cache.delete(key);
      this.cacheSize--;
    });
  }
}

const audioCacheService = new AudioCacheService();

export default audioCacheService;
