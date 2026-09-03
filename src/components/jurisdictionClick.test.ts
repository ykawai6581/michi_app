import { describe, expect, it, vi } from 'vitest'
import type { JurisdictionFeature } from '../data/jurisdictions'
import { handleJurisdictionClick } from './jurisdictionClick'

describe('jurisdiction map click',()=>{
  it('selects the clicked jurisdiction without creating a popup',()=>{const feature={type:'Feature',properties:{jurisdictionId:'shibuya',municipalityName:'渋谷町'},geometry:{type:'Polygon',coordinates:[]}} as unknown as JurisdictionFeature;const onSelect=vi.fn();const popup=vi.fn();handleJurisdictionClick({features:[feature]} as never,onSelect);expect(onSelect).toHaveBeenCalledWith(feature);expect(popup).not.toHaveBeenCalled()})
})
