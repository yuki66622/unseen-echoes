"""Owner-run import of approved single-player snapshots; never synchronizes chase."""
from pathlib import Path
import hashlib
import json
import re

SITE = Path(__file__).resolve().parent
GAME = SITE.parent.parent
PUBLIC = SITE / 'public'
manifest = {}

def copy(source, route, transform=None):
    raw = source.read_bytes()
    manifest[route] = {'source': str(source.relative_to(GAME.parent)), 'sha256': hashlib.sha256(raw).hexdigest()}
    target = PUBLIC / route
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(transform(raw.decode()).encode() if transform else raw)

tutorial = ('index.html','style.css','blind.css','glitter.js','chat-beam.bundle.mjs','chat-beam.bundle.css',
            'app.mjs','world.mjs','room-layout.mjs','sound-engine.mjs','sound-catalog.mjs','voice-input.mjs',
            'voice-capture-worklet.js','voice-commands.mjs','voice-plan.mjs','voice-output.mjs','movement.mjs')
for name in tutorial:
    transform = None
    if name in ('voice-input.mjs','voice-output.mjs'):
        transform = lambda s: s.replace('/api/voice/', '/api/tutorial/')
    elif name == 'sound-catalog.mjs':
        transform = lambda s: s.replace('./assets/', '/assets/')
    elif name == 'index.html':
        transform = lambda s: s.replace('</head>', '<link rel="stylesheet" href="/journey.css"></head>').replace('</body>', '<script type="module" src="/journey.mjs"></script></body>')
    copy(GAME / name, 'tutorial/' + name, transform)

for name in ('index.html','style.css','app.mjs','world.mjs','audio.mjs','acoustics.mjs','navigation-hint.mjs','trail-map.mjs','data.json'):
    transform = None
    if name == 'app.mjs':
        transform = lambda s: s.replace("from '/voice-input.mjs'", "from './voice-input.mjs'")
    elif name == 'index.html':
        transform = lambda s: s.replace('</head>', '<link rel="stylesheet" href="/journey.css"></head>').replace('</body>', '<script type="module" src="/journey.mjs"></script></body>')
    if name == 'data.json':
        transform=lambda s:json.dumps({k:v for k,v in json.loads(s).items() if k!='intro_source'},ensure_ascii=False,indent=2)
    copy(GAME / 'hotel' / name, 'hotel/' + name, transform)
copy(GAME/'voice-input.mjs','hotel/voice-input.mjs',lambda s:s.replace('/api/voice/','/api/hotel/').replace('25_000','45_000'))
copy(GAME/'voice-capture-worklet.js','hotel/voice-capture-worklet.js')
for name in ('chat-beam.bundle.mjs','chat-beam.bundle.css','glitter.js'):
    copy(GAME/name,name)
data = json.loads((GAME/'hotel/data.json').read_text())
for asset in data['catalog']['assets'].values():
    route = asset['url'].lstrip('/')
    assert route.startswith('hotel/assets/') and '..' not in route
    copy(GAME/route,route)
for name in ('CHAT_BEAM_NOTICES.txt','CURSOR_SOURCE.md','EDGECHAT_AUDIO_SOURCES.md'):
    copy(GAME/name,'licenses/'+name)
copy(GAME/'hotel/ASSET_PROVENANCE.json','licenses/hotel-assets.json',lambda s:json.dumps([{**r,'source':Path(r['source']).name} for r in json.loads(s)],ensure_ascii=False,indent=2))

opening = GAME.parent/'game-ui-concepts/2026-09-20/atmosphere-opening/unseen-atmospheres.html'
code = re.search(r'<script>(.*?)</script>',opening.read_text(),re.S)[1]
# Import the established renderer definitions, excluding the comparison UI.
renderer = code[:code.index("(()=>{\n  'use strict';")]
copy(opening,'nebula-source.js',lambda _: renderer)
(SITE/'upstream-snapshot.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
print(f'Imported {len(manifest)} allowlisted files. Existing multiplayer snapshot preserved.')
