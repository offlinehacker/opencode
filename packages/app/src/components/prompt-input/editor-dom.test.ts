// UPSTREAM-DIVERGENCE-FILE: Added/updated after upstream sync 6b9ce5e63 to lock down the fork's
// mobile delete-word editor helpers during future upstream prompt-editor merges.

import { describe, expect, test } from "bun:test"
import {
  createTextFragment,
  getCursorPosition,
  getDeleteWordRange,
  getEditorText,
  getNodeLength,
  getSelectionRange,
  getTextLength,
  setCursorPosition,
  setSelectionRange,
} from "./editor-dom"

describe("prompt-input editor dom", () => {
  test("createTextFragment preserves newlines with consecutive br nodes", () => {
    const fragment = createTextFragment("foo\n\nbar")
    const container = document.createElement("div")
    container.appendChild(fragment)

    expect(container.childNodes.length).toBe(4)
    expect(container.childNodes[0]?.textContent).toBe("foo")
    expect((container.childNodes[1] as HTMLElement).tagName).toBe("BR")
    expect((container.childNodes[2] as HTMLElement).tagName).toBe("BR")
    expect(container.childNodes[3]?.textContent).toBe("bar")
  })

  test("createTextFragment keeps trailing newline as terminal break", () => {
    const fragment = createTextFragment("foo\n")
    const container = document.createElement("div")
    container.appendChild(fragment)

    expect(container.childNodes.length).toBe(2)
    expect(container.childNodes[0]?.textContent).toBe("foo")
    expect((container.childNodes[1] as HTMLElement).tagName).toBe("BR")
  })

  test("createTextFragment avoids break-node explosion for large multiline content", () => {
    const content = Array.from({ length: 220 }, () => "line").join("\n")
    const fragment = createTextFragment(content)
    const container = document.createElement("div")
    container.appendChild(fragment)

    expect(container.childNodes.length).toBe(1)
    expect(container.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE)
    expect(container.textContent).toBe(content)
  })

  test("createTextFragment keeps terminal break in large multiline fallback", () => {
    const content = `${Array.from({ length: 220 }, () => "line").join("\n")}\n`
    const fragment = createTextFragment(content)
    const container = document.createElement("div")
    container.appendChild(fragment)

    expect(container.childNodes.length).toBe(2)
    expect(container.childNodes[0]?.textContent).toBe(content.slice(0, -1))
    expect((container.childNodes[1] as HTMLElement).tagName).toBe("BR")
  })

  test("length helpers treat breaks as one char and ignore zero-width chars", () => {
    const container = document.createElement("div")
    container.appendChild(document.createTextNode("ab\u200B"))
    container.appendChild(document.createElement("br"))
    container.appendChild(document.createTextNode("cd"))

    expect(getNodeLength(container.childNodes[0]!)).toBe(2)
    expect(getNodeLength(container.childNodes[1]!)).toBe(1)
    expect(getTextLength(container)).toBe(5)
  })

  test("setCursorPosition and getCursorPosition round-trip with pills and breaks", () => {
    const container = document.createElement("div")
    const pill = document.createElement("span")
    pill.dataset.type = "file"
    pill.textContent = "@file"
    container.appendChild(document.createTextNode("ab"))
    container.appendChild(pill)
    container.appendChild(document.createElement("br"))
    container.appendChild(document.createTextNode("cd"))
    document.body.appendChild(container)

    setCursorPosition(container, 2)
    expect(getCursorPosition(container)).toBe(2)

    setCursorPosition(container, 7)
    expect(getCursorPosition(container)).toBe(7)

    setCursorPosition(container, 8)
    expect(getCursorPosition(container)).toBe(8)

    container.remove()
  })

  test("setCursorPosition and getCursorPosition round-trip across blank lines", () => {
    const container = document.createElement("div")
    container.appendChild(document.createTextNode("a"))
    container.appendChild(document.createElement("br"))
    container.appendChild(document.createElement("br"))
    container.appendChild(document.createTextNode("b"))
    document.body.appendChild(container)

    setCursorPosition(container, 2)
    expect(getCursorPosition(container)).toBe(2)

    setCursorPosition(container, 3)
    expect(getCursorPosition(container)).toBe(3)

    container.remove()
  })

  test("getEditorText treats breaks as newlines and strips zero-width chars", () => {
    const container = document.createElement("div")
    container.appendChild(document.createTextNode("foo\u200B"))
    container.appendChild(document.createElement("br"))
    container.appendChild(document.createTextNode("bar"))

    expect(getEditorText(container)).toBe("foo\nbar")
  })

  test("getDeleteWordRange deletes the active word", () => {
    expect(getDeleteWordRange("alpha beta", { start: 8, end: 8 })).toEqual({ start: 5, end: 10 })
  })

  test("getDeleteWordRange deletes the word to the left when between words", () => {
    expect(getDeleteWordRange("alpha beta", { start: 6, end: 6 })).toEqual({ start: 0, end: 6 })
  })

  test("getDeleteWordRange falls back to the last word when there is no caret", () => {
    expect(getDeleteWordRange("alpha beta")).toEqual({ start: 5, end: 10 })
  })

  test("getDeleteWordRange trims trailing newlines", () => {
    expect(getDeleteWordRange("alpha\nbeta", { start: 5, end: 5 })).toEqual({ start: 0, end: 6 })
  })

  test("getDeleteWordRange deletes an explicit selection without trimming", () => {
    expect(getDeleteWordRange("alpha beta", { start: 1, end: 4 })).toEqual({ start: 1, end: 4 })
  })

  test("getDeleteWordRange returns null for an empty prompt", () => {
    expect(getDeleteWordRange("", { start: 0, end: 0 })).toBeNull()
  })

  test("getSelectionRange reads both edges of the current selection", () => {
    const container = document.createElement("div")
    container.appendChild(document.createTextNode("alpha"))
    container.appendChild(document.createElement("br"))
    container.appendChild(document.createTextNode("beta"))
    document.body.appendChild(container)

    const range = document.createRange()
    setSelectionRange(container, range, 2, 7)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(getSelectionRange(container)).toEqual({ start: 2, end: 7 })

    container.remove()
  })

  test("setSelectionRange can delete a pill token as one word", () => {
    const container = document.createElement("div")
    const pill = document.createElement("span")
    pill.dataset.type = "file"
    pill.textContent = "@file"
    container.appendChild(document.createTextNode("foo "))
    container.appendChild(pill)
    container.appendChild(document.createTextNode(" bar"))
    document.body.appendChild(container)

    const text = getEditorText(container)
    expect(text).toBe("foo @file bar")

    const span = getDeleteWordRange(text, { start: 10, end: 10 })
    expect(span).toEqual({ start: 4, end: 10 })

    const selection = window.getSelection()
    const range = document.createRange()
    setSelectionRange(container, range, span!.start, span!.end)
    selection?.removeAllRanges()
    selection?.addRange(range)
    range.deleteContents()
    setCursorPosition(container, span!.start)

    expect(getEditorText(container)).toBe("foo bar")
    expect(getCursorPosition(container)).toBe(4)

    container.remove()
  })
})
