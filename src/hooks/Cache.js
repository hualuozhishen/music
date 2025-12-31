import { useState, useEffect, useRef, useCallback } from 'react';
import audioCacheService from '../services/Audio';
import { saveAudioCacheToGist, loadAudioCacheFromGist } from '../services/api';

export function useAudioCache() {
  const [cacheStats, setCacheStats] = useState({
    cacheSize: 0,
    maxCacheSize: 50,
    preloadQueueLength: 0,
    isPreloading: false,
  });

  const [isEnabled, setIsEnabled] = useState(() => {
    return localStorage.getItem('audioCache.enabled') !== 'false';
  });

  const preloadTimeoutRef = useRef(null);
  const lastPreloadIndexRef = useRef(-1);

  const updateCacheStats = useCallback(() => {
    setCacheStats(audioCacheService.getCacheStats());
  }, []);

  const toggleCache = useCallback(async (enabled) => {
    setIsEnabled(enabled);
    localStorage.setItem('audioCache.enabled', enabled.toString());

    if (!enabled) {
      audioCacheService.clearCache();
    }

    // 保存到 Gist（异步，不阻塞 UI）
    try {
      const savedConfig = localStorage.getItem('audioCache.config');
      const config = savedConfig
        ? JSON.parse(savedConfig)
        : {
            maxCacheSize: 50,
            preloadCount: 3,
            preloadDelay: 1000,
            autoCleanup: true,
            cleanupInterval: 86400000,
          };

      const audioCacheData = {
        enabled,
        config,
      };
      await saveAudioCacheToGist(audioCacheData);
    } catch (error) {
      console.warn('保存音频缓存状态到 Gist 失败:', error);
    }
  }, []);

  const setMaxCacheSize = useCallback(
    (size) => {
      audioCacheService.setMaxCacheSize(size);
      updateCacheStats();
    },
    [updateCacheStats],
  );

  const clearCache = useCallback(() => {
    audioCacheService.clearCache();
    updateCacheStats();
  }, [updateCacheStats]);

  const preloadAudio = useCallback(
    async (track, priority = 'normal') => {
      if (!isEnabled || !track) return null;

      try {
        return await audioCacheService.preloadAudio(track, priority);
      } catch (error) {
        console.warn('预加载失败:', error);
        return null;
      }
    },
    [isEnabled],
  );

  const getCachedAudio = useCallback(
    (track) => {
      if (!isEnabled || !track) return null;

      return audioCacheService.getCachedAudio(track);
    },
    [isEnabled],
  );

  const getCachedAudioAsync = useCallback(
    async (track) => {
      if (!isEnabled || !track) return null;

      return await audioCacheService.getCachedAudioAsync(track);
    },
    [isEnabled],
  );

  const preloadNext = useCallback(
    async (tracks, currentIndex) => {
      if (!isEnabled || !tracks || !Array.isArray(tracks)) return;

      try {
        await audioCacheService.preloadNext(tracks, currentIndex);
        updateCacheStats();
      } catch (error) {
        console.warn('预加载下一首失败:', error);
      }
    },
    [isEnabled, updateCacheStats],
  );

  const preloadPrev = useCallback(
    async (tracks, currentIndex) => {
      if (!isEnabled || !tracks || !Array.isArray(tracks)) return;

      try {
        await audioCacheService.preloadPrev(tracks, currentIndex);
        updateCacheStats();
      } catch (error) {
        console.warn('预加载上一首失败:', error);
      }
    },
    [isEnabled, updateCacheStats],
  );

  const preloadBatch = useCallback(
    async (tracks, startIndex, count = 3) => {
      if (!isEnabled || !tracks || !Array.isArray(tracks)) return;

      try {
        await audioCacheService.preloadBatch(tracks, startIndex, count);
        updateCacheStats();
      } catch (error) {
        console.warn('批量预加载失败:', error);
      }
    },
    [isEnabled, updateCacheStats],
  );

  const smartPreload = useCallback(
    async (tracks, currentIndex) => {
      if (!isEnabled || !tracks || !Array.isArray(tracks)) return;

      if (lastPreloadIndexRef.current === currentIndex) return;
      lastPreloadIndexRef.current = currentIndex;

      if (preloadTimeoutRef.current) {
        clearTimeout(preloadTimeoutRef.current);
      }

      preloadTimeoutRef.current = setTimeout(async () => {
        try {
          // 先预加载下一首和上一首（高优先级）
          await Promise.all([
            audioCacheService.preloadNext(tracks, currentIndex),
            audioCacheService.preloadPrev(tracks, currentIndex),
          ]);

          // 获取当前缓存状态
          const stats = audioCacheService.getCacheStats();
          const remainingSlots = stats.maxCacheSize - stats.cacheSize;

          // 如果还有缓存空间，持续预加载直到达到最大缓存数量
          if (remainingSlots > 0) {
            // 使用新的预加载方法，持续预加载直到达到最大缓存数量
            await audioCacheService.preloadUntilFull(tracks, currentIndex);
          }

          updateCacheStats();
        } catch (error) {
          console.warn('智能预加载失败:', error);
        }
      }, 1000);
    },
    [isEnabled, updateCacheStats],
  );

  useEffect(() => {
    const interval = setInterval(updateCacheStats, 1000);
    return () => clearInterval(interval);
  }, [updateCacheStats]);

  // 监听 localStorage 中 enabled 状态的变化（用于从 Gist 加载后的同步）
  useEffect(() => {
    const checkEnabled = () => {
      const savedEnabled = localStorage.getItem('audioCache.enabled') !== 'false';
      if (savedEnabled !== isEnabled) {
        setIsEnabled(savedEnabled);
      }
    };

    // 初始检查
    checkEnabled();

    // 监听 storage 事件（跨标签页同步）
    const handleStorageChange = (e) => {
      if (e.key === 'audioCache.enabled') {
        checkEnabled();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // 定期检查（用于同标签页内的同步，因为 storage 事件只在跨标签页时触发）
    const interval = setInterval(checkEnabled, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [isEnabled]);

  useEffect(() => {
    return () => {
      if (preloadTimeoutRef.current) {
        clearTimeout(preloadTimeoutRef.current);
      }
    };
  }, []);

  return {
    cacheStats,
    isEnabled,

    toggleCache,
    setMaxCacheSize,
    clearCache,
    preloadAudio,
    getCachedAudio,
    getCachedAudioAsync,
    preloadNext,
    preloadPrev,
    preloadBatch,
    smartPreload,
    updateCacheStats,
  };
}

export function useAudioCacheConfig() {
  const [config, setConfig] = useState(() => {
    const defaultConfig = {
      enabled: true,
      maxCacheSize: 50,
      preloadCount: 3,
      preloadDelay: 1000,
      autoCleanup: true,
      cleanupInterval: 86400000,
    };

    try {
      const saved = localStorage.getItem('audioCache.config');
      return saved ? { ...defaultConfig, ...JSON.parse(saved) } : defaultConfig;
    } catch {
      return defaultConfig;
    }
  });

  const isSavingGistRef = useRef(false);

  // 从 Gist 加载配置（应用启动时）
  useEffect(() => {
    const loadFromGist = async () => {
      try {
        const gistData = await loadAudioCacheFromGist();
        if (gistData && typeof gistData === 'object') {
          const defaultConfig = {
            maxCacheSize: 50,
            preloadCount: 3,
            preloadDelay: 1000,
            autoCleanup: true,
            cleanupInterval: 86400000,
          };

          // 以 localStorage 为基础，再用 Gist 覆盖，避免 Gist 缺字段时把本地配置覆盖回默认值
          let localConfig = {};
          try {
            const saved = localStorage.getItem('audioCache.config');
            localConfig = saved ? JSON.parse(saved) : {};
          } catch {
            localConfig = {};
          }

          const mergedConfig = {
            ...defaultConfig,
            ...localConfig,
            ...(gistData.config || {}),
          };

          setConfig(mergedConfig);

          // 同步到 localStorage
          try {
            localStorage.setItem('audioCache.config', JSON.stringify(mergedConfig));
            if (gistData.enabled !== undefined) {
              localStorage.setItem('audioCache.enabled', gistData.enabled.toString());
            }
          } catch (e) {
            console.warn('保存到 localStorage 失败:', e);
          }
        }
      } catch (error) {
        // Gist 加载失败时，使用 localStorage 的数据（静默失败）
        console.warn('从 Gist 加载音频缓存配置失败，使用本地数据:', error);
      }
    };

    loadFromGist();
  }, []);

  const updateConfig = useCallback(
    async (newConfig) => {
      const updatedConfig = { ...config, ...newConfig };
      setConfig(updatedConfig);

      // 保存到 localStorage
      try {
        localStorage.setItem('audioCache.config', JSON.stringify(updatedConfig));
      } catch (e) {
        console.warn('保存到 localStorage 失败:', e);
      }

      // 保存到 Gist（异步，不阻塞 UI）
      if (isSavingGistRef.current) return;

      isSavingGistRef.current = true;
      try {
        const audioCacheData = {
          enabled: localStorage.getItem('audioCache.enabled') !== 'false',
          config: updatedConfig,
        };
        await saveAudioCacheToGist(audioCacheData);
      } catch (error) {
        console.warn('保存音频缓存配置到 Gist 失败:', error);
      } finally {
        isSavingGistRef.current = false;
      }
    },
    [config],
  );

  return {
    config,
    updateConfig,
  };
}
