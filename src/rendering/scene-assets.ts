import type Phaser from 'phaser';
import { AssetPool } from '../application/assets.ts';
import type { AssetLease } from '../application/assets.ts';
import { versionedAsset } from '../application/asset-version.ts';

export type PendingAsset =
  | { kind: 'image'; key: string; file: string }
  | { kind: 'spritesheet'; key: string; file: string; config: Phaser.Types.Loader.FileTypes.ImageFrameConfig };
const pools = new WeakMap<Phaser.Textures.TextureManager, AssetPool>();
const sceneQueues = new WeakMap<Phaser.Scene, Promise<void>>();

/** 已生成的效果继续使用已加载资源，直至自身动画结束。 */
export function retainLoadedSceneAssets(scene:Phaser.Scene,keys:Iterable<string>):AssetLease {
  return pools.get(scene.textures)?.acquire(keys)??{release:()=>{}};
}

async function inSceneQueue<T>(scene: Phaser.Scene, work: () => Promise<T>): Promise<T> {
  const previous = sceneQueues.get(scene) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>(resolve => { release = resolve; });
  sceneQueues.set(scene, previous.then(() => turn));
  await previous;
  try { return await work(); }
  finally { release(); }
}

/** 纹理和 spritesheet 帧都不缺才算已加载；用于静默重建前的 preflight。 */
export function missingSceneAssets(scene: Phaser.Scene, assets: readonly PendingAsset[]): PendingAsset[] {
  return assets.filter(asset => {
    if (!scene.textures.exists(asset.key)) return true;
    if (asset.kind !== 'spritesheet') return false;
    const texture = scene.textures.get(asset.key);
    const end = asset.config.endFrame ?? -1;
    const count = end < 0 ? 1 : end - (asset.config.startFrame ?? 0) + 1;
    for (let frame = 0; frame < count; frame++) if (!texture.has(String(frame))) return true;
    return false;
  });
}

function verifyAssets(scene: Phaser.Scene, assets: PendingAsset[]): void {
  const failures: string[] = [];
  for (const asset of assets) {
    if (!scene.textures.exists(asset.key)) {
      failures.push(`${asset.key} (${asset.file})：纹理未加载`);
      continue;
    }
    if (asset.kind !== 'spritesheet') continue;
    const texture = scene.textures.get(asset.key);
    const end = asset.config.endFrame ?? -1;
    const count = end < 0 ? 1 : end - (asset.config.startFrame ?? 0) + 1;
    for (let frame = 0; frame < count; frame += 1)
      if (!texture.has(String(frame))) { failures.push(`${asset.key} (${asset.file})：缺少帧 ${frame}`); break; }
  }
  if (failures.length) throw new Error('部分画面未能加载，请重试', { cause: new Error(failures.join('\n')) });
}

export async function loadSceneAssets(scene: Phaser.Scene, assets: PendingAsset[], progress: (value: number) => void, retain=false): Promise<AssetLease> {
  let pool = pools.get(scene.textures);
  if (!pool) {
    pool = new AssetPool(key => {
      if(scene.anims.exists(key))scene.anims.remove(key);
      if(scene.textures.exists(key))scene.textures.remove(key);
    }); pools.set(scene.textures,pool);
  }
  const byKey = new Map<string, PendingAsset>();
  for (const asset of assets) {
    const previous = byKey.get(asset.key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(asset)) throw new Error(`贴图键指向不同资源：${asset.key}`);
    byKey.set(asset.key, asset);
  }
  const unique = [...byKey.values()];
  const ownership = pool.acquire(unique.map(asset=>asset.key));
  const lease = {release:()=>{scene.events.off('shutdown',lease.release);ownership.release();}};
  const controller = new AbortController();
  const shutdown = () => controller.abort(new DOMException('场景已关闭','AbortError'));
  scene.events.once('shutdown',shutdown);
  try {
    await inSceneQueue(scene, async () => {
      controller.signal.throwIfAborted();
      const needed = unique.filter(asset => !scene.textures.exists(asset.key));
      if (!needed.length) { progress(1); return; }
      await new Promise<void>((resolve,reject)=>{
        const clean=()=>{scene.load.off('progress',progress);scene.load.off('complete',complete);controller.signal.removeEventListener('abort',cancelled);};
        const cancelled=()=>{clean();reject(controller.signal.reason);};
        const complete=()=>{clean();resolve();};
        scene.load.on('progress',progress);scene.load.once('complete',complete);controller.signal.addEventListener('abort',cancelled,{once:true});
        for(const asset of needed){
          const file=versionedAsset(asset.file);
          if(asset.kind==='image')scene.load.image(asset.key,file);
          else scene.load.spritesheet(asset.key,file,asset.config);
        }
        scene.load.start();
      });
      controller.signal.throwIfAborted();
    });
    // Phaser 的图片解码失败不发 loaderror；complete 也不保证纹理和帧已入库。
    verifyAssets(scene, unique);
    scene.events.off('shutdown',shutdown);
    if(!retain)scene.events.once('shutdown',lease.release);
    return lease;
  }catch(error){
    if(!controller.signal.aborted)globalThis.storyDiagnostics?.record('asset-load-error',
      {error,files:unique.map(asset=>({key:asset.key,file:asset.file}))});
    scene.events.off('shutdown',shutdown);lease.release();throw error;
  }
}
