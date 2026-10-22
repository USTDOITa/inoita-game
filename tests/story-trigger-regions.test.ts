import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { within } from '../src/domain/navigation.ts';
import type { Campaign } from '../src/domain/campaign.ts';

/**
 * 区域触发点必须照原版事件表落位。
 *
 * 原版 EVTCONDBASE 的条件 `type 0 = map_and_player_rect` 给出「地图号 + 玩家所在格矩形」：
 * param2 的四字节依次是 [maxY, maxX, minY, minX]，判定 minX<=X<=maxX 且 minY<=Y<=maxY，
 * X/Y 是玩家坐标右移 4 位的格号（1 格 = 16 像素）。下面每条期望值都从原始参数解出，
 * 且与 site/data/events_structured.json 的 conditions 对得上。
 *
 * 这些坐标曾经被手写改偏：洞穴对峙的矩形左边界从格 3 挪到格 2，把进图落点圈了进去，
 * 玩家一进图、人还贴着出口就开演。现在洞穴对峙（事件 4）改成进图触发，不再按矩形判定，
 * 这条偏离由体验版验收决定（进图即演，主角到台词再显形）；其余区域触发的矩形仍照原版钉住。
 */
const campaign = JSON.parse(readFileSync(new URL('../public/content/campaign.json', import.meta.url), 'utf8')) as Campaign;
const mapsDirectory = new URL('../public/content/maps/', import.meta.url);
interface MapFile {
  id: string; width: number; height: number;
  exits: { x: number; y: number; width: number; height: number; destination: string; spawn: { x: number; y: number } }[];
}
interface Rectangle { x: number; y: number; width: number; height: number }

/** 原版事件号 → 地图号、格矩形、像素矩形的换算结果。 */
const nativeRegions: Record<string, { event: number; map: string; cells: string; rect: Rectangle }> = {
  // 事件 1：地图 0，格 X24, Y19–22；演出随后由 `0x0a` 切到地图 30（丛林西）
  'event-1': { event: 1, map: 'shadow-camp', cells: 'X24, Y19–22', rect: { x: 384, y: 304, width: 16, height: 64 } },
  // 事件 2：地图 30，格 X37–39, Y38–44
  'event-2': { event: 2, map: 'shadow-forest-west', cells: 'X37–39, Y38–44', rect: { x: 592, y: 608, width: 48, height: 112 } },
  // 事件 3：地图 31，格 X36–37, Y25–27
  'event-3': { event: 3, map: 'shadow-forest-east', cells: 'X36–37, Y25–27', rect: { x: 576, y: 400, width: 32, height: 48 } },
  // 事件 7：地图 37，格 X39–41, Y7
  'event-7': { event: 7, map: 'berkel-capital', cells: 'X39–41, Y7', rect: { x: 624, y: 112, width: 48, height: 16 } }
};

const regionEvents = campaign.events.filter(event => event.source === 'region');
const readMap = (id: string): MapFile => JSON.parse(readFileSync(new URL(`${id}.json`, mapsDirectory), 'utf8')) as MapFile;
/** 从其它地图进入某图的落点：别的图的出口记着 destination 与 spawn。 */
const entriesInto = (map: string): { from: string; point: { x: number; y: number } }[] => {
  const points: { from: string; point: { x: number; y: number } }[] = [];
  for (const file of readdirSync(mapsDirectory)) {
    if (!file.endsWith('.json')) continue;
    const source = JSON.parse(readFileSync(new URL(file, mapsDirectory), 'utf8')) as MapFile;
    for (const exit of source.exits) if (exit.destination === map) points.push({ from: source.id, point: exit.spawn });
  }
  return points;
};

