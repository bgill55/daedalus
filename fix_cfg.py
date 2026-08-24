import io, json

p = 'C:/Users/brica/.daedalus/config.json'
with io.open(p, encoding='utf-8') as f:
    cfg = json.load(f)

chain = cfg['router']['chain']
# Find a freellmapi entry that already has a key to copy from.
donor = next((e for e in chain if e.get('provider') == 'freellmapi' and e.get('apiKey')), None)
if not donor:
    raise SystemExit('No freellmapi entry with an apiKey found to copy from.')

key = donor['apiKey']
target = next((e for e in chain if e.get('name') == 'ox-alpha'), None)
if not target:
    raise SystemExit('ox-alpha entry not found.')

changed = False
if target.get('apiKey') != key:
    target['apiKey'] = key
    changed = True

with io.open(p, 'w', encoding='utf-8') as f:
    json.dump(cfg, f, indent=2)
    f.write('\n')

print('ox-alpha apiKey set:', 'YES' if changed else 'already present')
print('copied from entry:', donor['name'])
