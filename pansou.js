// 常用库
const $config = argsify($config_str);
const cheerio = createCheerio();
const CryptoJS = createCryptoJS();

// 配置
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TOKEN = 'fnfqp7758';
const AUTHORIZATION = 'a421f8fc5ef64192ac986eff5d16182e';
const ALIST_SITE = 'http://192.168.8.8:5345'; // AList 服务器地址
const appConfig = {
    ver: 1,
    title: '云盘搜索 - TVBOX',
    site: 'http://192.168.8.8:4568',
    tabs: [{ name: '全部', ext: { id: '' } }],
};

// 性能配置
const CACHE_TTL = 3 * 60 * 1000; // 3分钟缓存
const MAX_CONCURRENT_REQUESTS = 5; // 最大并发请求数
const MAX_SEARCH_RESULTS = 15; // 最大搜索结果数

let sessionHeaders = {
    'User-Agent': UA,
    'Referer': '192.168.8.8:4568',
    'Authorization': AUTHORIZATION,
    'X-client': 'com.fongmi.android.tv'
};

// 扩展视频格式支持
const MEDIA_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.m4v', '.mpg', '.mpeg', 
                   '.ts', '.m2ts', '.webm', '.rm', '.rmvb', '.3gp', '.asf', '.divx', '.vob'];

const DISK_TAGS = {
    'alipan.com': '阿里',
    'drive.uc.cn': 'UC',
    '123912.com': '123',
    '123684.com': '123',
    'pan.quark.cn': '夸克',
    'cloud.189.cn': '天翼',
    'caiyun.139.com': '移动'
};


// 预编译正则表达式以提高性能
const REGEX_PATTERNS = {
    htmlTags: /<[^>]*>/g,
    yearPattern: /(.*?)([\(（]\s*\d{4}\s*[\)）])(.*)/,
    // 只清理 [] 内的噪声，保留 【】
    brackets: /\[[^\]]*\]/g,
    parentheses: /\([^)]*\)/g,
    angleBrackets: /《[^》]*》/g,
    noiseWords: /\b(4K|1080P|720P|2160P|HDR|DV|杜比|WEB-4K-DV|更新至\d+集|更至EP\d+|第\d+集|S\d+\s*E\d+|大小\d+\.\d+GB|全集|高清|蓝光|杜比视界|无广告|已更新|无台标|无字幕|WEB|p|演员|主演|原盘|REMUX|内封|字幕|完结描述|高码率|真4K|S\d+-S\d+全|臻彩|MAX|高清无|美国|剧情|国产剧|美剧|MA版|杜比视界\+DV|HDR混合特|✅|内封简繁|\/108)\b/gi,
    // 只去掉 "名称:" 这种没用的前缀，保留 【国产剧】
    prefixes: /^(名称:电视剧|剧集)\s*/g,
    specialChars: /[^\w\s\u4e00-\u9fa5:·\-—《》【】\d&]/g, // 保留 【】
    multipleSpaces: /\s{2,}/g,
    linkPattern: /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(阿里|UC|123|夸克|天翼|移动)/g,

    // 支持中文标题 + 数字 + 季数
    seriesNumber: /((?:[\w\d\-]+[:：][\u4e00-\u9fa5\d]+)|(?:[\u4e00-\u9fa5]+[:：][\u4e00-\u9fa5\d]+)|(?:[\u4e00-\u9fa5:·【】\d]+))(?:\s*(第[一二三四五六七八九十]+季|[一二三四五六七八九十]+季|季\d{1,2}|[0-9]{1,2}\b))?/i
};

async function getConfig() {
    return jsonify(appConfig);
}

function cleanPath(path) {
    if (!path) return '';
    if (path.startsWith('/')) {
        return '/' + path.replace(/^\/+/, '').replace(/\/+/g, '/').replace(/@+/g, '@').trim();
    }
    return path.replace(/\/+/g, '/').replace(/@+/g, '@').trim();
}

