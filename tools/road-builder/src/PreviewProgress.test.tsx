import React from'react'
import{renderToStaticMarkup}from'react-dom/server'
import{describe,expect,it}from'vitest'
import{emptyRoad}from'./model'
import{PreviewProgressIndicator,previewDraftIsCurrent}from'./previewProgress'

describe('background preview progress',()=>{
 it('renders real percentage, phase, and work counts',()=>{const html=renderToStaticMarkup(<PreviewProgressIndicator value={{status:'running',progress:63,phase:'Matching reference samples',completed:12640,total:20151}}/>);expect(html).toContain('63%');expect(html).toContain('Matching reference samples');expect(html).toContain('12,640 / 20,151');expect(html).toContain('value="63"')})
 it('rejects a completed preview after settings change',()=>{const road=emptyRoad();const submitted=JSON.stringify(road);expect(previewDraftIsCurrent(submitted,road)).toBe(true);expect(previewDraftIsCurrent(submitted,{...road,displayName:'changed'})).toBe(false)})
})
