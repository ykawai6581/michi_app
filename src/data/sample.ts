import type { FeatureCollection } from 'geojson'
import type { EntityFeature } from '../types/geo'

const meta = { source: ['Michi Map v0.1 hand-drawn demonstration data'], license: 'CC0-1.0', checked: '2026-08-26', confidence: 'low' as const, note: 'Demonstration geometry only; do not use as historical evidence.' }
export const sampleData: FeatureCollection = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { id: 'modern-koshu', name: '甲州街道（現代・サンプル）', type: 'road', aliases: ['新宿通り'], ...meta }, geometry: { type: 'LineString', coordinates: [[139.7214,35.6848],[139.7101,35.6887],[139.7005,35.6896],[139.6891,35.6833],[139.6765,35.6785]] } },
  { type: 'Feature', properties: { id: 'R003-sample', name: '甲州道中', type: 'historical-road', aliases: ['甲州街道', '甲州海道'], period: '江戸', relatedEntities: ['modern-koshu'], ...meta }, geometry: { type: 'LineString', coordinates: [[139.726,35.6834],[139.7154,35.6872],[139.7043,35.6889],[139.6952,35.6871],[139.6832,35.6815],[139.6715,35.678]] } },
  { type: 'Feature', properties: { id: 'shinjuku-station', name: '新宿駅', type: 'place', aliases: ['新宿'], ...meta }, geometry: { type: 'Point', coordinates: [139.7006,35.6896] } },
  { type: 'Feature', properties: { id: 'naito-shinjuku', name: '内藤新宿', type: 'historical-place', aliases: ['新宿宿', '新宿'], period: '江戸', relatedEntities: ['R003-sample'], ...meta }, geometry: { type: 'Point', coordinates: [139.7101,35.6887] } },
  { type: 'Feature', properties: { id: 'shinjuku-1', name: '新宿一丁目', type: 'chome', aliases: ['新宿1丁目', '新宿１丁目'], ...meta }, geometry: { type: 'Polygon', coordinates: [[[139.7063,35.687],[139.7117,35.6875],[139.7123,35.6905],[139.707,35.691],[139.7063,35.687]]] } }
] as EntityFeature[] }
export const entities = sampleData.features as EntityFeature[]
