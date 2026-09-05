import { describe, expect, it, vi } from 'vitest'
import { POINT_ICON_IDS, POINT_ICON_URLS, pointIconSize, registerPointIcons } from './pointIcons'

describe('point icon registration', () => {
  it('imports and registers the authoritative PNG assets without deriving artwork', async () => {
    const addImage=vi.fn()
    const map={hasImage:vi.fn(()=>false),loadImage:vi.fn(async (url:string)=>({data:{width:url.includes('stations')?1134:1254}})),addImage}
    await registerPointIcons(map as never)
    expect(POINT_ICON_URLS.stations).toMatch(/stations\.png$/)
    expect(POINT_ICON_URLS.historicalPosts).toMatch(/shukuba\.png$/)
    expect(addImage).toHaveBeenCalledWith(POINT_ICON_IDS.stations,{width:1134},{pixelRatio:1134})
    expect(addImage).toHaveBeenCalledWith(POINT_ICON_IDS.historicalPosts,{width:1254},{pixelRatio:1254})
  })

  it('renders at twice the former dot diameter',()=>{
    expect(pointIconSize(2)).toBe(8)
    expect(pointIconSize(2.5)).toBe(10)
  })
})
