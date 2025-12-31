import { useEffect, useState } from 'react';
import { preloadBackgroundImage } from '../utils/image';
import { useAudioCache, useAudioCacheConfig } from '../hooks/Cache';
import { saveAudioCacheToGist } from '../services/api';

export default function Settings({
  open,
  onClose,
  onAddSong,
  onImportRepo,
  onImportApi,
  onResetPlaylist,
  onWebDavUpload,
  onWebDavRestore,
}) {
  const [songUrl, setSongUrl] = useState('');
  const [songTitle, setSongTitle] = useState('');
  const [songMvUrl, setSongMvUrl] = useState('');
  const [localBase64, setLocalBase64] = useState('');
  const [localMime, setLocalMime] = useState('');
  const [localFileName, setLocalFileName] = useState('');
  const [gitRepo, setGitRepo] = useState('');
  const [gitToken, setGitToken] = useState('');
  const [gitBranch, setGitBranch] = useState('');
  const [gitPath, setGitPath] = useState('music');
  const [apiUrl, setApiUrl] = useState('');
  const [fontFamily, setFontFamily] = useState('');
  const [bgUrl, setBgUrl] = useState('');
  const [localBgFile, setLocalBgFile] = useState(null);
  const [localBgPreview, setLocalBgPreview] = useState('');
  const [audioLoadMethod, setAudioLoadMethod] = useState('builtin');
  const [customProxyUrl, setCustomProxyUrl] = useState('');
  const [uploadTarget, setUploadTarget] = useState('github'); // 'github'、'r2' 或 'webdav'
  const [appConfig, setAppConfig] = useState({
    customProxyUrl: '',
    hasCustomProxy: false,
  });
  const FONT_PRESETS = [
    { label: '系统默认', value: '' },
    { label: '宋体', value: "'SimSun', 'NSimSun', 'Songti SC', serif" },
    { label: '楷体', value: "'KaiTi', 'STKaiti', 'Kaiti SC', serif" },
    { label: '仿宋', value: "'FangSong', 'STFangsong', 'FangSong_GB2312', serif" },
    { label: '黑体', value: "'SimHei', 'Heiti SC', 'PingFang SC', 'Microsoft YaHei', sans-serif" },
    { label: '微软雅黑', value: "'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif" },
    {
      label: '苹方',
      value: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
    },
    { label: '思源黑体', value: "'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', sans-serif" },
  ];
  const [fontPreset, setFontPreset] = useState('');

  const { cacheStats, isEnabled, toggleCache, setMaxCacheSize, clearCache } = useAudioCache();
  const { config, updateConfig } = useAudioCacheConfig();

  // 同步配置到音频缓存服务
  useEffect(() => {
    if (config && config.maxCacheSize) {
      setMaxCacheSize(config.maxCacheSize);
    }
  }, [config, setMaxCacheSize]);

  useEffect(() => {
    if (!open) return;
    try {
      // 从 localStorage 加载设置是合理的初始化行为
      setFontFamily(localStorage.getItem('ui.fontFamily') || '');
      setAudioLoadMethod(localStorage.getItem('ui.audioLoadMethod') || '');
      setCustomProxyUrl(localStorage.getItem('ui.customProxyUrl') || '');
      setUploadTarget(localStorage.getItem('ui.uploadTarget') || 'github');
      const localBgData = localStorage.getItem('ui.localBgFile');
      if (localBgData) {
        try {
          const parsed = JSON.parse(localBgData);
          if (parsed.dataUrl) {
            setLocalBgPreview(parsed.dataUrl);
            setBgUrl('');
          }
        } catch {}
      } else {
        setBgUrl(localStorage.getItem('ui.bgUrl') || '');
      }

      const saved = localStorage.getItem('ui.fontFamily') || '';
      const matched = FONT_PRESETS.find((p) => p.value === saved);
      setFontPreset(matched ? matched.value : '');

      setAudioLoadMethod(localStorage.getItem('ui.audioLoadMethod') || '');
      setCustomProxyUrl(localStorage.getItem('ui.customProxyUrl') || '');
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps -- FONT_PRESETS 是常量，不需要添加到依赖数组
  }, [open]);

  useEffect(() => {
    const fetchAppConfig = async () => {
      try {
        const response = await fetch('/api/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getConfig' }),
        });
        if (response.ok) {
          const config = await response.json();
          setAppConfig(config);
        }
      } catch (error) {
        console.warn('加载应用配置失败:', error);
        setAppConfig({
          customProxyUrl: '',
          hasCustomProxy: false,
        });
      }
    };

    fetchAppConfig();
  }, []);

  const applyAppearance = ({ ff, bg }) => {
    const root = document.documentElement;
    const body = document.body;

    if (ff != null && root) {
      root.style.setProperty(
        '--font-family',
        ff ||
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, "Helvetica Neue", Arial',
      );
    }

    if (bg != null && body) {
      const base = 'linear-gradient(180deg, rgba(0, 0, 0, .3), rgba(0, 0, 0, .3))';
      if (bg) {
        body.style.backgroundImage = `${base}, url('${bg}')`;
        preloadBackgroundImage(bg).catch(() => {});
      } else {
        body.style.backgroundImage = '';
      }
    }
  };

  if (!open) return null;

  const handleAddSong = () => {
    if ((!songUrl && !localBase64) || !songTitle) return;
    const normalizedTitle = (() => {
      const raw = String(songTitle || '').trim();
      const m = raw.match(/^(.+?)(?:\s{2,}|\s-\s)(.+)$/);
      if (m) return `${m[1].trim()} - ${m[2].trim()}`;
      const single = raw.match(/^([^\s-].*?)\s([^\s].*?)$/);
      if (single) return `${single[1].trim()} - ${single[2].trim()}`;
      return raw;
    })();
    const urlStr = String(songUrl || '');
    const noQuery = urlStr.split('#')[0].split('?')[0];
    let ext = '.mp3';
    if (localFileName) {
      const m = String(localFileName).match(/\.[a-zA-Z0-9]{2,5}$/);
      if (m) ext = m[0];
    } else if (localMime) {
      const map = {
        'audio/mpeg': '.mp3',
        'audio/mp3': '.mp3',
        'audio/aac': '.aac',
        'audio/wav': '.wav',
        'audio/x-wav': '.wav',
        'audio/ogg': '.ogg',
        'audio/webm': '.webm',
        'audio/mp4': '.m4a',
        'audio/x-m4a': '.m4a',
        'audio/flac': '.flac',
        'audio/opus': '.opus',
      };
      if (map[localMime]) ext = map[localMime];
    } else {
      try {
        const u = new URL(urlStr);
        const last = u.pathname.split('/').filter(Boolean).pop() || '';
        const m = last.match(/\.[a-zA-Z0-9]{2,5}$/);
        if (m) ext = m[0];
      } catch {
        const last = noQuery.split('/').filter(Boolean).pop() || '';
        const m = last.match(/\.[a-zA-Z0-9]{2,5}$/);
        if (m) ext = m[0];
      }
    }
    const baseRaw = normalizedTitle.trim();
    const base = baseRaw
      .replace(/[/\\:*?"<>|]+/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.]+|[\s.]+$/g, '');
    const derived = base ? `${base}${ext}` : `audio-${Date.now()}${ext}`;
    onAddSong &&
      onAddSong({
        songUrl,
        songTitle: normalizedTitle,
        fileName: derived,
        mvUrl: songMvUrl,
        base64: localBase64 || undefined,
        contentType: localMime || undefined,
        uploadTarget,
      });
    setSongUrl('');
    setSongTitle('');
    setSongMvUrl('');
    setLocalBase64('');
    setLocalMime('');
    setLocalFileName('');
  };

  return (
    <>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title" style={{ textAlign: 'center' }}>
          设置
        </h3>
        <div className="modal-body">
          <div className="section-title">切换歌单</div>
          <div className="form-group">
            <div className="form-actions" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-sakura"
                id="switch-to-r2-btn"
                name="switch-to-r2"
                onClick={() => {
                  if (window.switchToR2) {
                    window.switchToR2();
                  }
                }}
              >
                切换到R2歌曲
              </button>
              <button
                type="button"
                className="btn-favorite"
                id="toggle-favorites-btn"
                name="toggle-favorites"
                onClick={() => {
                  if (window.toggleFavorites) {
                    window.toggleFavorites();
                  }
                }}
                style={{
                  background: 'linear-gradient(180deg, #ff8fb3, #ff69b4)',
                  border: '1px solid #ff8fb3',
                  color: '#fff',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  boxShadow: '0 6px 14px rgba(255,143,179,.35)',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.target.style.filter = 'brightness(1.05)';
                  e.target.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.filter = 'brightness(1)';
                  e.target.style.transform = 'translateY(0)';
                }}
                onMouseDown={(e) => {
                  e.target.style.transform = 'translateY(1px)';
                }}
                onMouseUp={(e) => {
                  e.target.style.transform = 'translateY(-1px)';
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ marginRight: '6px', verticalAlign: 'middle' }}
                >
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                切换到收藏
              </button>
            </div>
            <div className="form-actions" style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn-sakura"
                id="reset-playlist-btn"
                name="reset-playlist"
                onClick={() => onResetPlaylist && onResetPlaylist()}
              >
                恢复默认
              </button>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="audio-load-method">
              代理服务
            </label>
            <select
              className="form-input"
              value={audioLoadMethod}
              onChange={(e) => setAudioLoadMethod(e.target.value)}
              id="audio-load-method"
              name="audio-load-method"
            >
              <option value="">内置代理</option>
              <option value="direct">原始URL</option>
              <option value="custom">自定义代理</option>
            </select>
            <div className="form-tip">
              {audioLoadMethod === '' && '使用内置代理服务，兼容性好'}
              {audioLoadMethod === 'direct' && '直接访问原始URL，但可能受CORS限制'}
              {audioLoadMethod === 'custom' && '使用自定义代理服务，需要配置代理URL'}
            </div>
          </div>
          {audioLoadMethod === 'custom' && (
            <div className="form-group">
              <label className="form-label" htmlFor="custom-proxy-url">
                自定义代理URL
              </label>
              <input
                className="form-input"
                type="url"
                placeholder={appConfig.customProxyUrl || 'https://music-proxy.com/api/audio?url='}
                value={customProxyUrl}
                onChange={(e) => setCustomProxyUrl(e.target.value)}
                id="custom-proxy-url"
                name="custom-proxy-url"
              />
              {appConfig.customProxyUrl && (
                <div
                  className="form-tip"
                  style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}
                >
                  当前环境变量: {appConfig.customProxyUrl}
                  <br />
                  <span style={{ color: '#ff6b6b' }}>输入代理URL将自动覆盖环境变量</span>
                </div>
              )}
              {!appConfig.customProxyUrl && (
                <div className="form-tip" style={{ fontSize: '12px', color: '#888' }}>
                  当前无环境变量配置，将使用上方输入的代理URL
                </div>
              )}
            </div>
          )}
          <div className="form-actions" style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
            <button
              type="button"
              className="btn-sakura"
              id="save-audio-settings-btn"
              name="save-audio-settings"
              onClick={() => {
                try {
                  localStorage.setItem('ui.audioLoadMethod', audioLoadMethod || '');
                  localStorage.setItem('ui.customProxyUrl', customProxyUrl || '');

                  window.dispatchEvent(new CustomEvent('audioSettingsChanged'));

                  alert('音频加载设置已保存！');
                } catch (error) {
                  console.error('保存音频设置失败:', error);
                  alert('保存失败，请重试');
                }
              }}
            >
              应用并保存
            </button>
          </div>
          <hr className="hr" />
          <div className="section-title">添加歌曲</div>
          <div className="form-group">
            <label className="form-label" htmlFor="upload-target">
              上传目标
            </label>
            <select
              className="form-input"
              value={uploadTarget}
              onChange={(e) => {
                const target = e.target.value;
                setUploadTarget(target);
                try {
                  localStorage.setItem('ui.uploadTarget', target);
                } catch {}
              }}
              id="upload-target"
              name="upload-target"
            >
              <option value="github">GitHub仓库</option>
              <option value="r2">R2存储桶</option>
              <option value="webdav">云盘</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="local-file-input">
              从本地上传
            </label>
            <input
              className="form-input"
              type="file"
              multiple
              accept="audio/*"
              id="local-file-input"
              name="local-file"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (!files.length) return;
                if (files.length > 1) {
                  files.forEach((f) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      try {
                        const result = String(reader.result || '');
                        const m = result.match(/^data:([^;]+);base64,(.*)$/);
                        if (!m) return;
                        const mime = m[1];
                        const b64 = m[2];
                        const base = String(f.name || '').replace(/\.[^.]+$/, '');
                        const title =
                          base
                            .replace(/\s*-\s*/g, ' - ')
                            .replace(/_/g, ' ')
                            .replace(/\s{2,}/g, ' ')
                            .trim() || `Track ${Date.now()}`;
                        const fileName = f.name || `audio-${Date.now()}`;
                        const MAX_FILE_SIZE_FOR_BASE64 = 100 * 1024 * 1024; // 100MB，仅用于前端读取提示
                        if (f.size > MAX_FILE_SIZE_FOR_BASE64) {
                          alert(
                            `文件太大 (${(f.size / 1024 / 1024).toFixed(2)}MB)，请使用不超过 ${MAX_FILE_SIZE_FOR_BASE64 / 1024 / 1024}MB 的文件或改用 URL 上传。`,
                          );
                          return;
                        }
                        onAddSong &&
                          onAddSong({
                            songUrl: '',
                            songTitle: title,
                            fileName,
                            mvUrl: '',
                            base64: b64,
                            contentType: mime,
                            suppressClose: true,
                            uploadTarget,
                          });
                      } catch {}
                    };
                    reader.readAsDataURL(f);
                  });
                  setLocalFileName(`${files.length} 个文件`);
                  setLocalMime('');
                  setLocalBase64('');
                } else {
                  const file = files[0];
                  setLocalFileName(file.name || '');
                  const MAX_FILE_SIZE_FOR_BASE64 = 100 * 1024 * 1024; // 100MB，仅用于前端读取提示
                  if (file.size > MAX_FILE_SIZE_FOR_BASE64) {
                    alert(
                      `文件太大 (${(file.size / 1024 / 1024).toFixed(2)}MB)，请使用不超过 ${MAX_FILE_SIZE_FOR_BASE64 / 1024 / 1024}MB 的文件或改用 URL 上传。`,
                    );
                    setLocalFileName('');
                    setLocalMime('');
                    setLocalBase64('');
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    const result = String(reader.result || '');
                    const m = result.match(/^data:([^;]+);base64,(.*)$/);
                    if (m) {
                      const mime = m[1];
                      const b64 = m[2];
                      setLocalMime(mime || file.type || '');
                      setLocalBase64(b64 || '');
                    } else {
                      setLocalMime(file.type || '');
                    }
                  };
                  reader.readAsDataURL(file);
                  if (!songTitle) {
                    const base = String(file.name || '').replace(/\.[^.]+$/, '');
                    const title = base
                      .replace(/\s*-\s*/g, ' - ')
                      .replace(/_/g, ' ')
                      .replace(/\s{2,}/g, ' ')
                      .trim();
                    setSongTitle(title);
                  }
                }
              }}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="song-url">
              歌曲URL
            </label>
            <input
              className="form-input"
              type="url"
              placeholder="https://player.zxlwq.dpdns.org.mp3"
              value={songUrl}
              onChange={(e) => setSongUrl(e.target.value)}
              id="song-url"
              name="song-url"
            />
          </div>
          <div className="form-row">
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label" htmlFor="song-title">
                歌名-歌手
              </label>
              <input
                className="form-input"
                type="text"
                placeholder="歌名-歌手"
                value={songTitle}
                onChange={(e) => setSongTitle(e.target.value)}
                id="song-title"
                name="song-title"
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="song-mv-url">
              MV 链接（可选）
            </label>
            <input
              className="form-input"
              type="url"
              placeholder="https://example.com/video"
              value={songMvUrl}
              onChange={(e) => setSongMvUrl(e.target.value)}
              id="song-mv-url"
              name="song-mv-url"
            />
          </div>
          <div className="form-actions" style={{ gap: 10 }}>
            <button
              type="button"
              className="btn-sakura"
              id="add-song-btn"
              name="add-song"
              onClick={handleAddSong}
            >
              上传歌曲
            </button>
          </div>
          <hr className="hr" />
          <div className="section-title">导入歌曲</div>
          <div className="form-group">
            <label className="form-label" htmlFor="git-repo">
              GIT_REPO
            </label>
            <input
              className="form-input"
              type="text"
              placeholder="用户名/仓库名"
              value={gitRepo}
              onChange={(e) => setGitRepo(e.target.value)}
              id="git-repo"
              name="git-repo"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="git-token">
              GIT_TOKEN
            </label>
            <input
              className="form-input"
              type="password"
              placeholder="GitHub Token"
              value={gitToken}
              onChange={(e) => setGitToken(e.target.value)}
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              name="git-token"
              id="git-token"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="git-branch">
              GIT_BRANCH（可选）
            </label>
            <input
              className="form-input"
              type="text"
              placeholder="main"
              value={gitBranch}
              onChange={(e) => setGitBranch(e.target.value)}
              id="git-branch"
              name="git-branch"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="git-path">
              导入路径
            </label>
            <input
              className="form-input"
              type="text"
              placeholder="public/music 或 music 或 ."
              value={gitPath}
              onChange={(e) => setGitPath(e.target.value)}
              id="git-path"
              name="git-path"
            />
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="btn-sakura"
              id="import-repo-btn"
              name="import-repo"
              onClick={() =>
                onImportRepo && onImportRepo({ gitRepo, gitToken, gitBranch, gitPath })
              }
            >
              导入歌曲
            </button>
          </div>
          <hr className="hr" />
          <div className="section-title">导入API歌单</div>
          <div className="form-group">
            <label className="form-label" htmlFor="api-url">
              API链接
            </label>
            <input
              className="form-input"
              type="url"
              placeholder="https://player.zxlwq.dpdns.org"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              id="api-url"
              name="api-url"
            />
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="btn-sakura"
              id="import-api-btn"
              name="import-api"
              onClick={() => onImportApi && onImportApi({ apiUrl })}
            >
              导入歌曲
            </button>
          </div>
          <hr className="hr" />
          <div className="section-title">WebDAV</div>
          <div className="form-group">
            <div className="form-actions" style={{ gap: 10 }}>
              <button
                type="button"
                className="btn-sakura"
                id="switch-to-webdav-btn"
                name="switch-to-webdav"
                onClick={() => {
                  if (window.switchToWebDAV) {
                    window.switchToWebDAV();
                  }
                }}
              >
                切换云盘歌单
              </button>
              <button
                type="button"
                className="btn-sakura"
                id="webdav-upload-btn"
                name="webdav-upload"
                onClick={() => onWebDavUpload && onWebDavUpload()}
              >
                上传
              </button>
              <button
                type="button"
                className="btn-sakura"
                id="webdav-restore-btn"
                name="webdav-restore"
                onClick={() => onWebDavRestore && onWebDavRestore()}
              >
                恢复
              </button>
            </div>
          </div>
          <hr className="hr" />
          <div className="section-title">美化设置</div>
          <div className="form-group">
            <label className="form-label" htmlFor="font-preset">
              字体预设
            </label>
            <select
              className="form-input"
              value={fontPreset}
              onChange={(e) => {
                const v = e.target.value;
                setFontPreset(v);
                setFontFamily(v);
                try {
                  localStorage.setItem('ui.fontFamily', v || '');
                } catch {}
                applyAppearance({ ff: v, bg: null });
              }}
              id="font-preset"
              name="font-preset"
            >
              {FONT_PRESETS.map((p) => (
                <option key={p.label} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="local-bg-file">
              添加本地背景图
            </label>
            <input
              className="form-input"
              type="file"
              accept="image/*"
              id="local-bg-file"
              name="local-bg-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) {
                  setLocalBgFile(null);
                  setLocalBgPreview('');
                  return;
                }

                if (!file.type.startsWith('image/')) {
                  alert('请选择图片文件');
                  return;
                }

                if (file.size > 5 * 1024 * 1024) {
                  alert('图片文件大小不能超过5MB');
                  return;
                }

                setLocalBgFile(file);

                const reader = new FileReader();
                reader.onload = () => {
                  const dataUrl = reader.result;
                  setLocalBgPreview(dataUrl);
                  const body = document.body;
                  if (body) {
                    const base = 'linear-gradient(180deg, rgba(0, 0, 0, .3), rgba(0, 0, 0, .3))';
                    body.style.backgroundImage = `${base}, url('${dataUrl}')`;
                  }
                };
                reader.readAsDataURL(file);
              }}
            />
            {localBgPreview && (
              <div style={{ marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: '12px', padding: '4px 8px' }}
                  id="clear-bg-file-btn"
                  name="clear-bg-file"
                  onClick={() => {
                    setLocalBgFile(null);
                    setLocalBgPreview('');
                    const fileInput = document.querySelector('input[type="file"]');
                    if (fileInput) fileInput.value = '';
                    try {
                      localStorage.removeItem('ui.localBgFile');
                      localStorage.setItem('ui.bgUrl', '');
                    } catch {}
                    const body = document.body;
                    if (body) {
                      body.style.backgroundImage = '';
                    }
                  }}
                >
                  清除
                </button>
              </div>
            )}
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="bg-url">
              背景图 URL
            </label>
            <input
              className="form-input"
              type="url"
              placeholder="images/background.webp"
              value={bgUrl}
              id="bg-url"
              name="bg-url"
              onChange={(e) => {
                const newBgUrl = e.target.value;
                setBgUrl(newBgUrl);

                if (newBgUrl) {
                  setLocalBgFile(null);
                  setLocalBgPreview('');
                }

                if (newBgUrl) {
                  preloadBackgroundImage(newBgUrl).catch(() => {});
                }
              }}
            />
            <div className="form-tip">留空恢复默认背景</div>
          </div>
          <div className="form-actions" style={{ gap: 10 }}>
            <button
              type="button"
              className="btn-sakura"
              id="apply-appearance-btn"
              name="apply-appearance"
              onClick={() => {
                try {
                  localStorage.setItem('ui.fontFamily', fontFamily || '');
                  localStorage.setItem('ui.audioLoadMethod', audioLoadMethod || '');
                  localStorage.setItem('ui.customProxyUrl', customProxyUrl || '');

                  const finalBgUrl = localBgPreview || bgUrl;
                  localStorage.setItem('ui.bgUrl', finalBgUrl || '');

                  if (localBgFile && localBgPreview) {
                    localStorage.setItem(
                      'ui.localBgFile',
                      JSON.stringify({
                        name: localBgFile.name,
                        type: localBgFile.type,
                        size: localBgFile.size,
                        dataUrl: localBgPreview,
                      }),
                    );
                  } else {
                    localStorage.removeItem('ui.localBgFile');
                  }
                } catch {}
                applyAppearance({ ff: fontFamily, bg: localBgPreview || bgUrl });
              }}
            >
              应用并保存
            </button>
          </div>
          <hr className="hr" />
          <div className="section-title">音频缓存管理</div>

          <div className="cache-status">
            <div className="status-grid">
              <div className="status-item">
                <span className="label">缓存状态:</span>
                <span className={`value ${isEnabled ? 'enabled' : 'disabled'}`}>
                  {isEnabled ? '已启用' : '已禁用'}
                </span>
              </div>
              <div className="status-item">
                <span className="label">缓存数量:</span>
                <span className="value">
                  {cacheStats.cacheSize} / {cacheStats.maxCacheSize}
                </span>
              </div>
              <div className="status-item">
                <span className="label">预加载队列:</span>
                <span className="value">{cacheStats.preloadQueueLength}</span>
              </div>
              <div className="status-item">
                <span className="label">预加载状态:</span>
                <span className={`value ${cacheStats.isPreloading ? 'loading' : 'idle'}`}>
                  {cacheStats.isPreloading ? `进行中 (${cacheStats.preloadCount || 0})` : '空闲'}
                </span>
              </div>
            </div>

            <div className="cache-usage">
              <div className="usage-header">
                <span>缓存使用率</span>
                <span>{Math.round((cacheStats.cacheSize / cacheStats.maxCacheSize) * 100)}%</span>
              </div>
              <div className="usage-bar">
                <div
                  className="usage-fill"
                  style={{
                    width: `${Math.round((cacheStats.cacheSize / cacheStats.maxCacheSize) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>

          <div className="cache-settings">
            <h4>基本设置</h4>
            <div className="form-group">
              <label className="form-label" htmlFor="max-cache-size">
                最大缓存数量
              </label>
              <input
                className="form-input"
                type="number"
                min="1"
                max="200"
                value={config.maxCacheSize}
                onChange={(e) => {
                  const newSize = parseInt(e.target.value);
                  updateConfig({ maxCacheSize: newSize });
                  setMaxCacheSize(newSize);
                }}
                disabled={!isEnabled}
                id="max-cache-size"
                name="max-cache-size"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="enable-cache">
                <input
                  type="checkbox"
                  id="enable-cache"
                  name="enable-cache"
                  checked={isEnabled}
                  onChange={(e) => toggleCache(e.target.checked)}
                />
                启用音频缓存
              </label>
            </div>
          </div>

          <div className="cache-settings">
            <h4>高级设置</h4>
            <div className="form-group">
              <label className="form-label" htmlFor="preload-count">
                预加载数量
              </label>
              <input
                className="form-input"
                type="number"
                min="1"
                max="10"
                value={config.preloadCount}
                onChange={(e) => {
                  const newCount = parseInt(e.target.value);
                  updateConfig({ preloadCount: newCount });
                }}
                disabled={!isEnabled}
                id="preload-count"
                name="preload-count"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="preload-delay">
                预加载延迟 (ms)
              </label>
              <input
                className="form-input"
                type="number"
                min="100"
                max="5000"
                value={config.preloadDelay}
                onChange={(e) => updateConfig({ preloadDelay: parseInt(e.target.value) })}
                disabled={!isEnabled}
                id="preload-delay"
                name="preload-delay"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="cleanup-interval">
                清理间隔 (天)
              </label>
              <input
                className="form-input"
                type="number"
                min="1"
                max="30"
                value={Math.round(config.cleanupInterval / (1000 * 60 * 60 * 24))}
                onChange={(e) => {
                  const days = parseInt(e.target.value);
                  const milliseconds = days * 24 * 60 * 60 * 1000;
                  updateConfig({ cleanupInterval: milliseconds });
                }}
                disabled={!isEnabled || !config.autoCleanup}
                id="cleanup-interval"
                name="cleanup-interval"
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                <input
                  type="checkbox"
                  checked={config.autoCleanup}
                  onChange={(e) => updateConfig({ autoCleanup: e.target.checked })}
                  disabled={!isEnabled}
                  id="auto-cleanup-checkbox"
                  name="auto-cleanup"
                />
                自动清理缓存
              </label>
            </div>
          </div>

          <div className="cache-actions">
            <button
              className="btn-sakura"
              id="save-cache-config-btn"
              name="save-cache-config"
              onClick={async () => {
                try {
                  setMaxCacheSize(config.maxCacheSize);

                  // 保存到 Gist
                  const audioCacheData = {
                    enabled: isEnabled,
                    config,
                  };
                  await saveAudioCacheToGist(audioCacheData);

                  alert('配置已保存并应用！已同步到 GitHub Gist。');
                } catch (error) {
                  console.error('保存配置到 Gist 失败:', error);
                  alert('配置已保存到本地，但同步到 Gist 失败，请检查网络连接。');
                }
              }}
            >
              保存配置
            </button>
            <button
              className="btn-sakura"
              id="clear-cache-btn"
              name="clear-cache"
              onClick={() => {
                if (confirm('确定要清理所有缓存吗？')) {
                  clearCache();
                }
              }}
              disabled={!isEnabled}
            >
              清理缓存
            </button>
          </div>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn-danger"
            id="close-settings-btn"
            name="close-settings"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </>
  );
}
