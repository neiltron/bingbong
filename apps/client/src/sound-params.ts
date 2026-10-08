// Settings controls generated from the sound system's ParamSpec list, persisted in localStorage.
import type { AudioEngine, ParamSpec } from '@bingbong/client/audio'

const KEY = 'bingbong:params'
type Value = number | boolean | string

function loadSaved(): Record<string, Value> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return saved && typeof saved === 'object' ? saved : {}
  } catch {
    return {}
  }
}

/** Apply saved param values to the engine, then render one control per param into #sound-params. */
export function renderSoundParams(engine: AudioEngine): void {
  const saved = loadSaved()
  const specs = engine.params()
  for (const spec of specs) engine.setParam(spec.id, saved[spec.id] ?? spec.default)

  const persist = (id: string, value: Value) => {
    engine.setParam(id, value)
    saved[id] = value
    try {
      localStorage.setItem(KEY, JSON.stringify(saved))
    } catch {
      // private mode: applies for this page load only
    }
  }

  document.getElementById('sound-params')?.replaceChildren(
    ...specs.map((spec) => control(spec, saved[spec.id] ?? spec.default, persist)),
  )
}

function control(spec: ParamSpec, value: Value, onChange: (id: string, value: Value) => void): HTMLElement {
  const row = document.createElement('div')
  row.className = 'ctl-row'
  const label = document.createElement('label')
  label.htmlFor = `param-${spec.id}`
  label.textContent = spec.label
  row.append(label)

  if (spec.type === 'string') {
    const select = document.createElement('select')
    for (const opt of spec.options ?? []) select.add(new Option(String(opt)))
    select.value = String(value)
    select.addEventListener('input', () => onChange(spec.id, select.value))
    select.id = label.htmlFor
    row.append(select)
    return row
  }

  const input = document.createElement('input')
  input.id = label.htmlFor
  if (spec.type === 'boolean') {
    input.type = 'checkbox'
    input.checked = Boolean(value)
    input.addEventListener('input', () => onChange(spec.id, input.checked))
    row.append(input)
    return row
  }

  input.type = 'range'
  input.min = String(spec.min)
  input.max = String(spec.max)
  input.step = String(spec.step ?? 'any')
  input.value = String(value)
  const readout = document.createElement('span')
  readout.className = 'ctl-val'
  readout.textContent = input.value
  input.addEventListener('input', () => {
    readout.textContent = input.value
    onChange(spec.id, Number(input.value))
  })
  row.append(input, readout)
  return row
}
