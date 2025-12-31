const CACHE_VERSION = 'v1';
const STATIC_CACHE = `music-static-${CACHE_VERSION}`;
const AUDIO_CACHE = `audio-cache-${CACHE_VERSION}`;
const API_CACHE = `api-cache-${CACHE_VERSION}`;

const STATIC_RESOURCES = ['/', '/index.html', '/manifest.json', '/sw.js'];

const IMAGE_RESOURCES = [
  '/favicon.ico',
  '/images/background.webp',
  '/images/cd.webp',
  '/images/cd_tou.webp',
];

const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus', '.webm'];

function isAudioRequest(url) {
  return (
    AUDIO_EXTENSIONS.some((ext) => url.pathname.toLowerCase().endsWith(ext)) ||
    url.pathname.startsWith('/api/audio') ||
    url.pathname.startsWith('/music/')
  );
}

// 处理 Range 请求
async function handleRangeRequest(request, cachedResponse) {
  const rangeHeader = request.headers.get('range');
  if (!rangeHeader || !cachedResponse) {
    return cachedResponse;
  }

  try {
    const blob = await cachedResponse.blob();
    const totalLength = blob.size;

    // 解析 Range 头
    const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!rangeMatch) {
      return cachedResponse;
    }

    const start = parseInt(rangeMatch[1], 10);
    const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : totalLength - 1;

    if (start >= totalLength || end >= totalLength || start > end) {
      return new Response(null, {
        status: 416,
        statusText: 'Range Not Satisfiable',
        headers: {
          'Content-Range': `bytes */${totalLength}`,
        },
      });
    }

    const slicedBlob = blob.slice(start, end + 1);
    const slicedArrayBuffer = await slicedBlob.arrayBuffer();

    return new Response(slicedArrayBuffer, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Range': `bytes ${start}-${end}/${totalLength}`,
        'Content-Length': slicedArrayBuffer.byteLength.toString(),
        'Content-Type': cachedResponse.headers.get('Content-Type') || 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.warn('Range 请求处理失败:', error);
    return cachedResponse;
  }
}

// 安装 Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((cache) => {
        return Promise.allSettled(
          STATIC_RESOURCES.map((url) =>
            cache.add(url).catch((err) => {
              console.warn(`静态资源缓存失败: ${url}`, err);
              return null;
            }),
          ),
        );
      }),
      caches.open(STATIC_CACHE).then((cache) => {
        return Promise.allSettled(
          IMAGE_RESOURCES.map((url) =>
            cache.add(url).catch((err) => {
              console.warn(`图片资源缓存失败: ${url}`, err);
              return null;
            }),
          ),
        );
      }),
    ])
      .then(() => {
        console.log(`Service Worker ${CACHE_VERSION} 安装完成`);
        self.skipWaiting();
      })
      .catch((err) => {
        console.error('Service Worker 安装失败:', err);
        self.skipWaiting();
      }),
  );
});

// 激活 Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // 保留当前版本的缓存，删除旧版本
            if (
              cacheName !== STATIC_CACHE &&
              cacheName !== AUDIO_CACHE &&
              cacheName !== API_CACHE &&
              (cacheName.startsWith('music-') ||
                cacheName.startsWith('audio-cache-') ||
                cacheName.startsWith('api-cache-'))
            ) {
              console.log(`删除旧缓存: ${cacheName}`);
              return caches.delete(cacheName);
            }
            return Promise.resolve();
          }),
        );
      })
      .then(() => {
        console.log(`Service Worker ${CACHE_VERSION} 激活完成`);
        return self.clients.claim();
      }),
  );
});

