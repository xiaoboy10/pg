 // 常用库
const $config = argsify($config_str);
const cheerio = createCheerio();
const CryptoJS = createCryptoJS();

// 配置
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TOKEN = 'fnfqp7758';
const AUTHORIZATION = 'c22f6d56062b5599a934757cff2e24f7';
const ALIST_SITE = 'http://192.168.8.8:5344'; // AList 服务器地址
const appConfig = {
    ver: 1,
    title: '云盘搜索 - TVBOX',
    site: 'http://192.168.8.8:4568',
    tabs: [{ name: '全部', ext: { id: '' } }],
};

// 性能配置
const CACHE_TTL = 3 * 60 * 1000; // 3分钟缓存
const MAX_CONCURRENT_REQUESTS = 5; // 最大并发请求数
const MAX_SEARCH_RESULTS = 8; // 最大搜索结果数

let sessionHeaders = {
    'User-Agent': UA,
    'Referer': 'http://192.168.8.8:4568',
    'Authorization': a421f8fc5ef64192ac986eff5d16182e,
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
    noiseWords: /\b(4K|1080P|720P|2160P|HDR|杜比|WEB-4K-DV|更新至\d+集|更至EP\d+|第\d+集|S\d+\s*E\d+|大小\d+\.\d+GB|全集|高清|蓝光|1080P|720P|杜比视界|无广告|已更新|无台标|无字幕|WEB|p|演员|主演)\b/gi,
    multipleSpaces: /\s+/g,
    linkPattern: /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(阿里|UC|123|夸克|天翼|移动)/g
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

// 简化的列表处理函数
function processList(list, site) {
    if (!list || !Array.isArray(list) || list.length === 0) {
        return [];
    }

    const result = [];
    const seenIds = new Set();

    for (const item of list) {
        if (result.length >= MAX_SEARCH_RESULTS) break;

        let decodedId = safeDecode(item.vod_id || '');
        if (!decodedId || seenIds.has(decodedId)) continue;
        seenIds.add(decodedId);

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
        const resolutionMatch = originalName.match(/(4K|1080P|720P|2160P|HDR|杜比)/i);
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

        // 标准化标题
        let standardizedName = originalName;
        standardizedName = standardizedName.replace(REGEX_PATTERNS.htmlTags, '');

        // 保留年份信息
        const yearMatch = standardizedName.match(REGEX_PATTERNS.yearPattern);
        if (yearMatch) {
            standardizedName = yearMatch[1] + yearMatch[2];
        }

        // 移除常见干扰项
        standardizedName = standardizedName
            .replace(REGEX_PATTERNS.noiseWords, '')
            .replace(REGEX_PATTERNS.multipleSpaces, ' ')
            .trim();

        if (!standardizedName || standardizedName === '') {
            standardizedName = originalName.replace(REGEX_PATTERNS.htmlTags, '').trim();
        }

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

// 检查路径是否有视频文件
async function hasVideoFiles(path) {
    try {
        const items = await fetchAList(path);
        if (!items || items.length === 0) return false;

        for (const item of items) {
            if (!item.is_dir) {
                const fileExt = '.' + (item.name.split('.').pop() || '').toLowerCase();
                if (MEDIA_EXTS.includes(fileExt)) {
                    return true;
                }
            }
        }

        return false;
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

async function search(ext) {
    ext = argsify(ext);
    const text = ext.text || '';

    if (!text.trim()) {
        return jsonify({ list: [] });
    }

    $utils.toastInfo('正在搜索中，请稍候...');

    try {
        const url = `${appConfig.site}/pansou/${TOKEN}?wd=${encodeURIComponent(text)}`;
        const { data } = await xptvSafeFetch(url, { headers: sessionHeaders });

        let json;
        try {
            json = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (e) {
            json = { list: parseHtmlResults(data) };
        }

        // 去重处理
        const uniqueMap = new Map();
        if (json.list && Array.isArray(json.list)) {
            for (const item of json.list) {
                const decodedId = safeDecode(item.vod_id || '');
                if (decodedId && !uniqueMap.has(decodedId)) {
                    uniqueMap.set(decodedId, item);
                }
            }
        }
        const uniqueList = Array.from(uniqueMap.values());

        // 添加资源验证提示
        $utils.toastInfo('资源验证中，部分资源可能需要时间加载！');

        // 验证链接有效性 - 只验证前8个结果
        const resultsToValidate = uniqueList.slice(0, 14);
        const validityResults = await validateLinksBatch(resultsToValidate);
        const validList = resultsToValidate.filter((_, index) => validityResults[index]);

        // 处理最终结果
        const result = processList(validList, appConfig.site);

        if (result.length === 0) {
            $utils.toastInfo('未找到相关资源，请尝试其他关键词');
        } else {
            $utils.toastInfo(`找到【 ${result.length} 】个可播放资源`);
        }

        return jsonify({ list: result });
    } catch (e) {
        logError('搜索失败，请重试', e);
        return jsonify({ list: [] });
    }
}

async function getCards(ext) {
    return search(ext);
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

async function fetchAllVods(path, maxDepth = 2) {
    const result = [];

    const fetchRecursive = async (currentPath, depth = 0) => {
        if (depth > maxDepth) return;

        const items = await fetchAList(currentPath);
        if (!items || items.length === 0) return;

        for (const item of items) {
            if (item.is_dir) {
                await fetchRecursive(`${currentPath}/${item.name}`, depth + 1);
            } else {
                const fileExt = '.' + (item.name.split('.').pop() || '').toLowerCase();
                if (MEDIA_EXTS.includes(fileExt)) {
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