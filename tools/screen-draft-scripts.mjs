/**
 * 逐段筛选批量生成的演出草稿：用游戏自己的演出校验器判断哪些段落能落地。
 *
 * 校验器是「第一个错误就抛」的，所以不能一次性把几百段灌进去试；这里每段单独放进一份
 * 只含它自己的内容里跑一遍，产出可落地清单 `work/game-content/story-draft-screen.json`。
 * `work/tools/game_content/promote_story_drafts.py` 按这份清单决定合入哪些段。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseWorld, parseMap} from '../src/application/content-validation.ts';
import {validateStoryPerformance} from '../src/application/story-performance-validation.ts';
import {validateStoryGraph} from '../src/domain/story-graph.ts';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const draftPath = fileURLToPath(new URL('../../work/game-content/story-scripts-draft.json', import.meta.url));
const outputPath = fileURLToPath(new URL('../../work/game-content/story-draft-screen.json', import.meta.url));

const world = parseWorld(read('content/world.json'));
// 这里只筛演出草稿；合入后的整份内容由 validate:content 校验。
// 新任务可以先引用本轮草稿将写入的状态，避免中间产物形成发布先后循环。
const campaign = read('content/campaign.json');
const maps = new Map();
for (const reference of world.maps) { const map = parseMap(read(reference.file)); maps.set(map.id, map); }

const draftText = fs.readFileSync(draftPath, 'utf8');
const draft = JSON.parse(draftText);
const accepted = [], rejected = [];
for (const [name, script] of Object.entries(draft.scripts)) {
  const probe = {...campaign, scripts: {[name]: script}, events: []};
  try { validateStoryGraph(probe); validateStoryPerformance(world, probe, maps); accepted.push(name); }
  catch (error) { rejected.push({script: name, reason: error instanceof Error ? error.message : String(error)}); }
}
fs.writeFileSync(outputPath, `${JSON.stringify({version: 2, draftSha256: createHash('sha256').update(draftText).digest('hex'), accepted, rejected}, null, 2)}\n`);
const reasons = new Map();
for (const item of rejected) reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
console.log(`草稿 ${Object.keys(draft.scripts).length} 段：可落地 ${accepted.length}，被拒 ${rejected.length}`);
for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`  ${count} × ${reason}`);
