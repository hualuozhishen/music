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

export const onRequestPost = async ({ request, env }) => {
  try {
    const body = await request.json();
    const { action, favorites, audioCache } = body;

    if (
      !action ||
      (action !== 'save' &&
        action !== 'load' &&
        action !== 'saveAudioCache' &&
        action !== 'loadAudioCache')
    ) {
      return new Response(
        JSON.stringify({
          error: '无效的操作，必须是 "save"、"load"、"saveAudioCache" 或 "loadAudioCache"',
        }),
        {
          status: 400,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
          },
        },
      );
    }

    const token = env.GIT_TOKEN;
    if (!token) {
      return new Response(JSON.stringify({ error: '服务器未配置: 缺少 GIT_TOKEN' }), {
        status: 500,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    }

    const proxyUrl = env.GIT_URL;
    const builtinProxyUrl = '/api/audio';
    const proxyFetch = createProxyFetch(proxyUrl, builtinProxyUrl);

    const GIST_FILENAME = 'music.json';

    const gistId = await findOrCreateGist(token, proxyFetch);

    const getRes = await proxyFetch(`https://api.github.com/gists/${gistId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'web-music-player/0.1 (Cloudflare Pages Function)',
      },
    });

    if (!getRes.ok) {
      const errorText = await getRes.text();
      return new Response(JSON.stringify({ error: `获取 Gist 失败: ${errorText}` }), {
        status: getRes.status,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
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
        return new Response(JSON.stringify({ error: '无效的收藏列表，必须是一个数组' }), {
          status: 400,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
          },
        });
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
          'User-Agent': 'web-music-player/0.1 (Cloudflare Pages Function)',
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
        return new Response(JSON.stringify({ error: `更新 Gist 失败: ${errorText}` }), {
          status: updateRes.status,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
          },
        });
      }

      return new Response(JSON.stringify({ ok: true, gistId }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    } else if (action === 'load') {
      return new Response(
        JSON.stringify({ ok: true, favorites: currentData.favorites || [], gistId }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
          },
        },
      );
    } else if (action === 'saveAudioCache') {
      if (!audioCache || typeof audioCache !== 'object') {
        return new Response(JSON.stringify({ error: '无效的音频缓存配置，必须是一个对象' }), {
          status: 400,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
          },
        });
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
          'User-Agent': 'web-music-player/0.1 (Cloudflare Pages Function)',
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
        return new Response(JSON.stringify({ error: `更新 Gist 失败: ${errorText}` }), {
          status: updateRes.status,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
          },
        });
      }

      return new Response(JSON.stringify({ ok: true, gistId }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    } else if (action === 'loadAudioCache') {
      return new Response(
        JSON.stringify({ ok: true, audioCache: currentData.audioCache, gistId }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
          },
        },
      );
    }
  } catch (e) {
    console.error('Gist error:', e);
    return new Response(JSON.stringify({ error: e.message || 'Gist 操作失败' }), {
      status: 500,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    });
  }
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
};
