import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { assemble } from './assembler'
import { makeTec8Extensions, applyTheme } from './tec8-lang'
import './App.css'

const DRAFT_KEY = 'tec8_draft'
const SAVES_KEY = 'tec8_saves'

const EXAMPLE = `; Example
START:
  NOP
  ADD R0, R1
  SUB R2, R3
  AND R0, R2
  INC R1
  LD R0, [R1]
  ST R2, [R3]
  JC END
  JZ 0EH
  OUT R0
  JMP [R2]
  DI
  EI
  IRET
END:
  STOP
`

function fmtDate(iso) {
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function IconSun() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  )
}

function IconMoon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}

function IconFloppy() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
  )
}

function Bit({ v }) {
  return <span className={`mc-bit mc-bit-${v}`}>{v}</span>
}

function ByteDisplay({ byte }) {
  const b = byte.toString(2).padStart(8, '0')
  return (
    <span className="mc-byte">
      {b.slice(0, 4).split('').map((v, i) => <Bit key={i} v={v} />)}
      <span className="mc-sep" />
      {b.slice(4).split('').map((v, i) => <Bit key={i + 4} v={v} />)}
    </span>
  )
}

export default function App() {
  const [source, setSource] = useState(() =>
    localStorage.getItem(DRAFT_KEY) ?? EXAMPLE
  )
  const [activeLine, setActiveLine] = useState(0)
  const [copied, setCopied] = useState(false)
  const [isDark, setIsDark] = useState(true)
  const [saves, setSaves] = useState(() =>
    JSON.parse(localStorage.getItem(SAVES_KEY) ?? '[]')
  )
  const [openPanel, setOpenPanel] = useState(null) // 'save' | 'load' | null
  const [saveName, setSaveName] = useState('')

  const editorViewRef = useRef(null)
  const activeRowRef = useRef(null)
  const rightScrollRef = useRef(null)
  const activeLineRef = useRef(0)
  const saveWrapRef = useRef(null)
  const loadWrapRef = useRef(null)

  // Auto-save draft
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(DRAFT_KEY, source), 500)
    return () => clearTimeout(t)
  }, [source])

  // Close panels on outside click
  useEffect(() => {
    if (!openPanel) return
    function onDown(e) {
      if (!saveWrapRef.current?.contains(e.target) &&
          !loadWrapRef.current?.contains(e.target)) {
        setOpenPanel(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openPanel])

  const lines = source.split('\n')
  const asmResults = assemble(source)

  const lineResults = useMemo(() => {
    const m = {}
    for (const r of asmResults) m[r.lineIdx] = r
    return m
  }, [asmResults])

  const errors = asmResults.filter(r => r.error)
  const extensions = useMemo(() => makeTec8Extensions(true), [])

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeLine])

  const onUpdate = useCallback((viewUpdate) => {
    const pos = viewUpdate.state.selection.main.head
    const lineNum = viewUpdate.state.doc.lineAt(pos).number - 1
    if (lineNum !== activeLineRef.current) {
      activeLineRef.current = lineNum
      setActiveLine(lineNum)
    }
  }, [])

  function toggleTheme() {
    const next = !isDark
    setIsDark(next)
    if (editorViewRef.current) applyTheme(editorViewRef.current, next)
  }

  function commitSave() {
    const name = saveName.trim() || '未命名'
    const entry = {
      id: Date.now().toString(),
      name,
      code: source,
      savedAt: new Date().toISOString(),
    }
    const next = [entry, ...saves]
    setSaves(next)
    localStorage.setItem(SAVES_KEY, JSON.stringify(next))
    setSaveName('')
    setOpenPanel(null)
  }

  function loadEntry(entry) {
    setSource(entry.code)
    setOpenPanel(null)
  }

  function deleteEntry(id, e) {
    e.stopPropagation()
    const next = saves.filter(s => s.id !== id)
    setSaves(next)
    localStorage.setItem(SAVES_KEY, JSON.stringify(next))
  }

  function copyMachineCode() {
    const mc = lines
      .map((_, i) => {
        const r = lineResults[i]
        return r?.byte != null ? r.byte.toString(2).padStart(8, '0') : null
      })
      .filter(Boolean)
      .join('\n')
    navigator.clipboard.writeText(mc)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`app${isDark ? '' : ' light'}`}>
      <header className="header">
        <span className="header-title">TECASM</span>
        <span className="header-sub">TEC-8 在线汇编</span>
        <div className="header-spacer" />

        {/* Save */}
        <div className="hd-wrap" ref={saveWrapRef}>
          <button
            className="btn-hd"
            onClick={() => setOpenPanel(p => p === 'save' ? null : 'save')}
          >
            保存
          </button>
          {openPanel === 'save' && (
            <div className="hd-panel save-panel">
              <span className="hd-panel-title">保存当前代码</span>
              <div className="save-row">
                <input
                  autoFocus
                  className="save-input"
                  placeholder="程序名称"
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && commitSave()}
                />
                <button className="save-confirm" onClick={commitSave} title="确认保存"><IconFloppy /></button>
              </div>
            </div>
          )}
        </div>

        {/* Load */}
        <div className="hd-wrap" ref={loadWrapRef}>
          <button
            className="btn-hd"
            onClick={() => setOpenPanel(p => p === 'load' ? null : 'load')}
          >
            加载{saves.length > 0 && <span className="saves-badge">{saves.length}</span>}
          </button>
          {openPanel === 'load' && (
            <div className="hd-panel load-panel">
              <span className="hd-panel-title">已保存的程序</span>
              {saves.length === 0 ? (
                <div className="load-empty">暂无保存的程序</div>
              ) : (
                <div className="load-list">
                  {saves.map(s => (
                    <div key={s.id} className="load-item" onClick={() => loadEntry(s)}>
                      <div className="load-meta">
                        <span className="load-name">{s.name}</span>
                        <span className="load-date">{fmtDate(s.savedAt)}</span>
                      </div>
                      <button
                        className="load-del"
                        title="删除"
                        onClick={e => deleteEntry(s.id, e)}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="hd-divider" />

        <button className="btn-hd btn-hd-icon" onClick={toggleTheme} title={isDark ? '切换亮色' : '切换暗色'}>
          {isDark ? <IconSun /> : <IconMoon />}
          <span>{isDark ? '亮色' : '暗色'}</span>
        </button>
      </header>

      <div className="status-bar">
        {errors.length > 0 ? (
          <div className="status-errors">
            {errors.map(e => (
              <span key={e.lineIdx} className="status-err-item">
                <span className="err-loc">L{e.lineIdx + 1}</span>
                {e.error}
              </span>
            ))}
          </div>
        ) : (
          <span className="status-ok">就绪</span>
        )}
      </div>

      <div className="panels">
        <div className="panel panel-left">
          <div className="panel-header"><span>汇编源码</span></div>
          <div className="editor-container">
            <CodeMirror
              value={source}
              height="100%"
              theme="none"
              onChange={setSource}
              onUpdate={onUpdate}
              onCreateEditor={view => {
                editorViewRef.current = view
                view.scrollDOM.addEventListener('scroll', () => {
                  if (rightScrollRef.current)
                    rightScrollRef.current.scrollTop = view.scrollDOM.scrollTop
                }, { passive: true })
              }}
              extensions={extensions}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
                foldGutter: false,
                bracketMatching: false,
                closeBrackets: false,
                autocompletion: false,
                searchKeymap: false,
                syntaxHighlighting: false,
              }}
            />
          </div>
        </div>

        <div className="panel panel-right">
          <div className="panel-header">
            <span>机器码（二进制）</span>
            <button className="btn-copy" onClick={copyMachineCode}>
              {copied ? '已复制!' : '复制'}
            </button>
          </div>
          <div className="mc-scroll" ref={rightScrollRef}>
            <div className="mc-list">
              {lines.map((_, i) => {
                const r = lineResults[i]
                const isActive = i === activeLine
                const isErr = !!r?.error
                return (
                  <div
                    key={i}
                    ref={isActive ? activeRowRef : null}
                    className={`mc-row${isActive ? ' mc-active' : ''}${isErr ? ' mc-err' : ''}`}
                  >
                    <span className="mc-linenum">{i + 1}</span>
                    <span className="mc-addr">
                      {r?.address != null
                        ? r.address.toString(16).padStart(2, '0').toUpperCase()
                        : ''}
                    </span>
                    <span className="mc-content">
                      {isErr
                        ? <span className="mc-err-text">{r.error}</span>
                        : r?.byte != null ? <ByteDisplay byte={r.byte} /> : null}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
