import type maplibregl from 'maplibre-gl'
export function exportPNG(map:maplibregl.Map):void { map.once('render',()=>{const link=document.createElement('a');link.download=`michi-map-${new Date().toISOString().slice(0,10)}.png`;link.href=map.getCanvas().toDataURL('image/png');link.click()});map.triggerRepaint() }
