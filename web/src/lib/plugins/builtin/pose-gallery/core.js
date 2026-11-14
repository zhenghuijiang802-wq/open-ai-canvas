export const ID = 'ai-pose-gallery-zh';
export const DEFAULT_BASE = 'https://shisei.indaloop.app/';
export const DEFAULT_SYSTEMS = ['全身・标准', '上半身', '全身・性感', '双人'];
export const ANGLES = ['正面', '斜侧', '侧面', '俯视', '仰视'];

const SERIES_TO_SYSTEM = {
  std: '全身・标准',
  upper: '上半身',
  sexy: '全身・性感',
  duo: '双人',
  '全身单人・标准系': '全身・标准',
  '上半身单人': '上半身',
  '全身单人・性感系': '全身・性感',
  '双人缠绵': '双人',
};

const LEGACY_SYSTEM_MAP = {
  '全身单人・标准系': '全身・标准',
  '上半身单人': '上半身',
  '全身单人・性感系': '全身・性感',
  '双人缠绵': '双人',
};

const ANGLE_KEY_TO_ZH = {
  front: '正面',
  diag: '斜侧',
  side: '侧面',
  above: '俯视',
  below: '仰视',
};

export function baseUrl(value = DEFAULT_BASE) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) {
    throw new Error('图库地址必须为不含账号、参数的 HTTP(S) 目录地址');
  }
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u.href;
}

export function mediaUrl(base, path, kind) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('图库图片路径无效');
  if (!/^(images\/(line|photo)\/(w300|w600|w900)\/|thumbs\/|img\/)[A-Za-z0-9_.-]+\.(png|jpg|jpeg|webp)$/i.test(path)) {
    throw new Error('图库图片路径无效');
  }
  return new URL(path, baseUrl(base)).href;
}

function matchSystem(systemName, allowedSystems) {
  if (!allowedSystems || !allowedSystems.length) return true;
  for (const allowed of allowedSystems) {
    if (allowed === systemName) return true;
    if (LEGACY_SYSTEM_MAP[allowed] === systemName) return true;
    if (SERIES_TO_SYSTEM[allowed] === systemName) return true;
    if (LEGACY_SYSTEM_MAP[systemName] === allowed) return true;
  }
  return false;
}

export function normalize(rows, base = DEFAULT_BASE, systems = DEFAULT_SYSTEMS) {
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('图库索引必须为不超过10000项的JSON数组');
  const seen = new Set();
  const result = [];

  for (const r of rows) {
    if (!r) continue;

    // Shisei format: pose entry with a views dictionary
    if (r.views && typeof r.views === 'object') {
      const seriesKey = typeof r.series === 'string' ? r.series : 'std';
      const system = SERIES_TO_SYSTEM[seriesKey] || seriesKey;
      if (!matchSystem(system, systems)) continue;

      const code = typeof r.id === 'string' && r.id ? r.id : 'P000';
      const category = typeof r.class_cn === 'string' && r.class_cn ? r.class_cn : (r.class_en || '通用');
      const title = typeof r.name_cn === 'string' && r.name_cn ? r.name_cn : (r.name_en || code);
      const group = `${system} / ${code}`;

      for (const [angleKey, filename] of Object.entries(r.views)) {
        if (!filename || typeof filename !== 'string') continue;
        const angle = ANGLE_KEY_TO_ZH[angleKey] || angleKey;
        const id = filename.replace(/\.[^.]+$/, '');
        if (seen.has(id)) continue;
        seen.add(id);

        result.push({
          id,
          title,
          system,
          code,
          category,
          angle,
          group,
          thumbnailUrl: mediaUrl(base, `images/line/w300/${filename}`, 'images/line/w300'),
          fileUrl: mediaUrl(base, `images/line/w900/${filename}`, 'images/line/w900'),
        });
      }
    } else {
      // Legacy flat format: each row is an individual view with '体系', '姿势编号', etc.
      const rawSystem = r['体系'];
      if (!matchSystem(rawSystem, systems)) continue;

      for (const key of ['id', '体系', '姿势编号', '分类', '姿势名称', '角度']) {
        if (typeof r[key] !== 'string' || !r[key].trim() || r[key].length > 200) {
          throw new Error(`图库字段无效：${key}`);
        }
      }
      if (seen.has(r.id)) throw new Error('图库包含重复ID');
      seen.add(r.id);

      result.push({
        id: r.id,
        title: r['姿势名称'],
        system: r['体系'],
        code: r['姿势编号'],
        category: r['分类'],
        angle: r['角度'],
        group: r['体系'] + ' / ' + r['姿势编号'],
        thumbnailUrl: mediaUrl(base, r['缩略图'], 'thumbs'),
        fileUrl: mediaUrl(base, r['原图'], 'img'),
      });
    }
  }

  return result;
}

export function select(rows, {keyword='', system='', category='', angle='', offset=0, limit=48} = {}) {
  const words = keyword.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const found = rows.filter(r => (!system || r.system===system) && (!category || r.category===category) && (!angle || r.angle===angle) && words.every(w => [r.id,r.title,r.system,r.category,r.angle,r.code].join(' ').toLocaleLowerCase().includes(w)));
  return { total:found.length, rows:found.slice(Math.max(0,offset), Math.max(0,offset)+Math.max(1,Math.min(5000,limit))) };
}

export function groups(rows) {
  const out = new Map();
  for (const r of rows) { if (!out.has(r.group)) out.set(r.group,[]); out.get(r.group).push(r); }
  return [...out.values()];
}

export async function readBounded(response, max, signal) {
  if (!response.ok) throw new Error(`图库请求失败（HTTP ${response.status}）`);
  if (Number(response.headers.get('content-length'))>max) throw new Error('图库文件超出大小限制');
  const reader=response.body.getReader(), chunks=[]; let size=0;
  try { while (true) { signal?.throwIfAborted(); const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>max) throw new Error('图库文件超出大小限制'); chunks.push(value); } }
  catch(e) { await reader.cancel(); throw e; }
  finally { reader.releaseLock(); }
  return new Blob(chunks,{type:response.headers.get('content-type')||'application/octet-stream'});
}

export function createCatalog({base=DEFAULT_BASE, systems=DEFAULT_SYSTEMS, fetcher=fetch} = {}) {
  base=baseUrl(base); let cache;
  return {
    async load(signal) {
      signal?.throwIfAborted(); if(cache) return cache;
      let response;
      let lastError;
      for (const candidate of ['catalog.json', 'data/catalog.json', 'data/pose-zh.json']) {
        try {
          const res = await fetcher(new URL(candidate, base), { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
          if (res.ok) {
            response = res;
            break;
          }
        } catch (err) {
          lastError = err;
        }
      }
      if (!response) throw lastError || new Error('无法连接姿势图库，请检查网络或图库地址');
      const blob = await readBounded(response, 10 * 1024 * 1024, signal);
      cache = normalize(JSON.parse(await blob.text()), base, systems);
      return cache;
    },
    async download(id, signal) {
      const row=(await this.load(signal)).find(r=>r.id===id); if(!row) throw new Error('所选姿势已不存在');
      const response=await fetcher(row.fileUrl,{signal,credentials:'omit',referrerPolicy:'no-referrer'});
      const blob=await readBounded(response,16*1024*1024,signal);
      if (!['image/png','image/jpeg','image/webp'].includes(blob.type.split(';')[0])) throw new Error('图库原图不是支持的图片格式');
      return blob;
    }
  };
}
