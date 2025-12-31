import { APIError, AuthError, ValidationError, errorHandler } from '../utils/errors';

export const deleteTrack = async (filePath, rawUrl, password) => {
  try {
    const res = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, rawUrl, password: password || '' }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }

      if (res.status === 401) {
        throw new AuthError('认证失败，请检查密码', 'INVALID_PASSWORD');
      } else if (res.status === 404) {
        throw new APIError('文件不存在', res.status, '/api/delete', errorData);
      } else if (res.status === 500) {
        throw new APIError('服务器内部错误', res.status, '/api/delete', errorData);
      } else {
        throw new APIError(
          `删除失败：${errorData.error || errorText}`,
          res.status,
          '/api/delete',
          errorData,
        );
      }
    }

    return res;
  } catch (error) {
    if (error instanceof APIError || error instanceof AuthError) {
      throw error;
    }
    throw errorHandler.handle(error, '删除歌曲');
  }
};

export const uploadTrack = async (formData) => {
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(text);
      } catch {
        errorData = { error: text };
      }

      if (res.status === 409 || res.status === 422) {
        if (errorData?.exists || /exists/i.test(text)) {
          throw new APIError('该文件已存在', res.status, '/api/upload', errorData);
        }
      } else if (res.status === 413) {
        throw new APIError('文件过大', res.status, '/api/upload', errorData);
      } else if (res.status === 500) {
        throw new APIError('服务器内部错误', res.status, '/api/upload', errorData);
      } else {
        throw new APIError(
          `上传失败: ${errorData.error || text}`,
          res.status,
          '/api/upload',
          errorData,
        );
      }
    }

    return res.json();
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw errorHandler.handle(error, '上传歌曲');
  }
};

export const uploadTrackJson = async (data) => {
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const text = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(text);
      } catch {
        errorData = { error: text };
      }

      if (res.status === 409 || res.status === 422) {
        if (errorData?.exists || /exists/i.test(text)) {
          throw new APIError('该文件已存在', res.status, '/api/upload', errorData);
        }
      } else if (res.status === 413) {
        throw new APIError('文件过大', res.status, '/api/upload', errorData);
      } else if (res.status === 500) {
        throw new APIError('服务器内部错误', res.status, '/api/upload', errorData);
      } else {
        throw new APIError(
          `上传失败: ${errorData.error || text}`,
          res.status,
          '/api/upload',
          errorData,
        );
      }
    }

    return res.json();
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw errorHandler.handle(error, '上传歌曲JSON');
  }
};

