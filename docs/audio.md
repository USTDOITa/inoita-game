# 游戏音频

`public/content/audio.json` 是运行时的音频目录，当前结构版本为 3。`AudioScene` 常驻，`GameAudio` 使用 Phaser 全局 SoundManager（声音管理器），地图场景重启后仍能控制音乐、环境音和音效。目录字段与加载校验在 `src/application/content-validation.ts`，行为测试在 `tests/game-audio.test.ts`。

地图进场按 `maps[mapId]` 切换曲目。地图 `music: null` 保留此前音乐；地图 `ambience: null` 停止环境音。返回标题切换菜单音乐并停止环境音。剧情 `setStoryMusic(null)` 则明确停止音乐，与地图的保留语义不同。世界快照保存持续音乐与环境音，恢复时验证目录引用后切换。

标题设置和游戏设置分别提供音乐与音效开关。音效开关也控制环境音，音乐开关只控制背景音乐。设置保存在 `localStorage` 的 `inotia4.audio.v1`；挂起时暂停，恢复时沿 SoundManager 生命周期继续。

界面音效在启动时准备，战斗准备分批预加载全部武器与怪物命中音效、参战职业技能音效和动作分支音效；预加载不阻塞地图战斗就绪。未加载的音效等待本次加载完成后补播一次，同一加载期间重复请求不叠加补播。换地图、进入剧情或返回标题会增加上下文编号，过期补播被丢弃；关闭音效或挂起时也不补播。失败资源等待五秒后才再次尝试。

切换循环音轨会停止并销毁已播放声音，同时移除对应已解码缓存。过期加载的循环轨只放弃播放，刚加载的缓存仍可能保留；是否需要额外释放须以长时间切图的缓存与内存采样判断。音效缓存按有限目录复用。目录的 `unbound` 保存未明确接入用途的音效。

音频目录由 `public/content/audio.json` 提供。改动后运行 `npm run validate:content`，行为有变化时再运行 `npm test -- tests/game-audio.test.ts`。实际设备格式支持、触摸解锁、音量及后台恢复需要在游戏入口验收。
