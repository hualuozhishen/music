function formatGistJson(data) {
  const indent = '                     ';
  let result = '{"favorites":[\n';

  if (Array.isArray(data.favorites) && data.favorites.length > 0) {
    const favoritesLines = data.favorites.map((url, index) => {
      const comma = index < data.favorites.length - 1 ? ',' : '';
      return `${indent}${JSON.stringify(url)}${comma}`;
    });
    result += favoritesLines.join('\n');
  }

  result += '\n],"audioCache":';
  result +=
    data.audioCache !== null && data.audioCache !== undefined
      ? JSON.stringify(data.audioCache)
      : 'null';
  result += '}';

  return result;
}

function createProxyFetch(proxyUrl, builtinProxyUrl) {
  if (!proxyUrl && !builtinProxyUrl) return fetch;

  return async (url, options = {}) => {
    if (url.includes('api.github.com') || url.includes('raw.githubusercontent.com')) {
      try {
        const directResponse = await fetch(url, options);
        if (directResponse.ok) {
          return directResponse;
        }
        console.log(`[gist] Direct request failed (${directResponse.status}), trying proxy...`);
      } catch (error) {
        console.log(`[gist] Direct request error: ${error.message}, trying proxy...`);
      }

      if (builtinProxyUrl) {
        try {
          const targetUrl = encodeURIComponent(url);
          const builtinProxiedUrl = `${builtinProxyUrl}?url=${targetUrl}`;

          const builtinOptions = {
            ...options,
            headers: {
              ...options.headers,
              'X-Target-URL': url,
              'X-Proxy-Type': 'github-gist',
            },
          };

          console.log(`[gist] Using builtin proxy: ${builtinProxiedUrl}`);
          const builtinResponse = await fetch(builtinProxiedUrl, builtinOptions);
          if (builtinResponse.ok) {
            return builtinResponse;
          }
        } catch (error) {
          console.log(`[gist] Builtin proxy failed: ${error.message}`);
        }
      }

      if (proxyUrl) {
        const targetUrl = encodeURIComponent(url);
        const proxiedUrl = `${proxyUrl}?target=${targetUrl}`;

        const proxyOptions = {
          ...options,
          headers: {
            ...options.headers,
            'X-Target-URL': url,
            'X-Proxy-Type': 'github-gist',
          },
        };

        console.log(`[gist] Using custom proxy: ${proxiedUrl}`);
        return fetch(proxiedUrl, proxyOptions);
      }
    }

    return fetch(url, options);
  };
}

async function findOrCreateGist(token, proxyFetch) {
  const GIST_DESCRIPTION = 'Music';
  const GIST_FILENAME = 'music.json';

  const listRes = await proxyFetch('https://api.github.com/gists', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'web-music-player/0.1',
    },
  });

  if (listRes.ok) {
    const gists = await listRes.json();
    // 查找所有 Gist 中是否已有 music.json 文件，不限制 description
    const found = Array.isArray(gists)
      ? gists.find((g) => {
          return g.files && g.files[GIST_FILENAME];
        })
      : null;

    if (found) {
      return found.id;
    }
  }

  const defaultContent = {
    favorites: [],
    audioCache: {
      enabled: true,
      config: {
        maxCacheSize: 50,
        preloadCount: 3,
        preloadDelay: 1000,
        autoCleanup: true,
        cleanupInterval: 86400000,
      },
    },
  };

  const createRes = await proxyFetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'web-music-player/0.1',
    },
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: {
        [GIST_FILENAME]: {
          content: formatGistJson(defaultContent),
        },
      },
    }),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(`创建 Gist 失败: ${createRes.status} ${errorText}`);
  }

  const newGist = await createRes.json();
  return newGist.id;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: '方法不允许' });
    return;
  }

  try {
    const { action, favorites, audioCache } = req.body;

    if (
      !action ||
      (action !== 'save' &&
        action !== 'load' &&
        action !== 'saveAudioCache' &&
        action !== 'loadAudioCache')
    ) {
      return res
        .status(400)
        .json({ error: '无效的操作，必须是 "save"、"load"、"saveAudioCache" 或 "loadAudioCache"' });
    }

    const token = process.env.GIT_TOKEN;
    if (!token) {
      return res.status(500).json({ error: '服务器未配置: 缺少 GIT_TOKEN' });
    }

    const proxyUrl = process.env.GIT_URL;
    const builtinProxyUrl = '/api/audio';
    const proxyFetch = createProxyFetch(proxyUrl, builtinProxyUrl);

    const GIST_FILENAME = 'music.json';

    const gistId = await findOrCreateGist(token, proxyFetch);

    const getRes = await proxyFetch(`https://api.github.com/gists/${gistId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'web-music-player/0.1',
      },
    });

    if (!getRes.ok) {
      const errorText = await getRes.text();
      return res.status(getRes.status).json({ error: `获取 Gist 失败: ${errorText}` });
    }

    const gist = await getRes.json();
    const file = gist.files[GIST_FILENAME];
    const sha = file ? file.sha : null;

    let currentData = { favorites: [], audioCache: null };
    if (file && file.content) {
      try {
        const parsed = JSON.parse(file.content);
        if (Array.isArray(parsed)) {
          currentData.favorites = parsed;
        } else if (typeof parsed === 'object') {
          currentData = {
            favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
            audioCache: parsed.audioCache || null,
          };
        }
      } catch (e) {
        console.error('解析 Gist 内容失败:', e);
      }
    }

    if (action === 'save') {
      if (!Array.isArray(favorites)) {
        return res.status(400).json({ error: '无效的收藏列表，必须是一个数组' });
      }

      const updatedData = {
        favorites,
        audioCache: currentData.audioCache,
      };

      const updateRes = await proxyFetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'web-music-player/0.1',
        },
        body: JSON.stringify({
          files: {
            [GIST_FILENAME]: {
              content: formatGistJson(updatedData),
              sha: sha,
            },
          },
        }),
      });

      if (!updateRes.ok) {
        const errorText = await updateRes.text();
        return res.status(updateRes.status).json({ error: `更新 Gist 失败: ${errorText}` });
      }

      res.status(200).json({ ok: true, gistId });
    } else if (action === 'load') {
      res.status(200).json({ ok: true, favorites: currentData.favorites || [], gistId });
    } else if (action === 'saveAudioCache') {
      if (!audioCache || typeof audioCache !== 'object') {
        return res.status(400).json({ error: '无效的音频缓存配置，必须是一个对象' });
      }

      const updatedData = {
        favorites: currentData.favorites || [],
        audioCache,
      };

      const updateRes = await proxyFetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'web-music-player/0.1',
        },
        body: JSON.stringify({
          files: {
            [GIST_FILENAME]: {
              content: formatGistJson(updatedData),
              sha: sha,
            },
          },
        }),
      });

      if (!updateRes.ok) {
        const errorText = await updateRes.text();
        return res.status(updateRes.status).json({ error: `更新 Gist 失败: ${errorText}` });
      }

      res.status(200).json({ ok: true, gistId });
    } else if (action === 'loadAudioCache') {
      res.status(200).json({ ok: true, audioCache: currentData.audioCache, gistId });
    }
  } catch (e) {
    console.error('Gist error:', e);
    res.status(500).json({ error: e.message || 'Gist 操作失败' });
  }
}
