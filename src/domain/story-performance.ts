import type { Facing, StoryPose, TravelDestination, WorldMap } from './content.ts';
import type { CampaignPlacement } from './campaign.ts';
import type { StoryWorldState } from './story-world.ts';
import type { StoryCondition } from './story-condition.ts';

export interface StoryCurtain { opacity: number; color: number }

export interface StoryCastMember {
  id: string;
  actor: string;
  worldEntityId?: string;
  characterId?: string;
  inheritPosition?: boolean;
  /** 尚未获得场内位置；保留离场坐标，走位不能凭空把它带入场内。 */
  unpositioned?: boolean;
  x: number;
  y: number;
  facing: Facing;
  visible: boolean;
}

export interface StoryStage extends TravelDestination {
  type: 'stage';
  /** 未声明切图时沿用触发现场；map 仅供内容预览和资源检查。 */
  mapFromWorld?: boolean;
  /** 原版切图重新加载本图角色，继承来源改用到达地图的世界投影。 */
  resetActors?: boolean;
  playerVisible: boolean;
  retainPlayerPosition?: boolean;
  cast: StoryCastMember[];
  /** 检查点镜头中心，单位为地图像素。 */
  camera?: { x: number; y: number };
  curtain?: StoryCurtain;
  audio?: { music: string | null; ambience: string | null };
}

export type PerformanceAction =
  | StoryStage
  | { type: 'appear'; target: string; x: number; y: number; facing: Facing }
  /** 原地显形：不改变位置，只让已经站在台上但不可见的角色出现。 */
  | { type: 'show'; target: string }
  | { type: 'leave'; target: string }
  | { type: 'walk'; target: string; x: number; y: number; speedPxPerSecond: number; followCamera?: boolean }
  | { type: 'face'; target: string; facing: Facing }
  /** `hold` 表示动作播完停在末帧不回待机；原版按 `ACTDATABASE +4` 决定（见 findings 183）。 */
  | { type: 'pose'; target: string; pose: 'idle' | 'attack' | StoryPose; durationMs: number; hold?: boolean }
  | { type: 'effect'; target: string; effect: string }
  | { type: 'sound'; sound: string }
  | { type: 'instant-message'; text: string }
  | { type: 'refresh-appearance' }
  | { type: 'stop-audio' }
  | { type: 'music'; sound: string | null }
  | { type: 'camera'; target: string; motion: 'cut' | 'pan' }
  | { type: 'camera-point'; x: number; y: number; motion: 'cut' | 'pan' }
  | { type: 'fade'; opacity: number; color: number; durationMs: number }
  /** 地点特效：在地图像素坐标放一次效果，不绑定演员（原版命令 `0x4b`）。 */
  | { type: 'location-effect'; effect: string; x: number; y: number }
  /** 地图效果开关：开关世界层的褪色色调（原版命令 `0x32`／`0x33`）。 */
  | { type: 'map-effect'; enabled: boolean }
  | { type: 'wait'; durationMs: number }
  | { type: 'parallel'; actions: PerformanceAction[] };

/** 跳过仅结束表现等待；取消终止整段播放。 */
export interface PerformancePlayback {
  signal: AbortSignal;
  skipSignal: AbortSignal;
}

export interface StoryPresentationPort {
  /** `deferFirstStage`：首幕舞台动作由随后的 `execute` 画出，避免同一张舞台图建两次。 */
  begin(signal?: AbortSignal, stage?: StoryStage, initialCurtain?: StoryCurtain, deferFirstStage?: boolean): void | Promise<void>;
  prefetchMap?(map: string): void;
  execute(action: Exclude<PerformanceAction, { type: 'parallel' }>, playback: PerformancePlayback): Promise<void>;
  parallel?(actions: PerformanceAction[], playback: PerformancePlayback): Promise<void>;
  finish(completed: boolean, signal?: AbortSignal): Promise<void>;
  getStageState?(): StoryStage | undefined;
  getWorldChanges?(): readonly import('./story-world.ts').StoryEntityState[];
  restoreStage?(stage: StoryStage, signal: AbortSignal): Promise<void>;
  release?(): void | Promise<void>;
}

