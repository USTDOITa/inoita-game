import type { SceneActorState, SceneSnapshot } from './scene-snapshot.ts';
import type { PerformanceAction, StoryCastMember, StoryStage, StoryStageSnapshot } from './story-performance.ts';
import {faceTarget} from './basic-attack.ts';

/** 先按实例找人，再按人物/队员/怪物身份查找。外观只能用于没有身份的手写演员。 */
export function findSceneActor(scene: SceneSnapshot, member: StoryCastMember): SceneActorState | undefined {
  if (member.worldEntityId) return scene.actors.find(actor => !actor.removed && actor.worldEntityId === member.worldEntityId);
  const matches = scene.actors.filter(actor => !actor.removed && (member.memberId ? actor.memberId === member.memberId
    : member.characterId ? actor.characterId === member.characterId
    : member.enemyId ? actor.enemyId === member.enemyId : actor.actor === member.actor));
  return matches.find(actor => !actor.unpositioned) ?? matches[0];
}

function newId(scene: SceneSnapshot, alias: string): string {
  const base = `story:${alias}`;
  let id = base, index = 1;
  while (scene.actors.some(actor => actor.id === id)) id = `${base}:${index++}`;
  return id;
}

function actorFrom(member: StoryCastMember, id: string): SceneActorState {
  return { id, actor: member.actor, characterId: member.characterId, worldEntityId: member.worldEntityId,
    memberId: member.memberId, enemyId: member.enemyId, x: member.x, y: member.y, facing: member.facing,
    visible: member.visible, unpositioned: member.unpositioned };
}

/** 把别名的读回值和玩家落点同步到完整场景；场景对象本身只存一份。 */
export function syncStoryScene(snapshot: StoryStageSnapshot): StoryStageSnapshot {
  const bindings = new Map(snapshot.bindings);
  const player = snapshot.scene.actors.find(actor => actor.id === bindings.get('player'));
  if (!player) throw new Error('剧情场景缺少主角');
  snapshot.x = player.x; snapshot.y = player.y; snapshot.facing = player.facing; snapshot.playerVisible = player.visible;
  snapshot.cast = snapshot.cast.map(member => {
    const actor = snapshot.scene.actors.find(actor => actor.id === bindings.get(member.id));
    if (!actor) throw new Error(`剧情演员绑定失效：${member.id}`);
    return { ...member, actor: actor.actor, worldEntityId: actor.worldEntityId, characterId: actor.characterId,
      memberId: actor.memberId, enemyId: actor.enemyId, x: actor.x, y: actor.y, facing: actor.facing,
      visible: actor.visible, unpositioned: actor.unpositioned };
  });
  return snapshot;
}

/** 接管整张场景。演员声明只覆盖明确的手写摆位，不会删除未被脚本引用的对象。 */
export function resolveStoryScene(declaration: StoryStage, source: SceneSnapshot): StoryStageSnapshot {
  const scene = structuredClone(source);
  const player = scene.actors.find(actor => actor.id === 'player');
  if (!player) throw new Error('演出接管时缺少主角');
  if (!declaration.retainPlayerPosition) {
    player.x = declaration.x; player.y = declaration.y; player.facing = declaration.facing;
    player.clip=`idle-${player.facing}`;player.animationProgress=0;player.animationPlaying=true;
  }
  player.visible = declaration.playerVisible;
  const bindings: [string, string][] = [['player', player.id]];
  for (const member of declaration.cast) {
    const referencesWorld=member.binding==='world'||member.inheritPosition||member.worldEntityId||member.characterId||member.memberId||member.enemyId;
    let actor = referencesWorld?findSceneActor(scene, member):undefined;
    if (!actor) {
      actor = actorFrom(member, newId(scene, member.id));
      if (member.binding === 'world' || member.inheritPosition) {
        actor.x = 2048; actor.y = 2048; actor.visible = false; actor.unpositioned = true;
      }
      scene.actors.push(actor);
    } else if (member.binding !== 'world' && !member.inheritPosition) {
      Object.assign(actor, { x: member.x, y: member.y, facing: member.facing, visible: member.visible,
        unpositioned: member.unpositioned,clip:`idle-${member.facing}`,animationProgress:0,animationPlaying:true });
    }
    bindings.push([member.id, actor.id]);
  }
  const { mapFromWorld: _dynamic, resetActors: _reset, ...stage } = declaration;
  return syncStoryScene({ ...stage, map: scene.map, scene, bindings });
}

export function boundSceneActor(snapshot: StoryStageSnapshot, target: string): SceneActorState | undefined {
  const id = snapshot.bindings.find(([alias]) => alias === target)?.[1];
  return snapshot.scene.actors.find(actor => actor.id === id);
}

