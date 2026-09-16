from pathlib import Path
import hashlib
import zipfile

root = Path(__file__).resolve().parents[1]
source = root / 'skills/clipmivo-film'
destination = root / 'dist-film'
destination.mkdir(exist_ok=True)
files = [
    'LICENSE', 'SKILL.md', 'examples/character-film.json', 'examples/film.json',
    'references/install.md', 'references/manifest.md', 'scripts/api.mjs',
    'scripts/edit.py', 'scripts/film.mjs', 'scripts/images.mjs',
    'tests/film.test.mjs', 'tests/make-fixture.py',
]
archive = destination / 'clipmivo-film-preview-0.3.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
    for relative in sorted(files):
        info = zipfile.ZipInfo('clipmivo-film/' + relative, (2026, 9, 16, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        info.create_system = 3
        bundle.writestr(info, (source / relative).read_bytes(), compresslevel=9)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(destination / 'SHA256SUMS.txt').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
print(f'{digest}  {archive.name}')
