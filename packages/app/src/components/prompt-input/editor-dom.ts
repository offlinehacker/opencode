const MAX_BREAKS = 200
const GAP = /\s/

function gap(char?: string) {
  return !!char && GAP.test(char)
}

function text(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u200B/g, "")
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return "\n"

  let value = ""
  for (const child of Array.from(node.childNodes)) {
    value += text(child)
  }
  return value
}

function offset(parent: HTMLElement, node: Node, pos: number) {
  const range = document.createRange()
  range.selectNodeContents(parent)
  range.setEnd(node, pos)
  return getTextLength(range.cloneContents())
}

function word(text: string, pos: number) {
  let start = pos
  let end = pos

  while (start > 0 && !gap(text[start - 1])) start -= 1
  while (end < text.length && !gap(text[end])) end += 1

  if (start === end) return null
  return { start, end }
}

function left(text: string, pos: number) {
  let end = pos
  while (end > 0 && gap(text[end - 1])) end -= 1
  return word(text, end)
}

export function createTextFragment(content: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  let breaks = 0
  for (const char of content) {
    if (char !== "\n") continue
    breaks += 1
    if (breaks > MAX_BREAKS) {
      const tail = content.endsWith("\n")
      const text = tail ? content.slice(0, -1) : content
      if (text) fragment.appendChild(document.createTextNode(text))
      if (tail) fragment.appendChild(document.createElement("br"))
      return fragment
    }
  }

  const segments = content.split("\n")
  segments.forEach((segment, index) => {
    if (segment) {
      fragment.appendChild(document.createTextNode(segment))
    }
    if (index < segments.length - 1) {
      fragment.appendChild(document.createElement("br"))
    }
  })
  return fragment
}

export function getNodeLength(node: Node): number {
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  return (node.textContent ?? "").replace(/\u200B/g, "").length
}

export function getTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u200B/g, "").length
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  let length = 0
  for (const child of Array.from(node.childNodes)) {
    length += getTextLength(child)
  }
  return length
}

export function getCursorPosition(parent: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer)) return 0
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(parent)
  preCaretRange.setEnd(range.startContainer, range.startOffset)
  return getTextLength(preCaretRange.cloneContents())
}

export function getEditorText(parent: HTMLElement) {
  return text(parent)
}

export function getSelectionRange(parent: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer) || !parent.contains(range.endContainer)) return null

  return {
    start: offset(parent, range.startContainer, range.startOffset),
    end: offset(parent, range.endContainer, range.endOffset),
  }
}

export function getDeleteWordRange(text: string, range?: { start: number; end: number } | null) {
  if (!text) return null

  if (range && range.start !== range.end) {
    const start = Math.max(0, Math.min(range.start, range.end, text.length))
    const end = Math.max(start, Math.min(Math.max(range.start, range.end), text.length))
    return { start, end }
  }

  const pos = Math.max(0, Math.min(range?.start ?? text.length, text.length))
  let span = null as { start: number; end: number } | null

  if (pos > 0 && pos < text.length && !gap(text[pos - 1]) && !gap(text[pos])) {
    span = word(text, pos)
  } else if (pos > 0) {
    span = left(text, pos)
  }

  if (!span) return null

  let end = span.end
  while (end < text.length && gap(text[end])) end += 1
  if (end > span.end) return { start: span.start, end }

  let start = span.start
  while (start > 0 && gap(text[start - 1])) start -= 1
  return { start, end: span.end }
}

export function setCursorPosition(parent: HTMLElement, position: number) {
  let remaining = position
  let node = parent.firstChild
  while (node) {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill =
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as HTMLElement).dataset.type === "file" || (node as HTMLElement).dataset.type === "agent")
    const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

    if (isText && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      range.setStart(node, remaining)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    if ((isPill || isBreak) && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      if (remaining === 0) {
        range.setStartBefore(node)
      }
      if (remaining > 0 && isPill) {
        range.setStartAfter(node)
      }
      if (remaining > 0 && isBreak) {
        const next = node.nextSibling
        if (next && next.nodeType === Node.TEXT_NODE) {
          range.setStart(next, 0)
        }
        if (!next || next.nodeType !== Node.TEXT_NODE) {
          range.setStartAfter(node)
        }
      }
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    remaining -= length
    node = node.nextSibling
  }

  const fallbackRange = document.createRange()
  const fallbackSelection = window.getSelection()
  const last = parent.lastChild
  if (last && last.nodeType === Node.TEXT_NODE) {
    const len = last.textContent ? last.textContent.length : 0
    fallbackRange.setStart(last, len)
  }
  if (!last || last.nodeType !== Node.TEXT_NODE) {
    fallbackRange.selectNodeContents(parent)
  }
  fallbackRange.collapse(false)
  fallbackSelection?.removeAllRanges()
  fallbackSelection?.addRange(fallbackRange)
}

export function setSelectionRange(parent: HTMLElement, range: Range, start: number, end = start) {
  const length = getTextLength(parent)
  const from = Math.max(0, Math.min(start, length))
  const to = Math.max(from, Math.min(end, length))

  range.selectNodeContents(parent)
  range.collapse(false)
  setRangeEdge(parent, range, "start", from)
  setRangeEdge(parent, range, "end", to)
}

export function setRangeEdge(parent: HTMLElement, range: Range, edge: "start" | "end", offset: number) {
  let remaining = offset
  const nodes = Array.from(parent.childNodes)

  for (const node of nodes) {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill =
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as HTMLElement).dataset.type === "file" || (node as HTMLElement).dataset.type === "agent")
    const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

    if (isText && remaining <= length) {
      if (edge === "start") range.setStart(node, remaining)
      if (edge === "end") range.setEnd(node, remaining)
      return
    }

    if ((isPill || isBreak) && remaining <= length) {
      if (edge === "start" && remaining === 0) range.setStartBefore(node)
      if (edge === "start" && remaining > 0) range.setStartAfter(node)
      if (edge === "end" && remaining === 0) range.setEndBefore(node)
      if (edge === "end" && remaining > 0) range.setEndAfter(node)
      return
    }

    remaining -= length
  }
}
