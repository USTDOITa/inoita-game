import type { PlacedEnemy, EnemyDefinition } from './battle.ts';
import { EnemyRoster } from './enemy-roster.ts';
import type { CampaignEnemyPlacement, EnemySpawn, WorldMap } from './content.ts';
import type { Session } from './session.ts';
import type { StoryEncounter } from './story-world.ts';

export type WorldSpawn = EnemySpawn | CampaignEnemyPlacement;

export interface QuestEnemySnapshot {
  revision: number;
  ids: ReadonlySet<string>;
}

/** 任务关键敌人的只读来源；由组合根提供，名册不依赖战役与掉落目录。 */
export interface QuestEnemyProvider {
  snapshot(): QuestEnemySnapshot;
}

export interface MapSpawnSelectionOptions {
  /** active 任务的关键敌人：无论档位都保留。 */
  questEnemies?: ReadonlySet<string>;
  /** 当前剧情下这个站位是否还有出现资格；不得读取死亡/刷新计时。 */
  spawnable?: (spawn: WorldSpawn) => boolean;
}

/**
 * 按主角等级选择地图的敌人档位。
 *
 * 复刻规则：取不超过主角等级的最高档，低于全部档位时用最低档；达到下一档
 * 代表等级才切换。active 任务的关键敌人无视档位保留。整个静态选择在当前
 * 剧情下都不可生成时，只向更低的一档回退一次，避免提前放出未来章节的敌人。
 *
 * 不触碰 Session；`spawnable` 只用于判断剧情资格，临时死亡和刷新计时不参与。
 */
export function selectMapSpawns(map:WorldMap,questSpawns:readonly CampaignEnemyPlacement[],heroLevel:number,
  options:MapSpawnSelectionOptions={}):WorldSpawn[]{
  const raw=map.enemySpawns??[];
  const tiers=[...new Set(raw.flatMap(spawn=>spawn.tierLevel===undefined?[]:[spawn.tierLevel]))]
    .sort((a,b)=>a-b);
  if(!tiers.length)return [...raw,...questSpawns];

  let selected=tiers[0]!;
  for(const tier of tiers)if(tier<=heroLevel)selected=tier;

  const questEnemies=options.questEnemies,spawnable=options.spawnable??(()=>true);
  const chosen=new Set<number>();
  raw.forEach((spawn,index)=>{
    if(spawn.tierLevel===undefined||spawn.tierLevel===selected||questEnemies?.has(spawn.enemyId))
      chosen.add(index);
  });

  const base=[...chosen].map(index=>raw[index]!);
  if(![...base,...questSpawns].some(spawnable)){
    // 只补更低的一档，并用它替换不可用的选中档；没有低档可用就保持空图，由名册记录诊断。
    for(const tier of tiers.filter(value=>value<selected).reverse()){
      const indices=raw.flatMap((spawn,index)=>spawn.tierLevel===tier?[index]:[]);
      if(!indices.some(index=>spawnable(raw[index]!)))continue;
      raw.forEach((spawn,index)=>{
        if(spawn.tierLevel===selected&&!questEnemies?.has(spawn.enemyId))chosen.delete(index);
      });
      for(const index of indices)chosen.add(index);
      break;
    }
  }
  return [...raw.filter((_,index)=>chosen.has(index)),...questSpawns];
}

