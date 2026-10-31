"""Run the real upstream protocol package against this plugin, without API calls.
Usage: python tests/verify.py --upstream PATH_TO_OPEN_AI_CANVAS [--go PATH_TO_GO]
"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

p=argparse.ArgumentParser()
p.add_argument('--upstream',type=Path,required=True)
p.add_argument('--go',default='go')
a=p.parse_args()
root=Path(__file__).resolve().parents[1]
source=a.upstream/'backend/internal/protocol'
if not (source/'manifest.go').is_file(): p.error('upstream protocol sources not found')
with tempfile.TemporaryDirectory(prefix='yingce-ecommerce-check-') as directory:
    out=Path(directory)
    for f in source.glob('*.go'):
        if not f.name.endswith('_test.go'): shutil.copy2(f,out/f.name)
    shutil.copytree(source/'docs',out/'docs')
    shutil.copy2(root/'tests/ecommerce_test.go',out/'ecommerce_test.go')
    (out/'go.mod').write_text('module plugincheck\n\ngo 1.25.0\n',encoding='utf-8')
    env=dict(os.environ,ECOMMERCE_PACKAGE=str(root/'ecommerce-image-studio-1.0.0.yingce-plugin'),GOTOOLCHAIN='local')
    subprocess.run([a.go,'test','-v','.'],cwd=out,env=env,check=True)
