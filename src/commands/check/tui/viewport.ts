export const CHROME_LINES = 6

export function getViewportHeight(termRows: number, chrome?: number): number {
  return Math.max(1, termRows - (chrome ?? CHROME_LINES))
}

export function calculateScrollOffset(
  cursor: number,
  viewportHeight: number,
  totalItems: number,
  currentOffset: number,
): number {
  const maxOffset = Math.max(0, totalItems - viewportHeight)

  let offset = currentOffset

  // Cursor above visible range — scroll up
  if (cursor < offset) {
    offset = cursor
  }

  // Cursor below visible range — scroll down
  if (cursor >= offset + viewportHeight) {
    offset = cursor - viewportHeight + 1
  }

  return Math.min(offset, maxOffset)
}

export function getVisibleRange(
  scrollOffset: number,
  viewportHeight: number,
  totalItems: number,
): { start: number; end: number } {
  const start = scrollOffset
  const end = Math.min(scrollOffset + viewportHeight, totalItems)
  return { start, end }
}

export function hasOverflowAbove(scrollOffset: number): boolean {
  return scrollOffset > 0
}

export function hasOverflowBelow(
  scrollOffset: number,
  viewportHeight: number,
  totalItems: number,
): boolean {
  return scrollOffset + viewportHeight < totalItems
}