// 拦截网络请求
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理 GET 请求
  if (request.method !== 'GET') return;

  // 只处理同源请求
  if (url.origin !== self.location.origin) return;

  // 处理音频请求（包括 Range 请求）
  if (isAudioRequest(url)) {
    event.respondWith(
      (async () => {
        try {
          const cache = await caches.open(AUDIO_CACHE);
          const cachedResponse = await cache.match(request);

          // 如果有缓存且不是 Range 请求，直接返回
          if (cachedResponse && !request.headers.has('range')) {
            return cachedResponse;
          }

          // 如果是 Range 请求且有缓存，处理 Range
          if (cachedResponse && request.headers.has('range')) {
            const rangeResponse = await handleRangeRequest(request, cachedResponse);
            if (rangeResponse) {
              return rangeResponse;
            }
          }

          const isRangeRequest = request.headers.has('range');

          // 尝试从网络获取
          try {
            const networkResponse = await fetch(request);

            if (networkResponse.ok) {
              // 对于 Range 请求，不写入 Cache，直接把网络响应返回给浏览器
              if (isRangeRequest) {
                return networkResponse;
              }

              // 只缓存完整响应（非 206）
              if (networkResponse.status === 200) {
                const responseToCache = networkResponse.clone();
                await cache.put(request, responseToCache);
              }

              return networkResponse;
            }

            // 网络请求失败，尝试返回缓存
            if (cachedResponse) {
              if (isRangeRequest) {
                return handleRangeRequest(request, cachedResponse);
              }
              return cachedResponse;
            }

            return networkResponse;
          } catch (networkError) {
            console.warn('网络请求失败，尝试使用缓存:', networkError);

            // 网络失败，尝试返回缓存
            if (cachedResponse) {
              if (isRangeRequest) {
                return handleRangeRequest(request, cachedResponse);
              }
              return cachedResponse;
            }

            // 没有缓存，返回错误
            return new Response('音频加载失败', {
              status: 503,
              statusText: 'Service Unavailable',
            });
          }
        } catch (error) {
          console.error('音频缓存处理错误:', error);
          return new Response('音频加载错误', {
            status: 500,
            statusText: 'Internal Server Error',
          });
        }
      })(),
    );
    return;
  }

  // 处理 API 请求
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(API_CACHE);
        const cachedResponse = await cache.match(request);

        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const fetchResponse = await fetch(request);
          if (fetchResponse.ok && fetchResponse.status === 200) {
            const responseToCache = fetchResponse.clone();
            await cache.put(request, responseToCache);
          }
          return fetchResponse;
        } catch (error) {
          if (cachedResponse) {
            return cachedResponse;
          }
          return new Response(JSON.stringify({ error: 'API 请求失败' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      })(),
    );
    return;
  }

  // 处理静态资源
  if (
    request.destination === 'document' ||
    ['style', 'script', 'image', 'font'].includes(request.destination) ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/images/') ||
    url.pathname.startsWith('/covers/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname === '/sw.js' ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(
      (async () => {
        // 对于 HTML 和 JS/CSS 文件，使用"网络优先"策略，避免缓存旧版本
        const isHtmlOrScript =
          request.destination === 'document' ||
          request.destination === 'script' ||
          request.destination === 'style' ||
          url.pathname.startsWith('/assets/') ||
          url.pathname.endsWith('.js') ||
          url.pathname.endsWith('.css');

        if (isHtmlOrScript) {
          // 网络优先：先尝试网络，失败再用缓存
          try {
            const fetchResponse = await fetch(request);
            if (fetchResponse.ok) {
              const responseToCache = fetchResponse.clone();
              const cache = await caches.open(STATIC_CACHE);
              await cache.put(request, responseToCache);
            }
            return fetchResponse;
          } catch (error) {
            // 网络失败，尝试使用缓存
            const cachedResponse = await caches.match(request);
            if (cachedResponse) {
              return cachedResponse;
            }
            if (request.destination === 'document') {
              const fallback = await caches.match('/index.html');
              if (fallback) return fallback;
            }
            return new Response('资源加载失败', { status: 404 });
          }
        } else {
          // 其他静态资源（图片等）使用"缓存优先"策略
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }

          try {
            const fetchResponse = await fetch(request);
            if (fetchResponse.ok) {
              const responseToCache = fetchResponse.clone();
              const cache = await caches.open(STATIC_CACHE);
              await cache.put(request, responseToCache);
            }
            return fetchResponse;
          } catch (error) {
            return new Response('资源加载失败', { status: 404 });
          }
        }
      })(),
    );
  }
});
