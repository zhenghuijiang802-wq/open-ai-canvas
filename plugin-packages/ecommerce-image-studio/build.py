"""Build a deterministic Yingce v2 ecommerce image plugin. Python stdlib only."""
import copy
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent
ID = 'ecommerce-image-studio'
def ref(path): return {'$ref': path}
def default(value, fallback): return {'$coalesce': [value, fallback]}
def option(key, fallback): return default(ref(f'request.providerOptions.{ID}.{key}'), fallback)
def choose(key, choices, fallback):
    value = choices[fallback]
    for name, text in reversed(list(choices.items())):
        value = {'$if': {'condition': {'$eq': [option(key, fallback), name]}, 'then': text, 'else': value}}
    return value

SCENES = {
    '白底主图': '白底商品主图。背景纯白 #FFFFFF，单一商品主体居中，完整呈现，柔和自然接触阴影；默认商品占画面约 40%，留白至少 45%。不加道具、文字或装饰。用户提供明确平台占比要求时遵循该要求。',
    '使用场景图': '真实使用场景图。依据商品用途选择合理环境，商品清晰且为视觉焦点，默认占画面 25%，留白至少 50%。只添加使用所需的少量环境物件，不能让道具看起来是附赠品。',
    '核心卖点图': '单一核心卖点图。左侧商品占画面约 30%，右侧预留至少 45%干净文案区。只视觉化用户提供且参考图支持的卖点；不捏造认证、实验数据、对比效果或性能。',
    '材质细节图': '商品材质与工艺细节特写。只放大参考图可见的真实结构、接缝或表面纹理，主体清晰，景深自然，预留 45%干净区域。不臆造内部构造或不可见零件，不编造剖面图。',
    'SKU规格图': 'SKU规格展示图。只展示上传图片或说明中确实存在的款式与颜色；按一致视角、尺度和间距排列，商品组占画面约 65%。只有一个款式时仅展示一个，不推测尺寸或虚构颜色。',
    '活动横幅图': '横幅广告构图。商品置于右侧，占画面约 40%，左侧至少 45%留白用于文案，边缘保留 8%安全区。不添加用户未提供的价格、优惠幅度、销量或促销标签。',
}
STYLES = {
    '简洁棚拍': '柔和大面积棚灯，细腻真实材质，中性白平衡，背景 #FFFFFF，文字色 #2D2D2D。',
    '温暖生活': '自然窗光，暖中性色，背景 #F5F1E8，低饱和环境，真实生活摄影。',
    '冷调科技': '冷中性棚光，背景 #EEF2F6，克制的几何构图，真实工业材质；不添加虚构发光结构。',
    '深色质感': '深色背景 #1A1A1A，柔和侧光与轮廓光，控制高光，保留商品真实颜色。',
}
TEXT = {
    '不生成文字': '不新增任何文字、数字或图标；保留商品本身已有且可见的包装文字与标识。',
    '仅留文案区': '仅预留干净文案区，不实际绘制文案，供后期排版。保留商品原有标识。',
    '使用指定文案': '仅可绘制下方用户明确提供的文案，不自行编写。未提供则不绘制。标题建议不超过15字，卖点最多3条，CTA不超过8字；层级清晰，不遮挡商品。文字准确性需人工复核。',
}

