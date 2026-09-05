import type maplibregl from 'maplibre-gl'
import stationIconUrl from '../icons/stations.png'
import shukubaIconUrl from '../icons/shukuba.png'

export const POINT_ICON_IDS = { stations: 'michi-station-icon', historicalPosts: 'michi-shukuba-icon' } as const
export const POINT_ICON_URLS = { stations: stationIconUrl, historicalPosts: shukubaIconUrl } as const

/** Render icons at twice the diameter of the radius-based dots they replace. */
export const POINT_ICON_DIAMETER_MULTIPLIER = 10
export const pointIconSize = (radius: number): number => radius * 2 * POINT_ICON_DIAMETER_MULTIPLIER

export async function registerPointIcons(map: maplibregl.Map): Promise<void> {
  await Promise.all(Object.entries(POINT_ICON_URLS).map(async ([kind, url]) => {
    const id = POINT_ICON_IDS[kind as keyof typeof POINT_ICON_IDS]
    if (map.hasImage(id)) return
    const { data } = await map.loadImage(url)
    // Normalize the unmodified square raster to a one-pixel style box. This lets
    // icon-size directly express the desired rendered CSS-pixel dimensions.
    map.addImage(id, data, { pixelRatio: data.width })
  }))
}
