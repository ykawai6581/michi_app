export const CLOUD_TRANSITION_DURATION_MS = 1100
export const CLOUD_VIEWBOX_WIDTH = 1920
export const CLOUD_VIEWBOX_HEIGHT = 1080
export const CLOUD_BANK_TRAVEL_PX = 1360

export interface CloudEdgePoint { y: number; x: number }
export interface CloudWisp { x: number; y: number; width: number; height: number; opacity: number }
export interface CloudBankGeometry { edge: CloudEdgePoint[]; wisps: CloudWisp[] }

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

const mulberry32 = (seed: number) => {
  let value = seed >>> 0
  return () => {
    value += 0x6D2B79F5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Symmetric Story-time mask: offscreen at 0/1 and fully closed at 0.5. */
export const cloudCoverProgress = (rawProgress: number): number => {
  const raw = clamp01(rawProgress)
  const half = raw <= 0.5 ? raw * 2 : (1 - raw) * 2
  return half * half * (3 - 2 * half)
}

/** Deterministically generate a non-repeating stepped cloud bank from a seed. */
export function generateCloudBank(seed: number): CloudBankGeometry {
  const random = mulberry32(seed)
  const edge: CloudEdgePoint[] = [{ y: 0, x: 1030 + random() * 180 }]
  let y = 0
  while (y < CLOUD_VIEWBOX_HEIGHT) {
    y = Math.min(CLOUD_VIEWBOX_HEIGHT, y + 85 + random() * 95)
    edge.push({ y, x: 1010 + random() * 220 })
  }

  const wisps: CloudWisp[] = Array.from({ length: 20 }, (_, index) => ({
    x: 55 + random() * 620,
    y: (index / 20) * CLOUD_VIEWBOX_HEIGHT + (random() - 0.5) * 54,
    width: 170 + random() * 410,
    height: 22 + random() * 34,
    opacity: 0.18 + random() * 0.22,
  }))

  return { edge, wisps }
}

export function cloudBankPath(geometry: CloudBankGeometry): string {
  const [first, ...rest] = geometry.edge
  if (!first) return ''
  const commands = [`M 0 0`, `H ${first.x.toFixed(1)}`]
  rest.forEach((point) => commands.push(`V ${point.y.toFixed(1)}`, `H ${point.x.toFixed(1)}`))
  commands.push(`V ${CLOUD_VIEWBOX_HEIGHT}`, `H 0`, 'Z')
  return commands.join(' ')
}

const wispMarkup = (wisps: CloudWisp[]) => wisps.map((wisp, index) => {
  const fill = index % 3 === 0 ? '#D5BC8F' : index % 3 === 1 ? '#E4D4B2' : '#C8AA78'
  return `<rect x="${wisp.x.toFixed(1)}" y="${wisp.y.toFixed(1)}" width="${wisp.width.toFixed(1)}" height="${wisp.height.toFixed(1)}" rx="${(wisp.height / 2).toFixed(1)}" fill="${fill}" opacity="${wisp.opacity.toFixed(3)}"/>`
}).join('')

const bankMarkup = (id: string, geometry: CloudBankGeometry) => {
  const path = cloudBankPath(geometry)
  return `
    <g id="${id}">
      <path d="${path}" fill="#F4EBD7" stroke="#A88E63" stroke-width="5" stroke-linejoin="round"/>
      <path d="${path}" fill="url(#kumo-pattern)" opacity="0.17"/>
      ${wispMarkup(geometry.wisps)}
      ${geometry.wisps.filter((_, index) => index % 2 === 0).map((wisp) => `<line x1="${(wisp.x + 18).toFixed(1)}" y1="${(wisp.y + wisp.height / 2).toFixed(1)}" x2="${(wisp.x + wisp.width - 18).toFixed(1)}" y2="${(wisp.y + wisp.height / 2).toFixed(1)}" stroke="#A98F67" stroke-width="2.4" stroke-linecap="round" opacity="0.45"/>`).join('')}
    </g>`
}

export function createCloudTransitionSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', `0 0 ${CLOUD_VIEWBOX_WIDTH} ${CLOUD_VIEWBOX_HEIGHT}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.dataset.michiCloudTransition = 'true'
  Object.assign(svg.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '1000', overflow: 'hidden', opacity: '0',
  })

  const left = generateCloudBank(0x6d696368)
  const right = generateCloudBank(0x6b756d6f)
  svg.innerHTML = `
    <defs>
      <pattern id="kumo-pattern" width="56" height="28" patternUnits="userSpaceOnUse">
        <path d="M0 28 A28 28 0 0 1 56 28 M14 28 A14 14 0 0 1 42 28" fill="none" stroke="#B79A6A" stroke-width="1.6" opacity="0.8"/>
      </pattern>
    </defs>
    ${bankMarkup('michi-cloud-left', left)}
    <g id="michi-cloud-right" transform="translate(${CLOUD_VIEWBOX_WIDTH} 0) scale(-1 1)">
      ${bankMarkup('michi-cloud-right-inner', right)}
    </g>`
  return svg
}

export function setCloudTransitionCover(svg: SVGSVGElement, coverProgress: number): void {
  const cover = clamp01(coverProgress)
  const travel = CLOUD_BANK_TRAVEL_PX * (1 - cover)
  const left = svg.querySelector<SVGGElement>('#michi-cloud-left')
  const right = svg.querySelector<SVGGElement>('#michi-cloud-right')
  left?.setAttribute('transform', `translate(${-travel.toFixed(2)} 0)`)
  right?.setAttribute('transform', `translate(${(CLOUD_VIEWBOX_WIDTH + travel).toFixed(2)} 0) scale(-1 1)`)
  svg.style.opacity = cover <= 0.001 ? '0' : '1'
}

export interface StoryFramePresentationEventDetail {
  cloudCoverProgress?: number
}

/**
 * Installs a scene-frame SVG overlay once. StoryPlayer drives it synchronously
 * through michi:story-frame so deterministic seek() captures the exact same
 * cloud position independent of browser or renderer wall-clock speed.
 */
export function installCloudTransitionOverlay(): () => void {
  let svg: SVGSVGElement | null = null
  let lastCover = 0

  const attach = () => {
    const scene = document.querySelector<HTMLElement>('.scene-frame')
    if (!scene) return
    const existing = scene.querySelector<SVGSVGElement>('svg[data-michi-cloud-transition="true"]')
    svg = existing ?? createCloudTransitionSvg()
    if (!existing) scene.appendChild(svg)
    setCloudTransitionCover(svg, lastCover)
  }

  const onFrame = (event: Event) => {
    lastCover = (event as CustomEvent<StoryFramePresentationEventDetail>).detail?.cloudCoverProgress ?? 0
    if (!svg || !svg.isConnected) attach()
    if (svg) setCloudTransitionCover(svg, lastCover)
  }

  window.addEventListener('michi:story-frame', onFrame)
  const observer = new MutationObserver(() => { if (!svg || !svg.isConnected) attach() })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  attach()

  return () => {
    observer.disconnect()
    window.removeEventListener('michi:story-frame', onFrame)
    svg?.remove()
  }
}
