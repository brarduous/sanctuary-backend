"""Build a bounded research index from allowed sources; originals remain private.
Usage: python buildReferencePilot.py PRIVATE_OUTPUT_DIR
Requires pysword==0.2.8 only for the two SWORD commentary adapters.
Does not access Supabase, OpenAI, user data, or production publishing.
"""
import datetime, hashlib, html, json, pathlib, re, shutil, sys, urllib.request, zipfile
from pysword.modules import SwordModules

out = pathlib.Path(sys.argv[1]).resolve()
originals = out / 'originals'
originals.mkdir(parents=True, exist_ok=True)
corpus_file = pathlib.Path(__file__).resolve().parents[2] / 'content/discoveries/web-corpus.json'
sha = lambda b: hashlib.sha256(b).hexdigest()
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
registry, entries = [], []

def original(id, filename, url, title, license, attribution, version=None):
    p = originals / filename
    if not p.exists():
        req = urllib.request.Request(url, headers={'User-Agent': 'Sanctuary reference pilot/1.0'})
        p.write_bytes(urllib.request.urlopen(req, timeout=40).read())
    raw = p.read_bytes()
    source = dict(id=id, title=title, url=url, license=license, attribution=attribution,
                  version=version or ('sha256:' + sha(raw)), originalFile=filename,
                  sha256=sha(raw), bytes=len(raw), retrievedAt=now,
                  extractionVersion='trivia-reference-pilot-v1')
    registry.append(source)
    return p, source

