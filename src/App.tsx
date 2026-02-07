import { useEffect, useMemo, useRef, useState } from 'react'

type Interfacing = 'parallel' | 'i2c'
type DataType = 'bin' | 'hex'
type LcdColor = 'green' | 'blue'

type SaveItem = {
  id: string
  name: string
  rows: number[] // 8 rows, each 0..31
  color: LcdColor
  interfacing: Interfacing
  datatype: DataType
  createdAt: number
  updatedAt: number
}

type History<T> = { past: T[]; present: T; future: T[] }

const ROWS = 8
const COLS = 5
const BASE32 = '0123456789ABCDEFGHIJKLMNOPQRSTUV'

function clampRowValue(v: number) {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(31, Math.trunc(v)))
}

function emptyRows(): number[] {
  return Array.from({ length: ROWS }, () => 0)
}

function rowsToGrid(rows: number[]): boolean[][] {
  return Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) => {
      // bit order matches the original site: c=0 is the left-most bit in the printed string.
      const bitIndex = COLS - 1 - c
      return ((rows[r] >> bitIndex) & 1) === 1
    }),
  )
}

function gridToRows(grid: boolean[][]): number[] {
  return grid.map((row) => {
    let v = 0
    for (let c = 0; c < COLS; c++) {
      const bitIndex = COLS - 1 - c
      if (row[c]) v |= 1 << bitIndex
    }
    return v
  })
}

function encodeRowsBase32(rows: number[]) {
  return rows.map((v) => BASE32[clampRowValue(v)] ?? '0').join('')
}

function decodeRowsBase32(s: string): number[] | null {
  if (s.length !== ROWS) return null
  const out: number[] = []
  for (let i = 0; i < ROWS; i++) {
    const idx = BASE32.indexOf(s[i]!.toUpperCase())
    if (idx < 0) return null
    out.push(idx)
  }
  return out
}

function rowsToBinaryStrings(rows: number[]): string[] {
  return rows.map((v) => {
    const bits = v.toString(2).padStart(COLS, '0')
    return `B${bits}`
  })
}

function rowsToHexStrings(rows: number[]): string[] {
  return rows.map((v) => `0x${clampRowValue(v).toString(16).toUpperCase().padStart(2, '0')}`)
}

function buildArduinoCode(rows: number[], interfacing: Interfacing, datatype: DataType) {
  const lines = datatype === 'hex' ? rowsToHexStrings(rows) : rowsToBinaryStrings(rows)

  const templateParallel = `#include <LiquidCrystal.h>

LiquidCrystal lcd(12, 11, 5, 4, 3, 2); // RS, E, D4, D5, D6, D7

byte customChar[] = {
  {DataX0},
  {DataX1},
  {DataX2},
  {DataX3},
  {DataX4},
  {DataX5},
  {DataX6},
  {DataX7}
};

void setup() {
  lcd.begin(16, 2);
  lcd.createChar(0, customChar);
  lcd.home();
  lcd.write(0);
}

void loop() { }
`

  const templateI2c = `#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// Set the LCD address to 0x27 in PCF8574 by NXP and Set to 0x3F in PCF8574A by Ti
LiquidCrystal_I2C lcd(0x3F, 16, 2);

byte customChar[] = {
  {DataX0},
  {DataX1},
  {DataX2},
  {DataX3},
  {DataX4},
  {DataX5},
  {DataX6},
  {DataX7}
};

void setup() {
  lcd.begin();
  lcd.createChar(0, customChar);
  lcd.home();
  lcd.write(0);
}

void loop() { }
`

  let code = interfacing === 'parallel' ? templateParallel : templateI2c
  for (let i = 0; i < ROWS; i++) code = code.replace(`{DataX${i}}`, lines[i]!)
  return code.trimEnd()
}

function makeId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16)
}

function loadSaves(): SaveItem[] {
  try {
    const raw = localStorage.getItem('lcdcc:saves')
    if (!raw) return []
    const parsed = JSON.parse(raw) as SaveItem[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x) => x && Array.isArray(x.rows) && x.rows.length === ROWS)
      .map((x) => ({
        ...x,
        rows: x.rows.map((v) => clampRowValue(v)),
      }))
  } catch {
    return []
  }
}

