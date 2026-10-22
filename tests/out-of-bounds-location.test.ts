import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type { Campaign } from '../src/domain/campaign.ts';
import type { MapExit } from '../src/domain/content.ts';
import {Session, type MapBoundary} from '../src/domain/session.ts';

const campaign=JSON.parse(readFileSync(new URL('../public/content/campaign.json',import.meta.url),'utf8')) as Campaign;
const exit=(x:number,y:number):MapExit=>({x,y,width:16,height:16,destination:'test-map',spawn:{x:0,y:0},exitFacing:'any',facing:'south'});
const boundary=(overrides:Partial<MapBoundary>={}):MapBoundary=>({width:560,height:480,exits:[exit(48,48)],...overrides});

/** 用原版出口坐标越界时的样子：落点 (616,88) 超出 560x480。 */
const placeAt=(session:Session,x:number,y:number):void=>{
  session.applyStoryCommands([{type:'travel',destination:{map:'test-map',x,y,facing:'south'}}]);
};

test('a location past the map edge lands on the first exit cell',()=>{
  const session=new Session(campaign);
  placeAt(session,616,88);
  session.enterMap('test-map',[],boundary({exits:[exit(48,48),exit(200,300)]}));
  const location=session.storyWorld.currentLocation!;
  assert.deepEqual({x:location.x,y:location.y},{x:56,y:56});
});

test('a location before the map origin is revised too',()=>{
  const session=new Session(campaign);
  placeAt(session,0,0);
  session.enterMap('test-map',[],boundary());
  assert.deepEqual({x:session.storyWorld.currentLocation!.x,y:session.storyWorld.currentLocation!.y},{x:56,y:56});
});

test('a map without exits falls back to its centre',()=>{
  const session=new Session(campaign);
  placeAt(session,616,88);
  session.enterMap('test-map',[],boundary({exits:[]}));
  assert.deepEqual({x:session.storyWorld.currentLocation!.x,y:session.storyWorld.currentLocation!.y},{x:280,y:240});
});

test('a location inside the map is left alone',()=>{
  const session=new Session(campaign);
  placeAt(session,300,200);
  session.enterMap('test-map',[],boundary());
  assert.deepEqual({x:session.storyWorld.currentLocation!.x,y:session.storyWorld.currentLocation!.y},{x:300,y:200});
});

test('entering without a boundary keeps the plain travel behaviour',()=>{
  const session=new Session(campaign);
  placeAt(session,616,88);
  session.enterMap('test-map');
  assert.deepEqual({x:session.storyWorld.currentLocation!.x,y:session.storyWorld.currentLocation!.y},{x:616,y:88});
});
