import { useEffect, useState } from 'react'
import Uppy from '@uppy/core'
import Tus from '@uppy/tus'
import Dashboard from '@uppy/react/dashboard'

const MB = 1024 * 1024
// Uppy locale packs, loaded on demand. ?lang=fr wins, then browser languages.
const localeModules = import.meta.glob<{ default: unknown }>('../node_modules/@uppy/locales/lib/*_*.js')
const localeNames = Object.keys(localeModules).map((p) => p.split('/').pop()!.replace('.js', ''))

export function pickLocale(wanted: readonly string[], names: readonly string[] = localeNames): string | undefined {
  for (const tag of wanted) {
    const [lang, region] = tag.toLowerCase().split(/[-_]/)
    if (!lang || lang === 'en') return undefined // en_US is Uppy's default
    const exact = names.find((n) => n.toLowerCase() === `${lang}_${region ?? ''}`)
    if (exact) return exact
    const prefix = names.find((n) => n.toLowerCase().startsWith(`${lang}_`))
    if (prefix) return prefix
  }
  return undefined
}

function makeUppy() {
  return new Uppy({
    restrictions: { allowedFileTypes: ['image/*', 'video/*'], maxFileSize: 500 * MB },
  }).use(Tus, {
    endpoint: '/files/',
    chunkSize: 25 * MB, // Cloudflare free tier caps a request at 100 MB
    limit: 3,
    retryDelays: [0, 1000, 3000, 5000],
    allowedMetaFields: ['name', 'type'], // @uppy/tus maps name→filename, type→filetype
  })
}

export default function App() {
  const [uppy] = useState(makeUppy)

  useEffect(() => {
    const forced = new URLSearchParams(location.search).get('lang')
    const name = pickLocale(forced ? [forced] : navigator.languages)
    if (!name) return
    localeModules[`../node_modules/@uppy/locales/lib/${name}.js`]?.().then((m) => {
      uppy.setOptions({ locale: m.default as never })
    })
  }, [uppy])

  return (
    <div className="wrap">
      <Dashboard uppy={uppy} width="100%" height="calc(100dvh - 24px)" proudlyDisplayPoweredByUppy={false} />
    </div>
  )
}
