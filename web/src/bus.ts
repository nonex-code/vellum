export const PALETTE_EVENT = 'wb:open-palette'

export function openPalette() {
  window.dispatchEvent(new Event(PALETTE_EVENT))
}