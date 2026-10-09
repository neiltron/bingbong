// Settings controls generated from the sound system's ParamSpec list, persisted in localStorage.
import type { AudioEngine, ParamSpec } from '@bingbong/client/audio'

const KEY = 'bingbong:params'
type Value = number | boolean | string

function loadSaved(): Record<string, unknown> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
  } catch {
    return {}
  }
}

function store(record: Record<string, Value>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(record))
  } catch {
    // private mode: applies for this page load only
  }
}

/**
 * Apply saved param values to the engine, then render one control per param into #sound-params.
 * Controls and storage show what the engine actually stored, so corrupt saved values can't disagree with the sound.
 */
export function renderSoundParams(engine: AudioEngine): void {
  const saved = loadSaved()
  const specs = engine.params()
  const values: Record<string, Value> = {}
  for (const spec of specs) values[spec.id] = engine.setParam(spec.id, (saved[spec.id] ?? spec.default) as Value)
  store(values)

  const persist = (id: string, value: Value) => {
    values[id] = engine.setParam(id, value)
    store(values)
  }

  document.getElementById('sound-params')?.replaceChildren(
    ...specs.map((spec) => control(spec, values[spec.id], persist)),
  )
}

function control(spec: ParamSpec, value: Value, onChange: (id: string, value: Value) => void): HTMLElement {
  const row = document.createElement('div')
  row.className = 'ctl-row'
  const label = document.createElement('label')
  label.htmlFor = `param-${spec.id}`
  label.textContent = spec.label
  row.append(label)

  if (spec.type === 'string' && !spec.options) {
    const input = document.createElement('input')
    input.type = 'text'
    input.id = label.htmlFor
    input.value = String(value)
    input.addEventListener('change', () => onChange(spec.id, input.value))
    row.append(input)
    return row
  }

  if (spec.type === 'string') {
    const select = document.createElement('select')
    for (const opt of spec.options!) select.add(new Option(String(opt)))
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
