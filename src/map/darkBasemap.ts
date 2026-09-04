export function effectiveDarkBasemap(manualDarkBasemap: boolean, hasActiveFeature: boolean): boolean {
  return manualDarkBasemap || hasActiveFeature
}