export const importFromRepo = async (gitRepo, gitToken, gitBranch, gitPath) => {
  try {
    const branch = gitBranch || 'main';
    const [owner, repo] = String(gitRepo).split('/');
    if (!owner || !repo) {
      throw new ValidationError('GIT_REPO 格式应为 owner/repo', 'gitRepo', gitRepo);
    }

    const normPath = String(gitPath || 'public/music').replace(/^\/+|\/+$/g, '') || '.';
    const segs = normPath === '.' ? [] : normPath.split('/').filter(Boolean);
    const pathPart = segs.length ? '/' + segs.map(encodeURIComponent).join('/') : '';
    const listApi = `https://api.github.com/repos/${owner}/${repo}/contents${pathPart}?ref=${encodeURIComponent(branch)}`;

    const listRes = await fetch(listApi, {
      headers: {
        Authorization: `Bearer ${gitToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'web-music-player/0.1',
      },
    });

    if (!listRes.ok) {
      const errorText = await listRes.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }

      if (listRes.status === 401) {
        throw new AuthError('GitHub Token 无效或已过期', 'INVALID_TOKEN');
      } else if (listRes.status === 403) {
        throw new AuthError('GitHub Token 权限不足', 'INSUFFICIENT_PERMISSIONS');
      } else if (listRes.status === 404) {
        throw new APIError('仓库不存在或路径不存在', listRes.status, listApi, errorData);
      } else {
        throw new APIError(
          `读取仓库失败: ${errorData.error || errorText}`,
          listRes.status,
          listApi,
          errorData,
        );
      }
    }

    return listRes.json();
  } catch (error) {
    if (
      error instanceof APIError ||
      error instanceof AuthError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    throw errorHandler.handle(error, '导入仓库');
  }
};

export const importFromApi = async (apiUrl) => {
  const base = String(apiUrl || '').trim();
  const normBase = base.replace(/\/$/, '');
  const candidates = [`${normBase}/api/music/list`];

  let data = null;
  let lastErr = null;

  for (const url of candidates) {
    try {
      const resp = await fetch(url, { headers: { accept: 'application/json' } });
      if (!resp.ok) {
        lastErr = new Error(`HTTP ${resp.status}`);
        continue;
      }
      const ct = resp.headers.get('content-type') || '';
      if (!/json/i.test(ct)) {
        try {
          data = await resp.json();
        } catch {
          lastErr = new Error('非 JSON 响应');
          continue;
        }
      } else {
        data = await resp.json();
      }
      if (data != null) break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (data == null) {
    throw new Error(
      lastErr
        ? lastErr.message
        : '无法获取到歌单，请提供 player 实例地址（形如 https://host），程序会请求 /api/music/list',
    );
  }

  const isPlayerStyle = data && Array.isArray(data.data);
  if (!isPlayerStyle) {
    throw new Error('仅支持 player 风格 API：需返回 { total, data: [...] }');
  }

  return data;
};

export const webdavUpload = async (cursor, limit) => {
  const res = await fetch('/api/webdav', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'upload', cursor, limit }),
  });

  const ok = res.status === 200 || res.status === 207;
  if (!ok) {
    const t = await res.text();
    throw new Error(`WebDAV 上传失败: ${t}`);
  }

  return res.json();
};

export const webdavRestore = async (cursor, limit) => {
  const res = await fetch('/api/webdav', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'restore', cursor, limit }),
  });

  const ok = res.status === 200 || res.status === 207;
  if (!ok) {
    const t = await res.text();
    throw new Error(`WebDAV 恢复失败: ${t}`);
  }

  return res.json();
};

export const uploadTrackToWebDAV = async (formData) => {
  try {
    const res = await fetch('/api/webdav/upload', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(text);
      } catch {
        errorData = { error: text };
      }

      if (res.status === 409 || res.status === 422) {
        if (errorData?.exists || /exists/i.test(text)) {
          throw new APIError('该文件已存在', res.status, '/api/webdav/upload', errorData);
        }
      } else if (res.status === 413) {
        throw new APIError('文件过大', res.status, '/api/webdav/upload', errorData);
      } else if (res.status === 500) {
        throw new APIError('服务器内部错误', res.status, '/api/webdav/upload', errorData);
      } else {
        throw new APIError(
          `上传失败: ${errorData.error || text}`,
          res.status,
          '/api/webdav/upload',
          errorData,
        );
      }
    }

    return res.json();
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw errorHandler.handle(error, '上传歌曲到 WebDAV');
  }
};

export const uploadTrackToWebDAVJson = async (data) => {
  try {
    const res = await fetch('/api/webdav/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const text = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(text);
      } catch {
        errorData = { error: text };
      }

      if (res.status === 409 || res.status === 422) {
        if (errorData?.exists || /exists/i.test(text)) {
          throw new APIError('该文件已存在', res.status, '/api/webdav/upload', errorData);
        }
      } else if (res.status === 413) {
        throw new APIError('文件过大', res.status, '/api/webdav/upload', errorData);
      } else if (res.status === 500) {
        throw new APIError('服务器内部错误', res.status, '/api/webdav/upload', errorData);
      } else {
        throw new APIError(
          `上传失败: ${errorData.error || text}`,
          res.status,
          '/api/webdav/upload',
          errorData,
        );
      }
    }

    return res.json();
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw errorHandler.handle(error, '上传歌曲到 WebDAV (JSON)');
  }
};

export const importFromR2 = async () => {
  try {
    const res = await fetch('/api/r2?action=list', {
      headers: { accept: 'application/json' },
    });

    // 检查Content-Type，确保是JSON响应
    const contentType = res.headers.get('content-type') || '';
    const isJson = /application\/json/i.test(contentType);

    if (!res.ok) {
      const errorText = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        // 如果收到HTML错误页面，给出更友好的提示
        if (errorText.trim().toLowerCase().startsWith('<!doctype') || errorText.includes('<html')) {
          errorData = {
            error:
              '服务器返回了HTML页面而非JSON数据。在Android应用中，请确保API服务器地址配置正确。',
          };
        } else {
          errorData = { error: errorText };
        }
      }

      throw new APIError(
        `R2导入失败: ${errorData.error || errorText}`,
        res.status,
        '/api/r2',
        errorData,
      );
    }

    // 如果Content-Type不是JSON，先检查响应内容
    if (!isJson) {
      const text = await res.text();
      // 如果收到HTML，说明API路径可能不正确
      if (text.trim().toLowerCase().startsWith('<!doctype') || text.includes('<html')) {
        throw new APIError(
          '服务器返回了HTML页面而非JSON数据。在Android应用中，请确保API服务器地址配置正确，或检查网络连接。',
          500,
          '/api/r2',
          { receivedHtml: true },
        );
      }
      // 尝试解析为JSON（某些服务器可能没有设置正确的Content-Type）
      try {
        const data = JSON.parse(text);
        if (!data.success || !Array.isArray(data.data)) {
          throw new APIError('R2 API 返回格式错误', 500, '/api/r2', data);
        }
        return data;
      } catch (parseError) {
        throw new APIError(`无法解析服务器响应为JSON: ${parseError.message}`, 500, '/api/r2', {
          responseText: text.substring(0, 200),
        });
      }
    }

    const data = await res.json();

    if (!data.success || !Array.isArray(data.data)) {
      throw new APIError('R2 API 返回格式错误', 500, '/api/r2', data);
    }

    return data;
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    // 处理JSON解析错误
    if (error instanceof SyntaxError && error.message.includes('JSON')) {
      throw new APIError(
        '服务器返回了无效的JSON数据。在Android应用中，请确保API服务器地址配置正确。',
        500,
        '/api/r2',
        { originalError: error.message },
      );
    }
    throw errorHandler.handle(error, '导入R2歌曲');
  }
};

export const importFromWebDAV = async () => {
  try {
    const res = await fetch('/api/webdav/list', {
      headers: { accept: 'application/json' },
    });

    if (!res.ok) {
      const errorText = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }

      throw new APIError(
        `WebDAV导入失败: ${errorData.error || errorText}`,
        res.status,
        '/api/webdav/list',
        errorData,
      );
    }

    const data = await res.json();

    if (data == null || !Array.isArray(data.data)) {
      throw new APIError('WebDAV API 返回格式错误', 500, '/api/webdav/list', data);
    }

    return {
      success: true,
      total: data.total || data.data.length,
      data: data.data,
    };
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw errorHandler.handle(error, '导入WebDAV歌曲');
  }
};

export const uploadTrackToR2 = async (formData) => {
  try {
    const res = await fetch('/api/r2', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(text);
      } catch {
        errorData = { error: text };
      }

      if (res.status === 409 || res.status === 422) {
        if (errorData?.exists || /exists/i.test(text)) {
          throw new APIError('该文件已存在', res.status, '/api/r2', errorData);
        }
      } else if (res.status === 413) {
        throw new APIError('文件过大', res.status, '/api/r2', errorData);
      } else if (res.status === 500) {
        throw new APIError('服务器内部错误', res.status, '/api/r2', errorData);
      } else {
        throw new APIError(
          `上传失败: ${errorData.error || text}`,
          res.status,
          '/api/r2',
          errorData,
        );
      }
    }

    return res.json();
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw errorHandler.handle(error, '上传歌曲到 R2');
  }
};

export const uploadTrackToR2Json = async (data) => {
  try {
    const res = await fetch('/api/r2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const text = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(text);
      } catch {
        errorData = { error: text };
      }

      if (res.status === 409 || res.status === 422) {
        if (errorData?.exists || /exists/i.test(text)) {
          throw new APIError('该文件已存在', res.status, '/api/r2', errorData);
        }
      } else if (res.status === 413) {
        throw new APIError('文件过大', res.status, '/api/r2', errorData);
      } else if (res.status === 500) {
        throw new APIError('服务器内部错误', res.status, '/api/r2', errorData);
      } else {
        throw new APIError(
          `上传失败: ${errorData.error || text}`,
          res.status,
          '/api/r2',
          errorData,
        );
      }
    }

    return res.json();
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw errorHandler.handle(error, '上传歌曲到R2 (JSON)');
  }
};

// 获取 R2 直传预签名 URL（PUT）
export const getR2UploadUrl = async (fileName, contentType) => {
  const params = new URLSearchParams({
    action: 'sign',
    key: fileName,
  });
  if (contentType) params.set('contentType', contentType);

  const res = await fetch(`/api/r2?${params.toString()}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new APIError(`获取直传地址失败: ${text}`, res.status, '/api/r2', { error: text });
  }

  const json = await res.json();
  if (!json?.uploadUrl) {
    throw new APIError('直传地址缺失', 500, '/api/r2', json);
  }
  return json;
};

export const saveFavoritesToGist = async (favorites) => {
  try {
    const res = await fetch('/api/gist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', favorites }),
    });

    if (!res.ok) {
      const text = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(text);
      } catch {
        errorData = { error: text };
      }

      if (res.status === 401) {
        throw new AuthError('GitHub Token 无效或已过期', 'INVALID_TOKEN');
      } else if (res.status === 403) {
        throw new AuthError('GitHub Token 权限不足', 'INSUFFICIENT_PERMISSIONS');
      } else {
        throw new APIError(
          `保存收藏列表失败: ${errorData.error || text}`,
          res.status,
          '/api/gist',
          errorData,
        );
      }
    }

    return res.json();
  } catch (error) {
    if (error instanceof APIError || error instanceof AuthError) {
      throw error;
    }
    throw errorHandler.handle(error, '保存收藏列表到 Gist');
  }
};