def clean(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', s))).strip()

def add(source, id, type, locator, text, **extra):
    if not text.strip():
        return
    entries.append(dict(id=id, sourceId=source['id'], type=type, locator=locator,
                        text=text, excerptSha256=sha(text.encode()), **extra))

p, web = original('web', 'web-corpus.json', 'https://ebible.org/web/',
    'World English Bible (classic)', 'Public domain', 'World English Bible / eBible.org') if (originals/'web-corpus.json').exists() else (None, None)
if web is None:
    shutil.copyfile(corpus_file, originals/'web-corpus.json')
    p, web = original('web','web-corpus.json','https://ebible.org/web/',
        'World English Bible (classic)','Public domain','World English Bible / eBible.org')

p, step = original('step-tbesg', 'step-tbesg.txt',
    'https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Lexicons/TBESG%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Greek%20-%20STEPBible.org%20CC%20BY.txt',
    'STEPBible Translators Brief lexicon of Extended Strongs for Greek', 'CC BY 4.0',
    'STEPBible.org / Tyndale House, Cambridge; https://github.com/STEPBible/STEPBible-Data')
selected = {'G0652','G2385','G3686','G4209','G4210','G4611','G4211','G4712','G4871'}
for line_no, line in enumerate(p.read_text().splitlines(), 1):
    cols = line.split('\t')
    if len(cols) < 8 or cols[0] not in selected:
        continue
    add(step,'step-tbesg:'+str(line_no),'lexicon','TBESG line '+str(line_no),clean(cols[7]),
        language='grc', lemma=cols[3], transliteration=cols[4], strongId=cols[0],
        extendedId=cols[2], gloss=cols[6], aliases=[cols[0],cols[2],cols[3],cols[4]],
        uncertainty='Lexicon senses are not an assigned meaning for a particular verse. No root-based meaning inference.',
        passages=re.findall(r"<ref='([^']+)'", cols[7]))

p, geo = original('openbible-geo', 'openbible-ancient.jsonl',
    'https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/main/data/ancient.jsonl',
    'OpenBible.info Bible Geocoding: ancient places', 'CC BY 4.0',
    'OpenBible.info; https://www.openbible.info/geo/. No images or OSM geometry included.')
places = {'Nazareth','Thyatira','Philippi','Joppa','Malta','Siloam','Bethesda','Gibeon','Heshbon','Bethlehem'}
for line in p.read_text().splitlines():
    row=json.loads(line)
    if not any(row['friendly_id']==n or row['friendly_id'].startswith(n+' ') or row['friendly_id'].startswith(n+'_') for n in places):
        continue
    extra=json.loads(row.get('extra','{}'))
    # Deliberately exclude third-party media, coordinates and OSM geometry.
    candidates=[dict(name=clean(a.get('description','')), sourceId=a.get('id'),
                     assessment=a.get('score'), types=a.get('types',[])) for a in row.get('identifications',[])]
    names=[a['name'] for a in candidates]
    add(geo,'openbible:'+row['id'],'geography',row['friendly_id'],
        row['friendly_id']+'; candidate identifications: '+('; '.join(names) or 'unresolved'),
        aliases=[row['friendly_id']], placeId=row['id'], candidates=candidates,
        passages=extra.get('osises',[]), periods=[],
        uncertainty='Dataset identifications and scores are proposals, not archaeological certainty or calibrated probabilities.')

for pid in ['501482','678299']:
    p, source=original('pleiades-'+pid,'pleiades-'+pid+'.json',
        'https://pleiades.stoa.org/places/'+pid+'/json',
        'Pleiades ancient place '+pid,'CC BY 3.0','Pleiades contributors; per-entry creators retained')
    row=json.loads(p.read_text())
    if '3.0' not in row.get('rights',''):
        raise ValueError('Unrecognized Pleiades rights statement')
    source['attribution']='Pleiades: '+row['title']+'; '+', '.join(x['name'] for x in row.get('creators',[])+row.get('contributors',[]))+'; '+row['uri']
    periods=sorted({a['timePeriod'] for n in row.get('names',[])+row.get('locations',[]) for a in n.get('attestations',[])})
    add(source,'pleiades:'+pid,'geography',row['uri'],row['description'],
        aliases=[row['title']]+[n.get('romanized','') for n in row.get('names',[])],
        placeId=pid,periods=periods,
        attestations=[dict(name=n.get('romanized'),certainty=n.get('associationCertainty'),periods=n.get('attestations',[]),start=n.get('start'),end=n.get('end')) for n in row.get('names',[])],
        references=row.get('references',[]),
        uncertainty='Use each name’s attested periods and certainty. A modern identification does not prove every ancient claim.')

# SWORD zCom and zText share their indexed compressed verse layouts; the only
# adapter change is selecting PySword’s corresponding 16/32-bit zText reader.
# Keep each unchanged module archive and its complete license/configuration.
for name in ['MHC','Wesley']:
    p, source=original('sword-'+name.lower(), name+'.zip',
        'https://crosswire.org/ftpmirror/pub/sword/packages/rawzip/'+name+'.zip',
        "Matthew Henry’s Complete Commentary" if name=='MHC' else "John Wesley’s Notes on the Bible",
        'Public domain (CrossWire module distribution)', 'CrossWire SWORD; original module notices retained')
    modules=SwordModules(str(p));cfg=modules.parse_modules()[name]
    if cfg.get('distributionlicense')!='Public Domain':
        raise ValueError('Commentary lacks the required explicit distribution license')
    source['version']=cfg['version'];source['moduleNotice']=cfg['about']
    cfg['moddrv']='ztext4' if name=='MHC' else 'ztext'
    reader=modules.get_bible_from_module(name)
    for book,chapter,verse in [('John',9,7),('Acts',16,14),('Acts',9,36),('Ruth',4,7)]:
        text=reader.get(books=[book],chapters=[chapter],verses=[verse]).strip()
        locator=f'{book} {chapter}:{verse}'
        # Linked commentary entries may span multiple verses. Character offsets
        # locate exact excerpts in the full extracted entry, never fake pages.
        full_id=f'sword:{name}:{book}:{chapter}:{verse}'
        extracted=originals/(full_id.replace(':','-')+'.txt');extracted.write_text(text)
        source.setdefault('extractedEntries',[]).append(dict(file=extracted.name,locator=locator,sha256=sha(text.encode())))
        for start in range(0,len(text),1200):
            snippet=text[start:start+1200]
            add(source,full_id+':'+str(start),'commentary',locator,snippet,
                entryId=full_id,start=start,end=start+len(snippet),aliases=[book],
                passages=[locator],periods=[],
                uncertainty='Historical commentary and interpretation, not independent proof. The linked entry may discuss neighboring verses.')

index=dict(version='trivia-reference-pilot-v1',createdAt=now,sources=registry,entries=entries,
    restrictions=['Research only. Published claims still require the saved WEB passage.','No images, maps or OSM geometry redistributed.','No AI-generated STEP proper-name/concept dataset ingested.'])
(out/'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(sources=len(registry),entries=len(entries),indexSha256=sha((out/'index.json').read_bytes()))))