function bind(snapshot: StoryStageSnapshot, alias: string, actor: SceneActorState): void {
  snapshot.bindings = snapshot.bindings.filter(([name]) => name !== alias);
  snapshot.bindings.push([alias, actor.id]);
}

/** 普通播放与跳过共用动作结束状态；时间、动画和寻路由 Phaser 表现层负责。 */
export function applyStorySceneAction(previous: StoryStageSnapshot, action: PerformanceAction): StoryStageSnapshot {
  if (action.type === 'stage') throw new Error('切换舞台需要先准备目标地图');
  const state = structuredClone(previous);
  if (action.type === 'parallel') {
    return action.actions.reduce<StoryStageSnapshot>((snapshot, child) => applyStorySceneAction(snapshot, child), state);
  }
  if (action.type === 'world-object') {
    const command = action.command;
    if (command.kind === 'place') {
      const entity = command.entity;
      const map = command.mapFromStage ? state.map : entity.map;
      if (map !== state.map) return state;
      const member = action.target ? state.cast.find(member => member.id === action.target) : undefined;
      let actor = state.scene.actors.find(actor => actor.worldEntityId === entity.id)
        ?? (action.mode !== 'create' && member ? findSceneActor(state.scene, member) : undefined);
      if (!actor) {
        actor = { id: `entity:${entity.id}`, actor: entity.actor!, worldEntityId: entity.id,
          characterId: entity.characterId, x: entity.x!, y: entity.y!, facing: entity.facing ?? 'south', visible: true };
        if (state.scene.actors.some(other => other.id === actor!.id)) actor.id = newId(state.scene, entity.id);
        state.scene.actors.push(actor);
      }
      const appearanceChanged=actor.actor!==entity.actor;
      Object.assign(actor, { actor: entity.actor!, worldEntityId:entity.id, characterId: entity.characterId, x: entity.x!, y: entity.y!,
        facing: entity.facing ?? actor.facing, visible: entity.visible !== false, unpositioned: false, removed:false });
      actor.clip=`idle-${actor.facing}`;actor.animationProgress=0;actor.animationPlaying=true;
      if(appearanceChanged)delete actor.appearance;
      if (action.target) bind(state, action.target, actor);
    } else if (command.kind === 'remove-character') {
      if ((command.mapFromStage ? state.map : command.map) !== state.map) return state;
      const matches = state.scene.actors.filter(actor => actor.characterId === command.characterId && !actor.unpositioned && !actor.removed);
      for (const actor of command.all ? matches : matches.slice(0, 1)) {actor.visible = false;actor.removed=true;}
    } else {
      for (const actor of state.scene.actors) if (actor.worldEntityId === command.id) {
        actor.visible = command.kind === 'show';actor.removed=command.kind==='remove';
      }
    }
    return syncStoryScene(state);
  }
  if (!('target' in action)) return state;
  let actor = boundSceneActor(state, action.target);
  if (!actor) throw new Error(`剧情没有声明对象：${action.target}`);
  if (action.type === 'appear') {
    if (action.mode === 'create' && action.target !== 'player') {
      const member = state.cast.find(member => member.id === action.target)!;
      actor = action.worldEntityId?state.scene.actors.find(actor=>actor.worldEntityId===action.worldEntityId):undefined;
      if(!actor){
        actor = actorFrom(member, newId(state.scene, action.target));
        delete actor.worldEntityId; delete actor.memberId; delete actor.enemyKey;
        state.scene.actors.push(actor);
      }
      bind(state, action.target, actor);
    }
    if(action.worldEntityId)actor.worldEntityId=action.worldEntityId;
    Object.assign(actor, { x: action.x, y: action.y, facing: action.facing, visible: true, unpositioned: false, removed:false });
    actor.clip=`idle-${actor.facing}`;actor.animationProgress=0;actor.animationPlaying=true;
  } else if (action.type === 'leave') actor.visible = false;
  else if (action.type === 'show') { if (!actor.unpositioned && !actor.removed) actor.visible = true; }
  else if (action.type === 'face' && !actor.removed) {
    actor.facing = action.facing;actor.clip=`idle-${actor.facing}`;actor.animationProgress=0;actor.animationPlaying=true;
  }
  else if (action.type === 'pose' && !actor.unpositioned && !actor.removed) {
    actor.clip=`${action.hold?action.pose:'idle'}-${actor.facing}`;
    actor.animationProgress=action.hold?1:0;
    actor.animationPlaying=!action.hold;
  }
  else if (action.type === 'walk' && !actor.unpositioned && !actor.removed) {
    if(actor.x!==action.x||actor.y!==action.y)actor.facing=faceTarget(actor,action);
    actor.x = action.x; actor.y = action.y;
    actor.clip=`idle-${actor.facing}`;actor.animationProgress=0;actor.animationPlaying=true;
  }
  return syncStoryScene(state);
}
