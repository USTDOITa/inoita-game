/**
 * 画面开关。目前只有帧率显示一项。
 *
 * 和音频开关一样存在 localStorage：属于本机偏好，不进存档，也不随存档回退。
 */
const STORAGE_KEY = 'inotia4.display.v1';

interface DisplayPreferences { fps: boolean }

function preferences(): DisplayPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { fps: saved.fps !== false };
  } catch { return { fps: true }; }
}

const settings = preferences();

export const displaySettings = {
  /** 帧率显示默认开启。 */
  get fps(): boolean { return settings.fps; },
  setFps(enabled: boolean): void {
    settings.fps = enabled;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* 隐私模式等写不进去的场景：本次会话内仍然生效 */ }
  },
};