// 表里这几条是第一个任务线的触发点，逐一钉住；批量接入的其它触发点由各自的来源核对，
// 不在这张表里断言（它们没有写死在这里的原版依据）。
test('the main quest region triggers carry the map and rectangle decoded from the native event table', () => {
  for (const [id, expected] of Object.entries(nativeRegions)) {
    const event = regionEvents.find(candidate => candidate.id === id);
    assert.ok(event, `区域事件 ${id} 不在内容里`);
    assert.equal(event.map, expected.map, `${id} 的地图应为 ${expected.map}`);
    assert.deepEqual(event.region, expected.rect, `${id} 的矩形应为原版事件 ${expected.event}（格 ${expected.cells}）换算的像素值`);
  }
});

test('every native region intersects its original map even when the source rectangle crosses an edge', () => {
  for (const event of regionEvents) {
    const map=readMap(event.map!),region=event.region!;
    assert.ok(region.x<map.width&&region.y<map.height&&region.x+region.width>0&&region.y+region.height>0,
      `${event.id} 的原版矩形与 ${event.map} 没有可达的相交范围`);
  }
  const event=regionEvents.find(event=>event.id==='event-180')!;
  assert.equal(event.map,'empire-capital-alley-5-30743650');
  assert.deepEqual(event.region,{x:0,y:304,width:16,height:112});
});

test('native entrance triggers keep the original rectangle even when it covers a map entry', () => {
  // EVTCONDBASE 事件20：param2=320869920，格X19–22、Y32。
  const event=regionEvents.find(event=>event.id==='event-20')!;
  assert.equal(event.map,'hakan-desert-2-95444e0c');
  assert.deepEqual(event.region,{x:304,y:512,width:64,height:16});
  const entry=entriesInto(event.map!).find(entry=>entry.from==='hakan-desert-3-60e61eaf')!;
  assert.deepEqual(entry.point,{x:328,y:520});
  assert.equal(within(entry.point,event.region!),true);
});

test('the cave confrontation fires on entering the map, wherever the player lands', () => {
  const event = campaign.events.find(candidate => candidate.id === 'event-4')!;
  // 体验版验收决定：洞穴对峙不等玩家走进原版矩形，进图就起演；主角到 `show` 才显形。
  // 原版依据是 EVTCONDBASE 事件 4（地图 33，格 X3, Y9–13），这里不再按像素矩形判定。
  assert.equal(event.source, 'map-entry');
  assert.equal(event.map, 'silent-cave-depths');
  assert.equal(event.key, undefined, '进图事件不带触发键，任何进图方式都算');
  assert.equal(event.region, undefined, '不再按区域判定');
});

test('the forest ambush sits on the way from the forest entrance to the eastern doorway', () => {
  const region = regionEvents.find(event => event.id === 'event-2')!.region!;
  const spawn = entriesInto('shadow-forest-west').find(entry => entry.from === 'shadow-camp')!.point;
  const doorways = readMap('shadow-forest-west').exits.filter(exit => exit.destination === 'shadow-forest-east');
  assert.ok(doorways.length, '丛林西没有通往丛林东的出口');
  const crossed = doorways.some(doorway => {
    for (let step = 0; step <= 100; step++) {
      const t = step / 100;
      const point = { x: spawn.x + (doorway.x - spawn.x) * t, y: spawn.y + (doorway.y - spawn.y) * t };
      if (within(point, region)) return true;
    }
    return false;
  });
  assert.ok(crossed, '从丛林西入口走向东侧出口的路上碰不到圣女逃亡的触发区，玩家永远等不到这场演出');
});

test('the cave pursuit fires on the doorway that leads into the cave', () => {
  const region = regionEvents.find(event => event.id === 'event-3')!.region!;
  const doorways = readMap('shadow-forest-east').exits.filter(exit => exit.destination === 'silent-cave-entrance');
  assert.ok(doorways.length, '丛林东没有通往洞穴入口的出口');
  for (const door of doorways) {
    const point = { x: door.x + door.width / 2, y: door.y + door.height / 2 };
    assert.equal(within(point, region), true, `通往洞穴的门口 (${point.x},${point.y}) 不在追击的触发区里`);
  }
});
