import { describe, expect, it } from 'vitest'
import type { JurisdictionFeature } from '../data/jurisdictions'
import { jurisdictionDimFilter, jurisdictionEmphasisCollection, jurisdictionLabelText } from './jurisdictionEmphasis'

const polygon=(id:string,name:string,parent?:string,size=1):JurisdictionFeature=>({type:'Feature',properties:{jurisdictionId:id,snapshotDate:'1924-12-31',prefectureName:'東京府',parentJurisdictionName:parent,municipalityName:name,sourceProvider:'Geoshape',sourceDataset:'historical'},geometry:{type:'Polygon',coordinates:[[[0,0],[size,0],[size,size],[0,size],[0,0]]]}})

describe('jurisdiction spotlight helpers',()=>{
  it('excludes every selected jurisdiction ID from the dim veil',()=>expect(jurisdictionDimFilter([polygon('ward-a','A'),polygon('ward-b','B')])).toEqual(['!', ['in',['get','jurisdictionId'],['literal',['ward-a','ward-b']]]]))
  it('disables dark emphasis when there is no selection',()=>expect(jurisdictionDimFilter([])).toEqual(['==',['literal',false],true]))
  it('formats a municipality parent above its primary name',()=>expect(jurisdictionLabelText(polygon('shibuya','渋谷町','豊多摩郡'),{level:'municipality',value:'渋谷町'})).toEqual({parent:'豊多摩郡',primary:'渋谷町'}))
  it('does not add a blank parent line when no parent exists',()=>expect(jurisdictionLabelText(polygon('adachi','足立区'),{level:'municipality',value:'足立区'})).toEqual({primary:'足立区'}))
  it('labels a derived parent with only its municipality name',()=>expect(jurisdictionLabelText(polygon('tokyo','東京市'),{level:'parent',value:'東京市'})).toEqual({primary:'東京市'}))
  it('chooses one deterministic largest component for a parent label',()=>{const collection=jurisdictionEmphasisCollection([polygon('small','杉並区','東京市'),polygon('large','渋谷区','東京市',2)],{level:'parent',value:'東京市'});expect(collection.features.filter(feature=>feature.properties?.emphasisLabel)).toHaveLength(1);expect(collection.features.find(feature=>feature.properties?.emphasisLabel)?.properties).toMatchObject({jurisdictionId:'large',primary:'東京市'});expect(collection.features.every(feature=>feature.properties?.parent===undefined)).toBe(true)})
  it('builds replacement state without accumulating old IDs',()=>{expect(jurisdictionDimFilter([polygon('old','Old')])).not.toEqual(jurisdictionDimFilter([polygon('new','New')]));expect(jurisdictionDimFilter([polygon('new','New')])).not.toContain('old')})
})
