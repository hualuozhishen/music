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
  } else {
    const errorText = await listRes.text();
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.message && errorJson.message.includes('API rate limit exceeded')) {
        throw new Error(
          'GitHub API 速率限制：请求过于频繁，请稍后再试。如果已配置 GIT_TOKEN，请确保使用有效的 GitHub Token 以提高速率限制。',
        );
      }
    } catch (e) {
      if (e.message && e.message.includes('GitHub API 速率限制')) {
        throw e;
      }
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
    let errorMessage = errorText;

    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.message && errorJson.message.includes('API rate limit exceeded')) {
        errorMessage =
          'GitHub API 速率限制：请求过于频繁，请稍后再试。如果已配置 GIT_TOKEN，请确保使用有效的 GitHub Token 以提高速率限制。';
      }
    } catch {}

    throw new Error(`创建 Gist 失败: ${createRes.status} ${errorMessage}`);
  }

  const newGist = await createRes.json();
  return newGist.id;
}

export function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: '方法不允许' }), {
      status: 405,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  return handleGist(request, env, corsHeaders);
}

async function handleGist(request, env, corsHeaders) {
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
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        },
      );
    }

    const token = env.GIT_TOKEN;
    if (!token) {
      return new Response(JSON.stringify({ error: '服务器未配置: 缺少 GIT_TOKEN' }), {
        status: 500,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
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
        'User-Agent': 'web-music-player/0.1 (EdgeOne Pages Function)',
      },
    });

    if (!getRes.ok) {
      const errorText = await getRes.text();
      let errorMessage = errorText;

      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.message && errorJson.message.includes('API rate limit exceeded')) {
          errorMessage =
            'GitHub API 速率限制：请求过于频繁，请稍后再试。如果已配置 GIT_TOKEN，请确保使用有效的 GitHub Token 以提高速率限制。';
        }
      } catch {}

      return new Response(JSON.stringify({ error: `获取 Gist 失败: ${errorMessage}` }), {
        status: getRes.status,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
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
          headers: { ...corsHeaders, 'content-type': 'application/json' },
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
          'User-Agent': 'web-music-player/0.1 (EdgeOne Pages Function)',
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
        let errorMessage = errorText;

        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.message && errorJson.message.includes('API rate limit exceeded')) {
            errorMessage =
              'GitHub API 速率限制：请求过于频繁，请稍后再试。如果已配置 GIT_TOKEN，请确保使用有效的 GitHub Token 以提高速率限制。';
          }
        } catch {}

        return new Response(JSON.stringify({ error: `更新 Gist 失败: ${errorMessage}` }), {
          status: updateRes.status,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true, gistId }), {
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    } else if (action === 'load') {
      return new Response(
        JSON.stringify({ ok: true, favorites: currentData.favorites || [], gistId }),
        {
          status: 200,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        },
      );
    } else if (action === 'saveAudioCache') {
      if (!audioCache || typeof audioCache !== 'object') {
        return new Response(JSON.stringify({ error: '无效的音频缓存配置，必须是一个对象' }), {
          status: 400,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
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
          'User-Agent': 'web-music-player/0.1 (EdgeOne Pages Function)',
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
        let errorMessage = errorText;

        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.message && errorJson.message.includes('API rate limit exceeded')) {
            errorMessage =
              'GitHub API 速率限制：请求过于频繁，请稍后再试。如果已配置 GIT_TOKEN，请确保使用有效的 GitHub Token 以提高速率限制。';
          }
        } catch {}

        return new Response(JSON.stringify({ error: `更新 Gist 失败: ${errorMessage}` }), {
          status: updateRes.status,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true, gistId }), {
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    } else if (action === 'loadAudioCache') {
      return new Response(
        JSON.stringify({ ok: true, audioCache: currentData.audioCache, gistId }),
        {
          status: 200,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        },
      );
    }
  } catch (e) {
    console.error('Gist error:', e);
    return new Response(JSON.stringify({ error: e.message || 'Gist 操作失败' }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
}