export const loadFavoritesFromGist = async () => {
  try {
    const res = await fetch('/api/gist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'load' }),
    });

    if (!res.ok) {
      const text = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(text);
      } catch {
        errorData = { error: text };
      }

      if (res.status === 401) {
        throw new AuthError('GitHub Token 无效或已过期', 'INVALID_TOKEN');
      } else if (res.status === 403) {
        throw new AuthError('GitHub Token 权限不足', 'INSUFFICIENT_PERMISSIONS');
      } else {
        throw new APIError(
          `加载收藏列表失败: ${errorData.error || text}`,
          res.status,
          '/api/gist',
          errorData,
        );
      }
    }

    const data = await res.json();
    return data.favorites || [];
  } catch (error) {
    if (error instanceof APIError || error instanceof AuthError) {
      throw error;
    }
    throw errorHandler.handle(error, '从 Gist 加载收藏列表');
  }
};

export const saveAudioCacheToGist = async (audioCache) => {
  try {
    const res = await fetch('/api/gist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveAudioCache', audioCache }),
    });

    if (!res.ok) {
      const text = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(text);
      } catch {
        errorData = { error: text };
      }

      if (res.status === 401) {
        throw new AuthError('GitHub Token 无效或已过期', 'INVALID_TOKEN');
      } else if (res.status === 403) {
        throw new AuthError('GitHub Token 权限不足', 'INSUFFICIENT_PERMISSIONS');
      } else {
        throw new APIError(
          `保存音频缓存配置失败: ${errorData.error || text}`,
          res.status,
          '/api/gist',
          errorData,
        );
      }
    }

    return res.json();
  } catch (error) {
    if (error instanceof APIError || error instanceof AuthError) {
      throw error;
    }
    throw errorHandler.handle(error, '保存音频缓存配置到 Gist');
  }
};

