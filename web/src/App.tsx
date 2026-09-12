import { useEffect, useState } from 'react'
import Uppy from '@uppy/core'
import Tus from '@uppy/tus'
import Dashboard from '@uppy/react/dashboard'

const MB = 1024 * 1024
const NAME_KEY = 'uploader-name'

function makeUppy() {
  return new Uppy({
    restrictions: { allowedFileTypes: ['image/*', 'video/*'], maxFileSize: 500 * MB },
  }).use(Tus, {
    endpoint: '/files/',
    chunkSize: 25 * MB, // Cloudflare free tier caps a request at 100 MB
    limit: 3,
    retryDelays: [0, 1000, 3000, 5000],
    allowedMetaFields: ['filename', 'filetype', 'uploader'],
  })
}

export default function App() {
  const [uppy] = useState(makeUppy)
  const [name, setName] = useState(() => {
    try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' }
  })

  useEffect(() => {
    uppy.setMeta({ uploader: name })
    try { localStorage.setItem(NAME_KEY, name) } catch { /* private mode */ }
  }, [uppy, name])

  return (
    <div className="wrap">
      <label className="name">
        Your name (so your files land in your own folder)
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Alice"
          autoComplete="name"
          maxLength={40}
        />
      </label>
      <Dashboard
        uppy={uppy}
        width="100%"
        height="70vh"
        proudlyDisplayPoweredByUppy={false}
        note="Photos and videos, up to 500 MB each"
      />
    </div>
  )
}
