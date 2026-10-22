import type { CampaignQuest } from './campaign.ts';
import type { DropCatalog } from './drops.ts';
import type { Session } from './session.ts';
import type { QuestEnemyProvider, QuestEnemySnapshot } from './world-enemies.ts';

/**
 * 汇总当前进行中任务需要的敌人：
 * - 击杀目标；
 * - 削弱/转化目标（targetChanges）；
 * - 任务物品在 drops.questItems 里的所有掉落来源。
 *
 * 按任务簿版本缓存；版本未变时直接返回同一个 Set。任务接取、完成、物品
 * 进度变化都会推进版本，下一次读取自动重算。
 */
export class QuestEnemyWatch implements QuestEnemyProvider {
  private readonly session:Pick<Session,'questBook'|'campaign'>;
  private readonly definitions:ReadonlyMap<string,CampaignQuest>;
  private readonly itemSources:ReadonlyMap<string,ReadonlySet<string>>;
  private revision=-1;
  private ids:ReadonlySet<string>=new Set();

  constructor(session:Pick<Session,'questBook'|'campaign'>,questItems:DropCatalog['questItems']){
    this.session=session;
    this.definitions=new Map(session.campaign.quests.map(quest=>[quest.id,quest]));
    const sources=new Map<string,Set<string>>();
    for(const [enemyId,rules] of Object.entries(questItems)){
      for(const rule of rules){
        const enemies=sources.get(rule.item)??new Set<string>();
        enemies.add(enemyId);sources.set(rule.item,enemies);
      }
    }
    this.itemSources=sources;
  }

  snapshot():QuestEnemySnapshot{
    const book=this.session.questBook;
    if(book.version===this.revision)return {revision:this.revision,ids:this.ids};

    const ids=new Set<string>();
    for(const id of book.runningQuestIds){
      if(book.status(id)!=='active')continue;
      const quest=this.definitions.get(id);
      if(!quest)continue;
      for(const goal of quest.goals){
        if(goal.kind==='defeat')ids.add(goal.target);
        else if(goal.kind==='item')
          for(const enemyId of this.itemSources.get(goal.target)??[])ids.add(enemyId);
      }
      for(const change of quest.targetChanges??[])ids.add(change.enemyId);
    }

    this.revision=book.version;
    this.ids=ids;
    return {revision:this.revision,ids:this.ids};
  }
}