export const loadAudioCacheFromGist = async () => {
  try {
    const res = await fetch('/api/gist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'loadAudioCache' }),
    });

    if (!res.ok) {
      const text = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(text);
      } catch {
        errorData = { error: text };
      }

      if (res.status === 401) {
        throw new AuthError('GitHub Token 无效或已过期', 'INVALID_TOKEN');
      } else if (res.status === 403) {
        throw new AuthError('GitHub Token 权限不足', 'INSUFFICIENT_PERMISSIONS');
      } else {
        throw new APIError(
          `加载音频缓存配置失败: ${errorData.error || text}`,
          res.status,
          '/api/gist',
          errorData,
        );
      }
    }

    const data = await res.json();
    return data.audioCache || null;
  } catch (error) {
    if (error instanceof APIError || error instanceof AuthError) {
      throw error;
    }
    throw errorHandler.handle(error, '从 Gist 加载音频缓存配置');
  }
};

/**
 * 聚合搜索（跨平台搜索）
 * @param {string} keyword - 搜索关键词
 * @param {number} limit - 每页数量（默认30）
 * @param {number} page - 页码（默认1）
 * @returns {Promise<Object>} 搜索结果
 */
export const aggregateSearch = async (keyword, limit = 30, page = 1) => {
  const BASE_URL = 'https://music-dl.sayqz.com';
  const params = new URLSearchParams({
    type: 'aggregateSearch',
    keyword: keyword.trim(),
    limit: String(limit),
    page: String(page),
  });
  const url = `${BASE_URL}/api/?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      throw new APIError(
        `搜索失败: ${errorData.error || errorText}`,
        response.status,
        url,
        errorData,
      );
    }

    const data = await response.json();

    if (data.code !== 200) {
      throw new APIError(`搜索失败: ${data.message || '未知错误'}`, data.code || 500, url, data);
    }

    return {
      keyword: data.data?.keyword || keyword,
      limit: data.data?.limit || limit,
      page: data.data?.page || page,
      total: data.data?.total || data.data?.results?.length || 0,
      results: (data.data?.results || []).map((item) => ({
        id: item.id,
        name: item.name,
        artist: item.artist,
        album: item.album,
        url: item.url,
        pic: item.pic,
        lrc: item.lrc,
        platform: item.platform || 'netease',
      })),
    };
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw errorHandler.handle(error, '聚合搜索');
  }
};