function persistSaves(items: SaveItem[]) {
  localStorage.setItem('lcdcc:saves', JSON.stringify(items))
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function App() {
  const [color, setColor] = useState<LcdColor>('green')
  const [interfacing, setInterfacing] = useState<Interfacing>('parallel')
  const [datatype, setDatatype] = useState<DataType>('bin')

  const [history, setHistory] = useState<History<number[]>>({
    past: [],
    present: emptyRows(),
    future: [],
  })

  const [saves, setSaves] = useState<SaveItem[]>([])
  const [selectedSaveId, setSelectedSaveId] = useState<string>('')

  const grid = useMemo(() => rowsToGrid(history.present), [history.present])
  const code = useMemo(
    () => buildArduinoCode(history.present, interfacing, datatype),
    [history.present, interfacing, datatype],
  )

  const dragging = useRef(false)
  const paintValue = useRef<boolean>(true)

  function commitRows(nextRows: number[]) {
    setHistory((h) => {
      const same = h.present.every((v, i) => v === nextRows[i])
      if (same) return h
      return { past: [...h.past, h.present], present: nextRows, future: [] }
    })
  }

  function setPixel(r: number, c: number, v: boolean) {
    const nextGrid = grid.map((row) => row.slice())
    nextGrid[r]![c] = v
    commitRows(gridToRows(nextGrid))
  }

  function handlePointerDown(r: number, c: number) {
    const current = grid[r]![c]!
    dragging.current = true
    paintValue.current = !current
    setPixel(r, c, paintValue.current)
  }

  function handlePointerEnter(r: number, c: number) {
    if (!dragging.current) return
    const current = grid[r]![c]!
    if (current === paintValue.current) return
    setPixel(r, c, paintValue.current)
  }

  function stopDrag() {
    dragging.current = false
  }

  function clear() {
    commitRows(emptyRows())
  }

  function invert() {
    const next = history.present.map((v) => clampRowValue((~v) & 0b11111))
    commitRows(next)
  }

  function undo() {
    setHistory((h) => {
      if (h.past.length === 0) return h
      const prev = h.past[h.past.length - 1]!
      return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] }
    })
  }

  function redo() {
    setHistory((h) => {
      if (h.future.length === 0) return h
      const next = h.future[0]!
      return { past: [...h.past, h.present], present: next, future: h.future.slice(1) }
    })
  }

  async function copyCode() {
    await navigator.clipboard.writeText(code)
  }

  function currentShareUrl() {
    const url = new URL(window.location.href)
    url.searchParams.set('r', encodeRowsBase32(history.present))
    url.searchParams.set('c', color)
    url.searchParams.set('i', interfacing)
    url.searchParams.set('t', datatype)
    return url.toString()
  }

  async function copyShareLink() {
    await navigator.clipboard.writeText(currentShareUrl())
  }

  function syncUrlFromState() {
    const url = new URL(window.location.href)
    url.searchParams.set('r', encodeRowsBase32(history.present))
    url.searchParams.set('c', color)
    url.searchParams.set('i', interfacing)
    url.searchParams.set('t', datatype)
    window.history.replaceState({}, '', url)
  }

  // Load from URL + saved list once.
  useEffect(() => {
    setSaves(loadSaves())

    const url = new URL(window.location.href)
    const r = url.searchParams.get('r')
    const c = url.searchParams.get('c') as LcdColor | null
    const i = url.searchParams.get('i') as Interfacing | null
    const t = url.searchParams.get('t') as DataType | null

    if (c === 'green' || c === 'blue') setColor(c)
    if (i === 'parallel' || i === 'i2c') setInterfacing(i)
    if (t === 'bin' || t === 'hex') setDatatype(t)

    if (r) {
      const decoded = decodeRowsBase32(r)
      if (decoded) setHistory({ past: [], present: decoded, future: [] })
    }
  }, [])

  // Keep URL shareable as you edit.
  useEffect(() => {
    syncUrlFromState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.present, color, interfacing, datatype])

  function saveNew() {
    const now = Date.now()
    const item: SaveItem = {
      id: makeId(),
      name: `Character ${new Date(now).toLocaleString()}`,
      rows: [...history.present],
      color,
      interfacing,
      datatype,
      createdAt: now,
      updatedAt: now,
    }
    const next = [item, ...saves]
    setSaves(next)
    setSelectedSaveId(item.id)
    persistSaves(next)
  }

  function overwriteSelected() {
    if (!selectedSaveId) return
    const now = Date.now()
    const next = saves.map((s) =>
      s.id === selectedSaveId
        ? { ...s, rows: [...history.present], color, interfacing, datatype, updatedAt: now }
        : s,
    )
    setSaves(next)
    persistSaves(next)
  }

  function loadSelected() {
    const item = saves.find((s) => s.id === selectedSaveId)
    if (!item) return
    setColor(item.color)
    setInterfacing(item.interfacing)
    setDatatype(item.datatype)
    setHistory({ past: [], present: item.rows.map(clampRowValue), future: [] })
  }

  function renameSelected(name: string) {
    if (!selectedSaveId) return
    const next = saves.map((s) => (s.id === selectedSaveId ? { ...s, name } : s))
    setSaves(next)
    persistSaves(next)
  }

  function deleteSelected() {
    if (!selectedSaveId) return
    const next = saves.filter((s) => s.id !== selectedSaveId)
    setSaves(next)
    setSelectedSaveId('')
    persistSaves(next)
  }

  function exportSaves() {
    downloadText('lcd-character-saves.json', JSON.stringify({ version: 1, saves }, null, 2))
  }

  function exportCurrent() {
    const payload = {
      version: 1,
      character: {
        rows: history.present,
        color,
        interfacing,
        datatype,
      },
    }
    downloadText('lcd-character.json', JSON.stringify(payload, null, 2))
  }

  function importJsonFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '')
        const parsed = JSON.parse(text) as any

        if (parsed?.saves && Array.isArray(parsed.saves)) {
          const merged = [...parsed.saves, ...saves]
            .filter((x: any) => x && Array.isArray(x.rows) && x.rows.length === ROWS)
            .map((x: any) => ({
              id: String(x.id ?? makeId()),
              name: String(x.name ?? 'Imported'),
              rows: (x.rows as any[]).map((v) => clampRowValue(Number(v))),
              color: x.color === 'blue' ? 'blue' : 'green',
              interfacing: x.interfacing === 'i2c' ? 'i2c' : 'parallel',
              datatype: x.datatype === 'hex' ? 'hex' : 'bin',
              createdAt: Number(x.createdAt ?? Date.now()),
              updatedAt: Number(x.updatedAt ?? Date.now()),
            })) as SaveItem[]
          setSaves(merged)
          persistSaves(merged)
          return
        }

        if (parsed?.character?.rows && Array.isArray(parsed.character.rows)) {
          const rows = (parsed.character.rows as any[]).slice(0, ROWS).map((v) => clampRowValue(Number(v)))
          while (rows.length < ROWS) rows.push(0)
          const c = parsed.character.color as LcdColor
          const i = parsed.character.interfacing as Interfacing
          const t = parsed.character.datatype as DataType
          if (c === 'green' || c === 'blue') setColor(c)
          if (i === 'parallel' || i === 'i2c') setInterfacing(i)
          if (t === 'bin' || t === 'hex') setDatatype(t)
          setHistory({ past: [], present: rows, future: [] })
          return
        }

        throw new Error('Unrecognized JSON shape')
      } catch (e) {
        alert(`Import failed: ${(e as Error).message}`)
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className={`app theme-${color}`} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
      <header className="topbar">
        <div className="brand">
          <div className="title">LCD Character Creator</div>
          <div className="subtitle">Modern remake (5×8) · Arduino code · Save/Share</div>
        </div>
        <div className="top-actions">
          <button className="btn" onClick={undo} disabled={history.past.length === 0}>
            Undo
          </button>
          <button className="btn" onClick={redo} disabled={history.future.length === 0}>
            Redo
          </button>
          <button className="btn" onClick={clear}>
            Clear
          </button>
          <button className="btn" onClick={invert}>
            Invert
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="card">
          <div className="card-title">Draw</div>

          <div className="grid-wrap" role="application" aria-label="Pixel editor">
            <div className="lcd-frame">
              <div className="pixel-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
                {grid.map((row, r) =>
                  row.map((on, c) => (
                    <button
                      key={`${r}-${c}`}
                      type="button"
                      className={`px ${on ? 'on' : 'off'}`}
                      aria-pressed={on}
                      aria-label={`Row ${r + 1}, Col ${c + 1}: ${on ? 'on' : 'off'}`}
                      onPointerDown={() => handlePointerDown(r, c)}
                      onPointerEnter={() => handlePointerEnter(r, c)}
                    />
                  )),
                )}
              </div>
            </div>
          </div>

          <div className="hint">
            Tip: click-drag to paint. A stroke toggles based on the first pixel you touch.
          </div>

          <div className="settings">
            <div className="field">
              <div className="label">LCD Color</div>
              <div className="seg">
                <button className={`segbtn ${color === 'green' ? 'active' : ''}`} onClick={() => setColor('green')}>
                  Green
                </button>
                <button className={`segbtn ${color === 'blue' ? 'active' : ''}`} onClick={() => setColor('blue')}>
                  Blue
                </button>
              </div>
            </div>

            <div className="field">
              <div className="label">Interfacing</div>
              <div className="seg">
                <button
                  className={`segbtn ${interfacing === 'parallel' ? 'active' : ''}`}
                  onClick={() => setInterfacing('parallel')}
                >
                  Parallel
                </button>
                <button className={`segbtn ${interfacing === 'i2c' ? 'active' : ''}`} onClick={() => setInterfacing('i2c')}>
                  I2C
                </button>
              </div>
            </div>

            <div className="field">
              <div className="label">Data Type</div>
              <div className="seg">
                <button className={`segbtn ${datatype === 'bin' ? 'active' : ''}`} onClick={() => setDatatype('bin')}>
                  Binary
                </button>
                <button className={`segbtn ${datatype === 'hex' ? 'active' : ''}`} onClick={() => setDatatype('hex')}>
                  Hex
                </button>
              </div>
            </div>
          </div>

          <div className="share-row">
            <button className="btn" onClick={copyShareLink}>
              Copy share link
            </button>
            <div className="share-code" title="Base32 rows (one char per row)">
              r={encodeRowsBase32(history.present)}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-title">Code</div>
          <pre className="code" aria-label="Generated Arduino code">
            <code>{code}</code>
          </pre>
          <div className="code-actions">
            <button className="btn primary" onClick={copyCode}>
              Copy code
            </button>
            <button className="btn" onClick={exportCurrent}>
              Export current (.json)
            </button>
          </div>
        </section>

        <section className="card">
          <div className="card-title">Saves</div>

          <div className="saves">
            <div className="row">
              <select value={selectedSaveId} onChange={(e) => setSelectedSaveId(e.target.value)}>
                <option value="">Select a save…</option>
                {saves.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={loadSelected} disabled={!selectedSaveId}>
                Load
              </button>
            </div>

            <div className="row">
              <button className="btn" onClick={saveNew}>
                Save new
              </button>
              <button className="btn" onClick={overwriteSelected} disabled={!selectedSaveId}>
                Overwrite selected
              </button>
              <button className="btn danger" onClick={deleteSelected} disabled={!selectedSaveId}>
                Delete
              </button>
            </div>

            <div className="row">
              <input
                type="text"
                placeholder="Rename selected…"
                value={saves.find((s) => s.id === selectedSaveId)?.name ?? ''}
                onChange={(e) => renameSelected(e.target.value)}
                disabled={!selectedSaveId}
              />
            </div>

            <div className="row">
              <button className="btn" onClick={exportSaves} disabled={saves.length === 0}>
                Export all saves (.json)
              </button>
              <label className="btn file">
                Import .json
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) importJsonFile(f)
                    e.currentTarget.value = ''
                  }}
                />
              </label>
            </div>

            <details className="details">
              <summary>About import/export</summary>
              <div className="details-body">
                You can import either a single character export (lcd-character.json) or a full saves export
                (lcd-character-saves.json). Imported saves are merged into your local list.
              </div>
            </details>
          </div>
        </section>

        <section className="card">
          <div className="card-title">Links</div>
          <ul className="links">
            <li>
              <a href="https://github.com/maxpromer/LCD-Character-Creator" target="_blank" rel="noreferrer">
                Original project
              </a>
            </li>
            <li>
              <a href="https://github.com/fdebrabander/Arduino-LiquidCrystal-I2C-library" target="_blank" rel="noreferrer">
                LiquidCrystal_I2C library
              </a>
            </li>
          </ul>
        </section>
      </main>

      <footer className="footer">
        Built with Vite + React. Works offline once loaded. Share links encode the 5×8 bitmap (one Base32 char per row).
      </footer>
    </div>
  )
}
