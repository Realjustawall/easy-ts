import json, zipfile
from html.parser import HTMLParser
from pathlib import PurePosixPath

class References(HTMLParser):
    def __init__(self):
        super().__init__(); self.paths=[]
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag in ('script','img') and attrs.get('src'): self.paths.append(attrs['src'])
        if tag=='link' and attrs.get('href'): self.paths.append(attrs['href'])

with zipfile.ZipFile('Easy-ts-1.8.0.zip') as archive:
    names=set(archive.namelist())
    assert json.loads(archive.read('manifest.json'))['version']=='1.8.0'
    for page in ['dashboard.html','popup.html','studio.html','settings.html','live.html','offscreen.html']:
        parser=References();parser.feed(archive.read(page).decode('utf-8'))
        for path in parser.paths:
            if '://' not in path:
                assert path.split('#')[0].split('?')[0] in names,(page,path)
    assert {'workspace.js','workspace.css','dashboard.js','fonts/Vazir-Regular.woff2','icons/ui/LICENSE.txt'} <= names
    assert all(not name.startswith(('tests/','output/','.playwright')) for name in names)
    print(f'Package verified: {len(names)} files; all HTML resources included; local icon and font licenses present.')