function cleanName(name) {
    if (!name) return '未知标题';
    return name.replace(/[^\w\s\u4e00-\u9fa5\-_\.]/g, '').replace(/\s+/g, ' ').trim();
}

function safeDecode(str) {
    try {
        return decodeURIComponent(str);
    } catch {
        return str;
    }
}

function logError(msg, error = null) {
    console.error(msg, error);
    $utils.toastError(msg);
}


function standardizeTitle(originalName) {
    if (!originalName || originalName.trim() === '') {
        return '未知标题';
    }

    let name = originalName;

    // 1. 移除 HTML 标签
    name = name.replace(REGEX_PATTERNS.htmlTags, '');

    // 2. 提取年份 (2025) / （2025）
    let year = '';
    const yearMatch = name.match(REGEX_PATTERNS.yearPattern);
    if (yearMatch) {
        year = yearMatch[2].replace(/[（）]/g, (m) => (m === '（' ? '(' : m === '）' ? ')' : m)); // 统一圆括号
        name = yearMatch[1] + yearMatch[3];
    }

    // 3. 移除 [] () 《》 中的内容
    name = name
        .replace(REGEX_PATTERNS.brackets, '')
        .replace(REGEX_PATTERNS.angleBrackets, '')
        .replace(REGEX_PATTERNS.parentheses, '');

    // 4. 移除噪声词（4K, 更新xx集等）
    name = name.replace(REGEX_PATTERNS.noiseWords, ' ').trim();

    // 5. 移除明确无效前缀（比如“电视剧 ”、“名称:”）
    name = name.replace(/^(电视剧|综艺|电影|名称:)\s*/i, '').trim();

    // 6. 提取核心片名（优先匹配中文 + 数字）
    let coreName =
        name.match(/[\u4e00-\u9fa5A-Za-z0-9：:·【】]+/i)?.[0] || name;

    // 7. 拼接年份
    if (year) {
        coreName = `${coreName.trim()} ${year}`;
    }

    // 8. 限制标题长度
    coreName = coreName.trim();
    if (coreName.length > 50) {
        coreName = coreName.substring(0, 50) + '...';
    }
    // 9. 确保标题不为空
    if (!coreName || coreName.length < 2) {
        coreName = originalName
            .replace(REGEX_PATTERNS.htmlTags, '')
            .match(/[\u4e00-\u9fa5【】]+[:：]?[\u4e00-\u9fa5\d【】]*[\w\u4e00-\u9fa5\d\s【】:·]*/i)?.[0] ||
            originalName.replace(REGEX_PATTERNS.noiseWords, '').trim();
        if (!coreName) coreName = '未知标题';
    }

    return coreName;
}


// 网络请求函数
async function xptvSafeFetch(url, options = {}, retries = 2) {
    for (let i = 0; i < retries; i++) {
        try {
            const { data } = await $fetch.get(url, options);
            return { data };
        } catch (e) {
            if (i === retries - 1) throw e;
            await new Promise(resolve => setTimeout(resolve, 300 * (i + 1)));
        }
    }
}

// POST请求函数
async function xptvSafePost(url, body, options = {}, retries = 2) {
    for (let i = 0; i < retries; i++) {
        try {
            const { data } = await $fetch.post(url, body, options);
            return { data };
        } catch (e) {
            if (i === retries - 1) throw e;
            await new Promise(resolve => setTimeout(resolve, 300 * (i + 1)));
        }
    }
}

