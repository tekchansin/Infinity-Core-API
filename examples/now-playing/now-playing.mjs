// Now Playing (JavaScript): prints what plays. Uses: read.   node now-playing.mjs living-room.local
import { Extension } from 'infinity-core-api'

const ext = new Extension({ id: 'org.example.now-playing-js', name: 'Now Playing (JS)', version: '1.0.0', publisher: 'example', uses: ['read'] })
ext.onState((s) => { if (s === 'waiting') console.log('Waiting: enable it in Infinity Core › Settings › Extensions') })
ext.onReady(() => ext.subscribe(['zone.changed']))
ext.on('zone.changed', ({ zone }) => {
  const t = zone.nowPlaying?.track
  console.log(`${zone.name}: ${zone.state}${t ? ` — ${t.title} · ${t.artists.join(', ')}` : ''}`)
})
await ext.run({ host: process.argv[2] ?? '' })