/** One map's enemy roster. Stable spawn IDs and combat resources live in Session. */
export class WorldEnemyRoster extends EnemyRoster {
  readonly session:Session;
  private readonly mapId:string;
  private readonly rawMapSpawns:readonly WorldSpawn[];
  private readonly bandSpawns:readonly WorldSpawn[];
  private readonly mapSpawnIds:ReadonlySet<string>;
  private readonly heroLevel:number;
  private readonly questEnemies?:QuestEnemyProvider;
  /** 本次进图累计的任务关键敌人；只增不减，避免任务完成时撤掉正在交战的怪。 */
  private readonly questSpawnIds=new Set<string>();
  private emptyReported=false;
  get spawns(): readonly WorldSpawn[] {
    this.collectQuestSpawns();
    const extras=this.questSpawnIds.size
      ? this.rawMapSpawns.filter(spawn=>this.questSpawnIds.has(spawn.enemyId)&&!this.mapSpawnIds.has(spawn.id))
      : [];
    return [...this.bandSpawns.filter(spawn=>this.session.storyWorld.enemyAvailable(this.mapId,spawn.enemyId)),
      ...extras.filter(spawn=>this.session.storyWorld.enemyAvailable(this.mapId,spawn.enemyId)),
      ...this.session.storyWorld.enemySpawns(this.mapId),...this.session.chests.spawns,...this.session.storyWorld.activeEncounters
      .filter(encounter=>encounter.map===this.mapId).flatMap(encounter=>encounter.spawns.map(spawn=>({
        ...spawn,id:encounterSpawnId(encounter.id,spawn.id),respawn:false as const
      })))];
  }
  private readonly sources = new Map<string,WorldSpawn>();
  constructor(session:Session,map:WorldMap,questSpawns:readonly CampaignEnemyPlacement[],heroLevel:number,
    questEnemies?:QuestEnemyProvider){
    super();
    this.session=session;
    this.mapId=map.id;
    this.heroLevel=heroLevel;
    this.questEnemies=questEnemies;
    this.rawMapSpawns=map.enemySpawns??[];
    session.enterMap(map.id,map.questItemSpawns??[],map);
    this.setPartySize(session.party?.activeSize??1,[]);
    this.collectQuestSpawns();
    this.bandSpawns=selectMapSpawns(map,questSpawns,heroLevel,{
      questEnemies:this.questSpawnIds,spawnable:spawn=>this.storySpawnable(spawn)});
    this.mapSpawnIds=new Set(this.bandSpawns.map(spawn=>spawn.id));
    for(const spawn of this.spawns)this.sources.set(spawn.id,spawn);
    this.refresh();
  }
  source(id:string):WorldSpawn|undefined{return this.sources.get(id);}
  completedEncounters():readonly StoryEncounter[]{
    return this.session.storyWorld.activeEncounters.filter(encounter=>encounter.map===this.mapId&&encounter.spawns.length>0&&
      encounter.spawns.every(spawn=>{const state=this.session.enemyVitals(encounterSpawnId(encounter.id,spawn.id));
        return state.deadUntil!==undefined&&!state.capture;}));
  }
  override setPartySize(size:number,definitions:readonly EnemyDefinition[]):void{
    if(size===this.partySize)return;
    super.setPartySize(size,definitions);
    for(const placed of this.enemies){const definition=definitions.find(enemy=>enemy.id===placed.enemyId);
      if(!definition)continue;
      const snapshot=this.enemySnapshot(placed.key,definition,this.session.hero?.level??1);
      if(snapshot)this.session.setEnemyVitals(placed.key,snapshot.health,snapshot.mana);
    }
  }
  refresh():{added:PlacedEnemy[];removed:string[]}{
    const added:PlacedEnemy[]=[],removed:string[]=[];
    const spawns=this.spawns,active=new Set(spawns.map(spawn=>spawn.id));
    for(const placed of [...this.enemies]){
      const spawn=this.sources.get(placed.key);
      if(spawn&&(!active.has(spawn.id)||!this.session.canSpawnEnemy(spawn))){super.removeEnemy(placed.key);removed.push(placed.key);}
    }
    for(const spawn of spawns){
      this.sources.set(spawn.id,spawn);
      if(!this.session.canSpawnEnemy(spawn)||this.enemies.some(enemy=>enemy.key===spawn.id))continue;
      const vitals=this.session.enemyVitals(spawn.id);
      const placed:PlacedEnemy={key:spawn.id,enemyId:spawn.enemyId,x:spawn.x,y:spawn.y,health:vitals.health,mana:vitals.mana};
      this.restoreEnemy(placed);added.push(placed);
    }
    this.recordEmptyDiagnostic(spawns);
    return {added,removed};
  }
  override setEnemyHealth(key:string,value:number,definition:EnemyDefinition):void {
    super.setEnemyHealth(key,value,definition);
    const snapshot=this.enemySnapshot(key,definition,this.session.hero?.level??1);
    if(snapshot)this.session.setEnemyVitals(key,snapshot.health,snapshot.mana);
  }
  override setEnemyMana(key:string,value:number,definition:EnemyDefinition):void {
    super.setEnemyMana(key,value,definition);
    const snapshot=this.enemySnapshot(key,definition,this.session.hero?.level??1);
    if(snapshot)this.session.setEnemyVitals(key,snapshot.health,snapshot.mana);
  }
  private collectQuestSpawns():void{
    const snapshot=this.questEnemies?.snapshot();
    if(snapshot)for(const id of snapshot.ids)this.questSpawnIds.add(id);
  }
  /** 剧情资格：active 任务槽、剧情可见性、敌人可用性；刻意不看死亡/刷新计时。 */
  private storySpawnable(spawn:WorldSpawn):boolean{
    if('activeQuest' in spawn&&this.session.status(spawn.activeQuest)!=='active')return false;
    return this.session.storyWorld.visible(spawn.id)&&this.session.storyWorld.enemyAvailable(this.mapId,spawn.enemyId);
  }
  private recordEmptyDiagnostic(spawns:readonly WorldSpawn[]):void{
    if(this.emptyReported||this.enemies.length||!this.rawMapSpawns.length)return;
    if(spawns.some(spawn=>this.storySpawnable(spawn)))return;
    this.emptyReported=true;
    globalThis.storyDiagnostics?.record('map-enemies-empty',{
      map:this.mapId,heroLevel:this.heroLevel,tiers:this.tiers(),
      spawns:spawns.length,quests:this.session.questBook.runningQuestIds
        .filter(id=>this.session.questBook.status(id)==='active'),
    });
  }
  private tiers():number[]{
    return [...new Set(this.rawMapSpawns.flatMap(spawn=>spawn.tierLevel===undefined?[]:[spawn.tierLevel]))]
      .sort((a,b)=>a-b);
  }
}

/** Each encounter occurrence owns separate combat resources, even on the same map. */
export function encounterSpawnId(encounter:string,spawn:string):string{return `${encounter}:${spawn}`;}

/** 剧情移除以当前实例为准；它不产生玩家击杀、奖励或掉落。 */
export function applyStoryEnemyRemovals(session:Session,map:string,enemies:readonly Pick<PlacedEnemy,'key'|'enemyId'>[],remove:(key:string)=>void):void {
  const removed=new Set<string>();
  for(const command of session.storyWorld.pendingEnemyRemovals){
    if(command.map&&command.map!==map)continue;
    const matches=enemies.filter(enemy=>!removed.has(enemy.key)&&enemy.enemyId===command.enemyId);
    for(const enemy of command.all?matches:matches.slice(0,1)){
      session.removeStoryEnemy(enemy.key);remove(enemy.key);removed.add(enemy.key);
    }
  }
  session.storyWorld.consumeEnemyRemovals();
}