// 智能视频文件检测 -> 改为只检查扩展名
function isLikelyVideoFile(filename) {
    if (!filename) return false;

    const lowerName = filename.toLowerCase();
    const fileExt = '.' + lowerName.split('.').pop();
    return MEDIA_EXTS.includes(fileExt);
}
// 简化后的列表处理函数（只做格式化，不做去重）
function processList(list, site) {
    if (!list || !Array.isArray(list) || list.length === 0) {
        return [];
    }

    const result = [];

    for (const item of list) {
        if (result.length >= MAX_SEARCH_RESULTS) break;
        
        const decodedId = safeDecode(item.vod_id || '');
        if (!decodedId) continue;

        const originalName = item.vod_name || '';
        
        // 提取标签信息
        let tag = '';
        for (const [domain, tagName] of Object.entries(DISK_TAGS)) {
            if (decodedId.includes(domain)) {
                tag = tagName;
                break;
            }
        }
        
        let remarks = item.vod_remarks || tag || '';
        
        // 提取分辨率信息
        const resolutionMatch = originalName.match(/(4K|1080P|720P|2160P|HDR|DV|杜比)/i);
        const resolution = resolutionMatch ? resolutionMatch[1].toUpperCase() : '';
        
        // 提取剧集信息
        const episodeMatch = originalName.match(/(更新至|更至|EP|第)(\d+)(集|话|節)/);
        const episodeInfo = episodeMatch ? `${episodeMatch[1]}${episodeMatch[2]}${episodeMatch[3]}` : '';
        
        // 设置子标题
        if (tag) {
            if (episodeInfo) {
                remarks = `${tag}|${episodeInfo}`;
            } else if (resolution) {
                remarks = `${tag}|${resolution}`;
            } else {
                remarks = tag;
            }
        }
        
        // 使用优化后的标题标准化函数
        const standardizedName = standardizeTitle(originalName);

        result.push({
            vod_id: decodedId,
            vod_name: standardizedName,
            vod_pic: item.vod_pic || '',
            vod_remarks: remarks,
            vod_duration: '',
            vod_content: item.vod_content || '',
            ext: { url: [decodedId], name: item.vod_name || '', source: item }
        });
    }

    return result;
}


// 智能视频文件检测 - 优化版本
async function hasVideoFiles(path) {
    try {
        const items = await fetchAList(path);
        if (!items || items.length === 0) return false;
        
        let videoCount = 0;
        let totalSize = 0;
        
        for (const item of items) {
            if (!item.is_dir) {
                // 使用智能检测判断是否为视频文件
                if (isLikelyVideoFile(item.name)) {
                    videoCount++;
                    totalSize += item.size || 0;
                    
                    // 如果找到多个视频文件，提前返回true
                    if (videoCount >= 2) return true;
                }
            }
        }
        
        // 如果有视频文件且总大小合理（大于10MB），认为是有效资源
        return videoCount > 0 && totalSize > 10 * 1024 * 1024;
    } catch (e) {
        return false;
    }
}

// 链接有效性验证
async function isValidLink(link) {
    try {
        const path = await getTParamFromLink(link);
        return path ? await hasVideoFiles(path) : false;
    } catch (e) {
        return false;
    }
}

// 批量验证链接有效性
async function validateLinksBatch(links) {
    const validationPromises = links.map(link => 
        isValidLink(link.vod_id || link).catch(() => false)
    );
    
    return Promise.all(validationPromises);
}

// 解析HTML搜索结果
function parseHtmlResults(html) {
    const results = [];
    let match;
    
    while ((match = REGEX_PATTERNS.linkPattern.exec(html)) !== null) {
        results.push({
            vod_id: match[1],
            vod_name: match[2].replace(/<[^>]+>/g, '').trim(),
            vod_remarks: match[3]
        });
    }
    
    return results;
}

// === 搜索结果缓存（关键词 -> {time, result}） ===
const searchCache = new Map();

// 定时清理（每5分钟执行一次）
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of searchCache.entries()) {
        if (now - entry.time >= CACHE_TTL) {
            searchCache.delete(key);
        }
    }
}, 5 * 60 * 1000); // 5分钟

