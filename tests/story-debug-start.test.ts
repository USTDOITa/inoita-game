import assert from 'node:assert/strict';
import test from 'node:test';
import { playthrough } from './helpers/story-playthrough.ts';
import { prepareTaskStart } from '../src/debug/story-jump.ts';
import { questJournal } from '../src/domain/quest-journal.ts';
import type { QuestStatus } from '../src/domain/content.ts';

/**
 * 现场表的全量安装检查：每条任务都在干净会话上套表，安装后必须
 * 停在固定点、焦点只显示目标、落点与表一致。这里不启动演出。
 */
test('every exported task start table installs as a fixed point', async () => {
  const h = playthrough();
  try {
    const tasks = h.session.campaign.debugStory!.tasks;
    assert.equal(tasks.length, 487, `任务目录应有 487 条，实际 ${tasks.length}`);
    const base = h.session.captureState();
    const failures: string[] = [];
    for (const task of tasks) {
      try {
        h.session.restoreState(base);
        const prepared = await prepareTaskStart(h.session, { quest: task.quest });
        h.session.restoreState(prepared);
        for (const event of h.session.campaign.events)
          if (event.source === 'start')
            assert.ok(h.session.runtimeState.completedEvents.includes(event.id),
              `${task.quest}: 缺少整局开场事件 ${event.id}`);
        const start = task.start;
        assert.ok(start, '缺少现场表');
        const declared = start.quests?.find(row => row.id === task.quest)?.status;
        const status = h.session.status(task.quest);
        if (declared) assert.equal(status, declared, `目标状态 ${status}，现场表声明 ${declared}`);
        else assert.ok((['available', 'active', 'ready'] as QuestStatus[]).includes(status),
          `目标没有现场表条目时不能是 ${status}`);
        assert.equal(h.session.debugFocusQuest, task.quest);
        const ids = questJournal(h.session.campaign, h.session.quests, h.session.debugFocusQuest)
          .flatMap(group => group.entries.map(entry => entry.quest.id));
        assert.deepEqual(ids, [task.quest], '焦点任务日志只能显示目标');
        const location = start.world!.location;
        assert.deepEqual(h.session.storyWorld.currentLocation, {
          map: location.map, x: location.x, y: location.y, facing: location.facing,
        });
      } catch (error) {
        failures.push(`${task.quest}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    assert.deepEqual(failures, []);
  } finally {
    h.director.dispose();
  }
});
