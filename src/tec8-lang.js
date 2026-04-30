import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment } from '@codemirror/state'
import { linter, lintGutter } from '@codemirror/lint'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { assemble } from './assembler'

const MNEMONICS = new Set([
  'NOP','ADD','SUB','AND','INC','LD','ST',
  'JC','JZ','JMP','OUT','IRET','DI','EI','STOP','DATA',
])

export const tec8Language = StreamLanguage.define({
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.peek() === ';') { stream.skipToEnd(); return 'comment' }
    // label definition: WORD followed by colon
    if (stream.match(/[A-Za-z_]\w*(?=\s*:)/)) return 'labelName'
    if (stream.eat(':')) return 'punctuation'
    // negative decimal  (-3, -8 …)
    if (stream.match(/-\d+/)) return 'number'
    // hex number with H suffix — must be tried before identifier so "FFH" isn't read as a label
    // word-boundary lookahead prevents "FFHZ" from matching
    if (stream.match(/[0-9A-Fa-f]+H(?!\w)/i)) return 'number'
    // binary number with B suffix — digit-only body, word-boundary lookahead
    if (stream.match(/[01]+B(?!\w)/i)) return 'number'
    // identifier: mnemonic / register / label reference
    const m = stream.match(/[A-Za-z_]\w*/)
    if (m) {
      const w = m[0].toUpperCase()
      if (MNEMONICS.has(w)) return 'keyword'
      if (/^R[0-3]$/.test(w)) return 'variableName'
      return 'typeName'
    }
    // plain decimal
    if (stream.match(/\d+/)) return 'number'
    if (stream.eat('[') || stream.eat(']')) return 'bracket'
    if (stream.eat(',')) return 'operator'
    stream.next()
    return null
  },
  tokenTable: {
    comment:      tags.comment,
    keyword:      tags.keyword,
    number:       tags.number,
    variableName: tags.variableName,
    labelName:    tags.labelName,
    typeName:     tags.typeName,
    bracket:      tags.bracket,
    operator:     tags.operator,
    punctuation:  tags.punctuation,
  },
})

// ── Shared editor layout (font, sizing) ─────────────────────────
const editorBase = EditorView.theme({
  '.cm-scroller': { overflow: 'auto' },
  '.cm-content': {
    fontFamily: "'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace",
    fontSize: '13.5px',
    lineHeight: '22px',
    padding: '6px 0',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 4px',
    minWidth: '36px',
    textAlign: 'right',
    lineHeight: '22px',
  },
  '.cm-line':             { padding: '0 8px' },
  '.cm-lintRange-error':  { textDecoration: 'underline wavy' },
  '.cm-gutter-lint':      { width: '14px' },
  '.cm-lint-marker-error': {
    width: '8px', height: '8px',
    borderRadius: '50%',
    display: 'block',
    margin: '7px 3px 0',
  },
})

// ── Dark theme ───────────────────────────────────────────────────
const darkEditorTheme = EditorView.theme({
  '&':                        { backgroundColor: '#1a1b26', color: '#c0caf5', height: '100%' },
  '.cm-content':              { caretColor: '#7aa2f7' },
  '.cm-cursor':               { borderLeftColor: '#7aa2f7' },
  '.cm-selectionBackground':  { background: '#2d3149' },
  '&.cm-focused .cm-selectionBackground': { background: '#2d3149' },
  '.cm-gutters':              { backgroundColor: '#1f2030', color: '#565f89', border: 'none', borderRight: '1px solid #2e3148' },
  '.cm-activeLine':           { backgroundColor: '#1f2035', mixBlendMode: 'lighten' },
  '.cm-activeLineGutter':     { backgroundColor: '#1f2035', color: '#c0caf5' },
  '.cm-lintRange-error':      { textDecorationColor: '#f7768e' },
  '.cm-lint-marker-error':    { backgroundColor: '#f7768e' },
}, { dark: true })

const darkHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.comment,      color: '#565f89', fontStyle: 'italic' },
  { tag: tags.keyword,      color: '#7aa2f7', fontWeight: '600' },
  { tag: tags.variableName, color: '#ff9e64' },
  { tag: tags.labelName,    color: '#e0af68', fontWeight: '600' },
  { tag: tags.typeName,     color: '#7dcfff' },
  { tag: tags.number,       color: '#9ece6a' },
  { tag: tags.bracket,      color: '#bb9af7' },
  { tag: tags.operator,     color: '#565f89' },
  { tag: tags.punctuation,  color: '#e0af68' },
]))

// ── Light theme ──────────────────────────────────────────────────
const lightEditorTheme = EditorView.theme({
  '&':                        { backgroundColor: '#f8f8fc', color: '#1e2030', height: '100%' },
  '.cm-content':              { caretColor: '#3b6fd4' },
  '.cm-cursor':               { borderLeftColor: '#3b6fd4' },
  '.cm-selectionBackground':  { background: '#c8d0f0' },
  '&.cm-focused .cm-selectionBackground': { background: '#c8d0f0' },
  '.cm-gutters':              { backgroundColor: '#efeff5', color: '#9090b8', border: 'none', borderRight: '1px solid #d0d0e0' },
  '.cm-activeLine':           { backgroundColor: '#e8eaf8', mixBlendMode: 'darken' },
  '.cm-activeLineGutter':     { backgroundColor: '#e8eaf8', color: '#1e2030' },
  '.cm-lintRange-error':      { textDecorationColor: '#d03050' },
  '.cm-lint-marker-error':    { backgroundColor: '#d03050' },
}, { dark: false })

const lightHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.comment,      color: '#8090b0', fontStyle: 'italic' },
  { tag: tags.keyword,      color: '#3b6fd4', fontWeight: '600' },
  { tag: tags.variableName, color: '#c0600e' },
  { tag: tags.labelName,    color: '#b07000', fontWeight: '600' },
  { tag: tags.typeName,     color: '#0e8888' },
  { tag: tags.number,       color: '#2a8b3a' },
  { tag: tags.bracket,      color: '#8050c0' },
  { tag: tags.operator,     color: '#8090b0' },
  { tag: tags.punctuation,  color: '#b07000' },
]))

// ── Linter ───────────────────────────────────────────────────────
export const tec8Linter = linter(view => {
  const src = view.state.doc.toString()
  return assemble(src)
    .filter(r => r.error)
    .map(r => {
      const n = r.lineIdx + 1
      if (n > view.state.doc.lines) return null
      const line = view.state.doc.line(n)
      return { from: line.from, to: line.to, severity: 'error', message: r.error }
    })
    .filter(Boolean)
}, { delay: 0 })

// ── Dynamic theme compartment ────────────────────────────────────
export const themeCompartment = new Compartment()

export function makeTec8Extensions(isDark) {
  return [
    tec8Language,
    editorBase,
    themeCompartment.of(isDark ? [darkEditorTheme, darkHighlight] : [lightEditorTheme, lightHighlight]),
    tec8Linter,
    lintGutter(),
    closeBrackets({ brackets: ['['] }),
    keymap.of(closeBracketsKeymap),
  ]
}

export function applyTheme(view, isDark) {
  view.dispatch({
    effects: themeCompartment.reconfigure(
      isDark ? [darkEditorTheme, darkHighlight] : [lightEditorTheme, lightHighlight]
    ),
  })
}