async function search(ext) {
    ext = argsify(ext);
    const text = (ext.text || '').trim();
    
    if (!text) {
        return jsonify({ list: [] });
    }

    // === 搜索前清理过期缓存 ===
    const now = Date.now();
    for (const [key, entry] of searchCache.entries()) {
        if (now - entry.time >= CACHE_TTL) {
            searchCache.delete(key);
        }
    }

    // === 缓存检查 ===
    const cacheKey = text.toLowerCase();
    const cached = searchCache.get(cacheKey);
    if (cached) {
        $utils.toastInfo(`命中缓存，返回上次结果`);
        return jsonify({ list: cached.result });
    }
    
    $utils.toastInfo('搜索中，请稍候...');
    
    try {
        const url = `${appConfig.site}/pansou/${TOKEN}?wd=${encodeURIComponent(text)}`;
        const { data } = await xptvSafeFetch(url, { headers: sessionHeaders });
        
        let json;
        try {
            json = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (e) {
            json = { list: parseHtmlResults(data) };
        }

        let rawList = Array.isArray(json.list) ? json.list : [];

        // === 结果截断优化 ===
        const MAX_RAW_RESULTS = 80;
        if (rawList.length > MAX_RAW_RESULTS) {
            rawList = rawList.slice(0, MAX_RAW_RESULTS);
            $utils.toastInfo(`结果过多，已截取前 ${MAX_RAW_RESULTS} 条进行处理`);
        }
        
        // === 去重逻辑 ===
        const seenIds = new Set();
        const uniqueList = [];
        for (const item of rawList) {
            const decodedId = safeDecode(item.vod_id || '');
            if (decodedId && !seenIds.has(decodedId)) {
                seenIds.add(decodedId);
                uniqueList.push(item);
            }
        }

        // === 🚫 过滤无关结果 ===
        const BLOCK_WORDS = ['电子书', '云盘', '小说', '标题', '短剧', '合集', '一些']; // 可以自行扩展
        const filteredList = uniqueList.filter(item => {
            const name = (item.vod_name || '').toLowerCase();
            return !BLOCK_WORDS.some(word => name.includes(word.toLowerCase()));
        });

        if (filteredList.length === 0) {
            $utils.toastInfo('未找到相关资源，请尝试其他关键词');
            searchCache.set(cacheKey, { time: now, result: [] });
            return jsonify({ list: [] });
        }

        // 添加资源验证提示
        $utils.toastInfo('资源验证中，部分资源可能需要时间加载！');
        
        // 验证链接有效性 - 只验证过滤后前20个结果
        const resultsToValidate = filteredList.slice(0, 20);
        const validityResults = await validateLinksBatch(resultsToValidate);

        let validList = resultsToValidate.filter((_, index) => validityResults[index]);

        // ⚠️ 容错：如果全是 false，保留前 3 条
        if (validList.length === 0) {
            validList = resultsToValidate.slice(0, 3);
        }
        
        // === 格式化输出 ===
        const result = processList(validList, appConfig.site);
        
        if (result.length === 0) {
            $utils.toastInfo('未找到相关资源，请尝试其他关键词');
        } else {
            $utils.toastInfo(`找到 ${result.length} 个可播放资源`);
        }

        // === 写入缓存 ===
        searchCache.set(cacheKey, { time: now, result });
        
        return jsonify({ list: result });
    } catch (e) {
        logError('搜索失败，请重试', e);
        return jsonify({ list: [] });
    }
}
// 链接路径提取
async function getTParamFromLink(link) {
    try {
        const decodedLink = safeDecode(link).replace(/\?public=1$/, '');
        let match;

        if (decodedLink.includes('caiyun.139.com')) {
            if (decodedLink.includes('/m/i?')) {
                match = decodedLink.match(/https?:\/\/caiyun\.139\.com\/m\/i\?(.+)/);
            } else if (decodedLink.includes('/m/link?')) {
                match = decodedLink.match(/https?:\/\/caiyun\.139\.com\/m\/link\?(.+)/);
            } else {
                match = decodedLink.match(/https?:\/\/caiyun\.139\.com\/.+\?(.+)/);
            }
            if (!match) return null;
        } else {
            match = decodedLink.match(/^(https?:\/\/([^\/]+))(\/(s|share|w\/i|web\/disk|web\/s|t)\/([^\/]+))/);
            if (!match) return null;
        }

        const resp = await xptvSafePost(
            `${appConfig.site}/api/share-link`, 
            { link: decodedLink }, 
            { headers: { ...sessionHeaders, 'Content-Type': 'application/json' } }
        );
        
        let path = typeof resp.data === 'string' ? resp.data.trim() : (resp.data?.path || resp.data);
        return path ? cleanPath(path) : null;
    } catch (e) {
        return null;
    }
}

async function fetchAList(path) {
    const url = `${ALIST_SITE}/api/fs/list`;
    const body = {
        path: path,
        password: '',
        refresh: false
    };
    
    try {
        const { data } = await xptvSafePost(url, body, { headers: { 'Content-Type': 'application/json' } });
        return argsify(data).data.content || [];
    } catch (e) {
        return [];
    }
}

async function fetchAllVods(path, maxDepth = 1) {
    const result = [];
    
    const fetchRecursive = async (currentPath, depth = 0) => {
        if (depth > maxDepth) return;
        
        const items = await fetchAList(currentPath);
        if (!items || items.length === 0) return;
        
        for (const item of items) {
            if (item.is_dir) {
                await fetchRecursive(`${currentPath}/${item.name}`, depth + 1);
            } else {
                // 使用智能检测判断是否为视频文件
                if (isLikelyVideoFile(item.name)) {
                    const vodName = cleanName(item.name || '');
                    result.push({
                        name: vodName,
                        path: `${currentPath}/${item.name}`
                    });
                }
            }
        }
    };
    
    try {
        await fetchRecursive(path, 0);
        return result;
    } catch (e) {
        return [];
    }
}

async function getTracks(ext) {
    ext = argsify(ext);
    const inputUrl = (ext.url && ext.url[0]) || ext.vod_id || '';
    
    if (!inputUrl) {
        return jsonify({ list: [] });
    }
    
    try {
        const path = await getTParamFromLink(inputUrl);
        if (!path) {
            $utils.toastError('无法解析链接路径');
            return jsonify({ list: [] });
        }
        
        const videoUrls = await fetchAllVods(path);
        if (videoUrls.length === 0) {
            $utils.toastError('该路径下未找到可播放的视频文件');
            return jsonify({ list: [] });
        }
        
        const tracks = videoUrls.map(video => ({
            name: video.name,
            pan: '',
            ext: { path: video.path }
        }));
        
        return jsonify({ list: [{ title: '默认分组', tracks }] });
    } catch (e) {
        logError('获取播放列表失败', e);
        return jsonify({ list: [] });
    }
}

async function getPlayinfo(ext) {
    ext = argsify(ext);
    const path = ext.path;
    
    if (!path) {
        return jsonify({ urls: [] });
    }
    
    try {
        const url = `${ALIST_SITE}/api/fs/get`;
        const body = { path, password: '' };
        const { data } = await xptvSafePost(url, body, { headers: { 'Content-Type': 'application/json' } });
        
        const playData = argsify(data);
        const playUrl = playData.data.raw_url;
        
        if (playUrl) {
            return jsonify({ 
                urls: [playUrl], 
                headers: [{ 
                    'User-Agent': UA, 
                    'Referer': appConfig.site 
                }] 
            });
        } else {
            $utils.toastError('无法获取播放地址');
            return jsonify({ urls: [] });
        }
    } catch (e) {
        logError('获取播放信息失败', e);
        return jsonify({ urls: [] });
    }
}

// 导出函数供XPTV调用
module.exports = {
    getConfig,
    search,
    getCards,
    getTracks,
    getPlayinfo
}; 