def make():
    base = json.loads((ROOT / 'source/openai-images.manifest.json').read_text(encoding='utf-8'))
    p = copy.deepcopy(base['contributes']['providers'][0])
    p.update(id=ID, label='电商图工作室 · 商品参考图生成')
    p['parameters'] = [x for x in p['parameters'] if x['name'] != 'resolution']
    for x in p['parameters']:
        if x['name'] == 'images': x.update(required=True, description='至少一张商品原图；第一张是商品身份依据。')
    def param(name, label, values, initial):
        return dict(name=name, label=label, type='string', binding=f'providerOptions.{ID}.{name}', values=values, default=initial)
    p['imageParameters'] = [
        param('scene', '图片用途', list(SCENES), '白底主图'),
        param('style', '整套视觉风格', list(STYLES), '简洁棚拍'),
        param('textMode', '文案处理', list(TEXT), '不生成文字'),
        dict(name='copy', label='指定文案', type='string', binding=f'providerOptions.{ID}.copy', maxLength=300, default=''),
        dict(name='brand', label='品牌视觉约束', type='string', binding=f'providerOptions.{ID}.brand', maxLength=500, default='', description='例如：统一米白背景 #F5F1E8；保留包装颜色。同套图片保持此项不变。'),
        dict(name='size', label='图片尺寸', type='string', binding='aspectRatio', encoding='pixels', values=['1024x1024','1024x1536','1536x1024'], default='1024x1024', pricing=True),
        dict(name='quality', label='图片质量', type='string', binding='quality', values=['low','medium','high'], default='medium', pricing=True),
        dict(name='count', label='同款候选数量', type='integer', binding='imageCount', min=1, max=4, step=1, default=1),
    ]
    count = default(ref('request.imageCount'), 1)
    p['validations'] = [
        {'assert': {'$gt': [{'$len': ref('request.images')}, 0]}, 'message': '请先上传并连接至少一张商品参考图。'},
        {'assert': {'$lte': [{'$len': ref('request.images')}, 6]}, 'message': '每次最多使用6张商品参考图。'},
        {'assert': {'$eq': [{'$len': {'$filter': {'from': ref('request.images'), 'as':'media','where':{'$eq':[ref('media.role'),'mask']}}}}, 0]}, 'message': '本插件暂不支持遮罩图，请仅上传商品参考图。'},
        {'assert': {'$lte': [count,4]}, 'message': '每次最多生成4张候选图。'},
    ]
    prompt = {'$concat': [
        '你正在制作真实商品电商图。第一张参考图决定商品身份，其余参考图只补充视角和已证实的SKU。保持外形、比例、结构、数量、颜色、材质、包装与品牌标识一致；不擅自改款。\n统一风格：',
        choose('style',STYLES,'简洁棚拍'), '\n品牌视觉约束：', option('brand','未指定'),
        '\n图型要求（白底主图的纯白背景优先于风格背景）：', choose('scene',SCENES,'白底主图'),
        '\n文字要求：', {'$if': {'condition': {'$eq':[option('scene','白底主图'),'白底主图']}, 'then':TEXT['不生成文字'], 'else':choose('textMode',TEXT,'不生成文字')}},
        '\n指定文案：', {'$if': {'condition': {'$and':[{'$ne':[option('scene','白底主图'),'白底主图']},{'$eq':[option('textMode','不生成文字'),'使用指定文案']}]},'then':option('copy','未提供'),'else':'未启用，禁止新增文案'}},
        '\n商品事实与本张需求：', ref('request.prompt'),
        '\n禁止新增水印、假logo、虚构认证、未提供的价格销量、医疗效果、假对比和无依据参数。禁止改变商品结构、增加零件、复制商品或出现畸形边缘。品牌原有文字不属于新增文案。同一套图保持一致色温、光线与材质表达。只生成一幅完整图片，不做拼接长图或多格画册。',
    ]}
    old = p['create']['body']
    p['create'] = dict(method='POST',path='/v1/images/edits',contentType='application/json',body={
        'model':ref('request.model'), 'prompt':prompt, 'images':old['images'],
        'n': {'$if': {'condition': {'$gt':[ref('request.imageCount'),0]}, 'then':ref('request.imageCount'),'else':1}},
        'size':default(ref('request.aspectRatio'),'1024x1024'),
        'quality':default(ref('request.quality'),'medium'), 'output_format':'png',
    })
    readme = (ROOT/'README.md').read_text(encoding='utf-8')
    manifest = dict(apiVersion='yingce.plugin/v2', id=ID, name='电商图工作室',version='1.0.0',author='Custom Plugin',
        description='基于商品参考图制作主图、场景、卖点、细节、SKU与横幅；统一风格及文案控制。',
        documentation=readme,permissions=['generation.run','media.read'],configuration=base['configuration'],contributes={'providers':[p]})
    (ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    output = ROOT/f'{ID}-1.0.0.yingce-plugin'
    with ZipFile(output,'w',ZIP_DEFLATED) as z:
        for name in ['manifest.json','README.md','LICENSE','docs/example-brief.txt','docs/COMPATIBILITY.md']:
            info=ZipInfo(name,date_time=(2026,10,30,0,0,0)); info.compress_type=ZIP_DEFLATED
            z.writestr(info,(ROOT/name).read_bytes())
    digest=hashlib.sha256(output.read_bytes()).hexdigest()
    (ROOT/'SHA256SUMS.txt').write_text(f'{digest}  {output.name}\n',encoding='utf-8')
    print(f'Built {output} ({output.stat().st_size} bytes)\nSHA256 {digest}')
if __name__ == '__main__': make()
