/* eslint-disable react-refresh/only-export-components */
import React from'react'
import{Road}from'./model'
export type PreviewProgress={status:'running'|'complete'|'failed';progress:number;phase:string;completed?:number;total?:number}
export const previewDraftIsCurrent=(submitted:string,current:Road)=>JSON.stringify(current)===submitted
export function PreviewProgressIndicator({value}:{value:PreviewProgress}){return <section className={`preview-progress ${value.status}`} aria-live="polite"><div><strong>{value.phase}{value.status==='complete'?' ✓':''}</strong><b>{value.progress}%</b></div><progress max={100} value={value.progress}/>{value.completed!==undefined&&value.total!==undefined&&<small>{value.phase} {value.completed.toLocaleString()} / {value.total.toLocaleString()}</small>}</section>}
