import { describe, expect, it, vi } from 'vitest'
import type { EntityFeature } from '../types/geo'
import { DEFAULT_HIGHLIGHT_STYLE } from './highlightDefaults'
import { fitVisibleScene, sceneBounds, sceneFitPadding, shouldFitVisibleScene } from './sceneFit'
import { SCENE_REFERENCE_HEIGHT, SCENE_REFERENCE_WIDTH } from './presentationScale'

const point = (id: string, coordinates: [number, number], name = id, type: 'place' | 'station' = 'place'): EntityFeature => ({ type:'Feature', properties:{id,name,type}, geometry:{type:'Point',coordinates} })
const line = (id: string, coordinates: [number,number][], name=id, type: 'road' | 'historical-road' | 'railway' = 'road'): EntityFeature => ({ type:'Feature', properties:{id,name,type}, geometry:{type:'LineString',coordinates} })
const size={width:SCENE_REFERENCE_WIDTH,height:SCENE_REFERENCE_HEIGHT}

describe('visible scene fitting',()=>{
  it('includes every checked feature and recomputes when one is removed',()=>{const route=line('route',[[0,0],[5,2]]);const post=point('post',[10,4]);expect(sceneBounds([route,post])).toEqual([[0,0],[10,4]]);expect(sceneBounds([route])).toEqual([[0,0],[5,2]])})
  it('fits two distant points and a mixed checked line/point scene',()=>{const fitBounds=vi.fn();fitVisibleScene({fitBounds} as never,[point('west',[0,0]),point('east',[20,5])],DEFAULT_HIGHLIGHT_STYLE,1,size);expect(fitBounds.mock.calls[0][0]).toEqual([[0,0],[20,5]]);fitVisibleScene({fitBounds} as never,[line('route',[[1,2],[3,4]]),point('post',[8,9])],DEFAULT_HIGHLIGHT_STYLE,1,size);expect(fitBounds.mock.calls[1][0]).toEqual([[1,2],[8,9]])})
  it('limits automatic scene fitting to historical roads and railways',()=>{expect(shouldFitVisibleScene(line('historic',[[0,0],[1,1]],'historic','historical-road'))).toBe(true);expect(shouldFitVisibleScene(line('rail',[[0,0],[1,1]],'rail','railway'))).toBe(true);expect(shouldFitVisibleScene(line('road',[[0,0],[1,1]]))).toBe(false);expect(shouldFitVisibleScene(point('place',[0,0]))).toBe(false);expect(shouldFitVisibleScene(null)).toBe(false)})
  it('uses label width and right anchoring for station padding',()=>{const short=sceneFitPadding([point('s',[0,0],'駅','station')],DEFAULT_HIGHLIGHT_STYLE,1,size,()=>20);const long=sceneFitPadding([point('s',[0,0],'長い駅名','station')],DEFAULT_HIGHLIGHT_STYLE,1,size,()=>180);expect(long.right).toBeGreaterThan(short.right);expect(long.right).toBeGreaterThan(long.left)})
  it('reserves symmetric line-label space based on its width',()=>{const short=sceneFitPadding([line('r',[[0,0],[1,1]],'道')],DEFAULT_HIGHLIGHT_STYLE,1,size,()=>20);const long=sceneFitPadding([line('r',[[0,0],[1,1]],'とても長い街道名')],DEFAULT_HIGHLIGHT_STYLE,1,size,()=>200);expect(long.left).toBeGreaterThan(short.left);expect(long.right).toBe(long.left);expect(long.top).toBeGreaterThan(short.top)})
  it('uses fixed logical scene dimensions and is independent of raster pixel ratio',()=>{const measure=()=>200;const first=sceneFitPadding([point('s',[0,0],'日本橋','station')],DEFAULT_HIGHLIGHT_STYLE,1,size,measure);const sameLogicalFit=sceneFitPadding([point('s',[0,0],'日本橋','station')],DEFAULT_HIGHLIGHT_STYLE,1,{...size},measure);expect(first).toEqual(sameLogicalFit);expect(first.right).toBeLessThanOrEqual(SCENE_REFERENCE_WIDTH*.42)})
})