export function performanceTargets(action: PerformanceAction): string[] {
  if (action.type === 'parallel') return action.actions.flatMap(performanceTargets);
  if (action.type === 'camera' || action.type === 'camera-point') return ['camera'];
  if (action.type === 'fade') return ['fade'];
  if (action.type === 'music') return ['music'];
  if (action.type === 'walk' && action.followCamera) return [action.target, 'camera'];
  if ('target' in action && action.type !== 'effect') return [action.target];
  return [];
}

/**
 * 剧情命令 `0x32` 打开的地图效果：原版 `MAP_SetEffect(1)` 写 `MAP_nBaseEffect=1`，此后每帧
 * 把世界层包进 `GRP_AddColorTone(2,0)`——按 BT.601 亮度重新着色（见 findings 181 的 F-04）。
 * 4×5 行主序，Phaser 的 `ColorMatrix` 直接读它；系数据原版逐像素式
 * `L = (77R + 151G + 28B) >> 8`、`R' = B' = 230L >> 8`、`G' = 220L >> 8` 展开。
 */
export const mapEffectTone: number[] = [
  17710 / 65536, 34730 / 65536, 6440 / 65536, 0, 0,
  16940 / 65536, 33220 / 65536, 6160 / 65536, 0, 0,
  17710 / 65536, 34730 / 65536, 6440 / 65536, 0, 0,
  0, 0, 0, 1, 0,
];

/** 原版短距离每逻辑帧移动 12 像素，长距离按距离的十分之一移动。 */
export function cameraDuration(distance: number): number {
  if (distance < .01) return 0;
  const step = distance > 120 ? Math.floor(distance / 10) : 12;
  return Math.ceil(distance / step) * 60;
}


/** 把当前场景声明变成可独立保存的具体舞台；没有匹配实例的引用保持隐藏。 */
export function resolveStoryStage(declaration: StoryStage, current: StoryStage, arrival: readonly StoryCastMember[] = []): StoryStage {
  if (!declaration.mapFromWorld && !declaration.cast.some(member=>member.inheritPosition||member.characterId)) return declaration;
  const { mapFromWorld: _, ...stage } = declaration;
  const source=declaration.mapFromWorld || (!declaration.resetActors && declaration.map===current.map) ? current.cast : arrival;
  const cast = stage.cast.map(member => {
    const { inheritPosition, ...value } = member;
    // 当前舞台没有这个人物时，用到达地图的世界投影补上：同一张图重播、或上一幕的
    // 舞台把人物收起后，不能因为 current.cast 里缺人就把她判成「不在场」。
    const find = (actors: readonly StoryCastMember[]) => actors.find(actor =>
      member.characterId ? actor.characterId === member.characterId : actor.actor === member.actor);
    const found = find(source) ?? (source === arrival ? undefined : find(arrival));
    if (!inheritPosition) return found?.worldEntityId ? {...value,worldEntityId:found.worldEntityId}:value;
    return found ? { ...value, x: found.x, y: found.y, facing: found.facing, visible: found.visible,
      unpositioned:found.unpositioned,worldEntityId:found.worldEntityId }
      : { ...value, visible: false };
  });
  return { ...stage, map: declaration.mapFromWorld ? current.map : declaration.map,
    ...(stage.retainPlayerPosition ? { x: current.x, y: current.y, facing: current.facing } : {}), cast };
}

/** 舞台切图只读取到达地图的真实角色投影，不改变正式地图访问。 */
export function storyStageWorldCast(map:WorldMap,placements:readonly CampaignPlacement[],world:Pick<StoryWorldState,'projectEntities'|'visible'|'visit'|'currentLocation'>,
  evaluate:(condition:StoryCondition)=>boolean,resetActors=false):StoryCastMember[]{
  const authored=placements.filter(entity=>entity.map===map.id);
  const base=map.entities.filter(entity=>!authored.some(other=>other.characterId&&entity.characterId
    ?other.characterId===entity.characterId:other.actor===entity.actor));
  const visit=world.visit+(resetActors||world.currentLocation?.map!==map.id?1:0);
  return world.projectEntities(map.id,[...base,...authored],placements,visit)
    .filter(entity=>world.visible(entity.id,visit)&&(!('condition' in entity)||evaluate(entity.condition as StoryCondition)))
    .map(entity=>({id:entity.id,worldEntityId:entity.id,actor:entity.actor,characterId:entity.characterId,x:entity.x,y:entity.y,
      facing:('facing' in entity?entity.facing as Facing:undefined)??(entity.flip?'east':'west'),visible:true}));
}
