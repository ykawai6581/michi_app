import type { EntityFeature } from '../types/geo'
import { normalizeJapanese } from './normalizeJapanese'

export function searchEntities(entities: EntityFeature[], query: string): EntityFeature[] {
  const needle = normalizeJapanese(query)
  if (!needle) return []
  return entities.map((entity) => ({ entity, terms: [entity.properties.name, ...(entity.properties.aliases ?? [])].map(normalizeJapanese) }))
    .filter(({ terms }) => terms.some((term) => term.includes(needle)))
    .sort((a, b) => Number(b.terms.includes(needle)) - Number(a.terms.includes(needle)) || a.entity.properties.name.localeCompare(b.entity.properties.name, 'ja'))
    .map(({ entity }) => entity)
}
