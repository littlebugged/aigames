const readBest = (key: string): number | null => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const value = Number.parseInt(raw, 10)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

const renderBestScores = (): void => {
  const nodes = document.querySelectorAll<HTMLElement>('[data-best-key]')
  nodes.forEach((node) => {
    const key = node.dataset.bestKey
    if (!key) return
    const best = readBest(key)
    if (best === null) {
      node.remove()
      return
    }
    node.textContent = `你的最高分 ${best}`
  })
}

renderBestScores()
