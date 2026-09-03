import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { disabledJurisdictionLayer, type JurisdictionManifest } from '../data/jurisdictions'
import { JurisdictionPanel } from './JurisdictionPanel'

const manifest:JurisdictionManifest={schemaVersion:1,providers:{geoshape:{displayName:'Geoshape',dataset:'historical-administrative-areas-beta',datasetName:'beta',sourceUrl:'source',caution:'caution',prefectures:{'13':{displayName:'Tokyo',availableDates:['1932-12-31'],snapshots:{'1932-12-31':{path:'canonical.geojson',featureCount:138,parentDisplayPath:'parents.geojson',parentDisplayFeatureCount:106}}}}}}}

describe('JurisdictionPanel',()=>{
  it('offers canonical and ward-to-parent display modes',()=>{
    const markup=renderToStaticMarkup(<JurisdictionPanel manifest={manifest} collection={null} value={{...disabledJurisdictionLayer(),snapshotDate:'1932-12-31'}} loading={false} error={null} onChange={()=>undefined}/>)
    expect(markup).toContain('Jurisdiction display mode')
    expect(markup).toContain('市区町村')
    expect(markup).toContain('親自治体で統合（区のみ）')
  })
})
