import { useEffect, useMemo, useRef, useState } from 'react'

type Interfacing = 'parallel' | 'i2c'
type DataType = 'bin' | 'hex'
type LcdColor = 'green' | 'blue' | 'amber' | 'white' | 'red'

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

  const templateParallel = `#include <hd44780.h>
#include <hd44780ioClass/hd44780_pinIO.h>

// Pin wiring: RS, EN, D4, D5, D6, D7
const int LCD_RS = 12;
const int LCD_EN = 11;
const int LCD_D4 = 5;
const int LCD_D5 = 4;
const int LCD_D6 = 3;
const int LCD_D7 = 2;

hd44780_pinIO lcd(LCD_RS, LCD_EN, LCD_D4, LCD_D5, LCD_D6, LCD_D7);

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
  int status = lcd.begin(16, 2);
  if (status) {
    // If you want error details, see: https://github.com/duinoWitchery/hd44780
    // status = lcd.status();
  }

  lcd.createChar(0, customChar);
  lcd.clear();
  lcd.home();
  lcd.write((uint8_t)0);
}

void loop() { }
`

  const templateI2c = `#include <hd44780.h>
#include <hd44780ioClass/hd44780_I2Cexp.h>

// Uses the hd44780 "I2Cexp" i/o class for PCF8574 backpacks.
// It can auto-detect the I2C address and the pin mapping on most modules.
hd44780_I2Cexp lcd;

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
  int status = lcd.begin(16, 2);
  if (status) {
    // If you want error details, see: https://github.com/duinoWitchery/hd44780
    // status = lcd.status();
  }

  lcd.createChar(0, customChar);
  lcd.clear();
  lcd.home();
  lcd.write((uint8_t)0);
}

void loop() { }
`

  let code = interfacing === 'parallel' ? templateParallel : templateI2c
  for (let i = 0; i < ROWS; i++) code = code.replace(`{DataX${i}}`, lines[i]!)
  return code.trimEnd()
}

function downloadFile(filename: string, text: string, mimeType: string) {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function lcdColorValues(): LcdColor[] {
  return ['green', 'blue', 'amber', 'white', 'red']
}

function isLcdColor(x: any): x is LcdColor {
  return lcdColorValues().includes(x)
}

export function App() {
  // 1) Default LCD color to Green
  const [color, setColor] = useState<LcdColor>('green')

  // 2) Default interfacing to I2C
  const [interfacing, setInterfacing] = useState<Interfacing>('i2c')

  // 3) Default data type to Binary
  const [datatype, setDatatype] = useState<DataType>('bin')

  const [history, setHistory] = useState<History<number[]>>({
    past: [],
    present: emptyRows(),
    future: [],
  })

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

  function downloadCode() {
    downloadFile('lcd_custom_char.ino', code + '\n', 'text/plain')
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
    downloadFile('lcd-character.json', JSON.stringify(payload, null, 2) + '\n', 'application/json')
  }

  function syncUrlFromState() {
    const url = new URL(window.location.href)
    url.searchParams.set('r', encodeRowsBase32(history.present))
    url.searchParams.set('c', color)
    url.searchParams.set('i', interfacing)
    url.searchParams.set('t', datatype)
    window.history.replaceState({}, '', url)
  }

  // Load from URL once.
  useEffect(() => {
    const url = new URL(window.location.href)
    const r = url.searchParams.get('r')
    const c = url.searchParams.get('c')
    const i = url.searchParams.get('i') as Interfacing | null
    const t = url.searchParams.get('t') as DataType | null

    if (isLcdColor(c)) setColor(c)
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

  async function copyShareLink() {
    const url = new URL(window.location.href)
    url.searchParams.set('r', encodeRowsBase32(history.present))
    url.searchParams.set('c', color)
    url.searchParams.set('i', interfacing)
    url.searchParams.set('t', datatype)
    await navigator.clipboard.writeText(url.toString())
  }

  return (
    <div className={`app theme-${color}`} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
      <header className="topbar">
        <div className="brand">
          <div className="title">LCD Character Creator</div>
          <div className="subtitle">5×8 · Arduino code (hd44780) · Share link</div>
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

          <div className="hint">Tip: click-drag to paint. A stroke toggles based on the first pixel you touch.</div>

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
                <button className={`segbtn ${color === 'amber' ? 'active' : ''}`} onClick={() => setColor('amber')}>
                  Amber
                </button>
                <button className={`segbtn ${color === 'white' ? 'active' : ''}`} onClick={() => setColor('white')}>
                  White
                </button>
                <button className={`segbtn ${color === 'red' ? 'active' : ''}`} onClick={() => setColor('red')}>
                  Red
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
            <button className="btn" onClick={downloadCode}>
              Download code (.ino)
            </button>
            <button className="btn" onClick={exportCurrent}>
              Export character (.json)
            </button>
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
              <a href="https://github.com/duinoWitchery/hd44780" target="_blank" rel="noreferrer">
                hd44780 library (Bill Perry)
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
