
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('exportBtn').addEventListener('click', exportNotes);
});

// 导出笔记为CSV
async function exportNotes() {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = '正在获取笔记数据...';

    try {
        // 在当前活动标签页中执行脚本
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // 先尝试提取笔记链接
        const linksResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: extractNoteLinks
        });

        const noteLinks = linksResult[0].result;
        statusDiv.textContent = `找到 ${noteLinks.length} 个笔记链接，开始获取内容...`;

        // 提取当前页面可见的笔记内容
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: scrapeXiaohongshuHomepage,
            args: [noteLinks]
        });

        const notes = results[0].result;

        if (notes && notes.length > 0) {
            // 转换为CSV并下载
            const csv = convertToCSV(notes);
            downloadCSV(csv);
            statusDiv.textContent = `成功导出 ${notes.length} 条笔记!`;
        } else {
            statusDiv.textContent = '未找到笔记内容，请确认您在小红书首页并且有笔记显示。';
        }
    } catch (error) {
        console.error(error);
        statusDiv.textContent = '导出失败: ' + error.message;
    }
}

// 提取页面上的笔记链接
function extractNoteLinks() {
    console.log("正在提取笔记链接...");
    const links = [];

    try {
        // 查找所有可能是笔记链接的元素
        const allLinks = document.querySelectorAll('a');

        allLinks.forEach(link => {
            const href = link.href || '';
            // 检查链接是否匹配小红书笔记链接模式
            if (href.includes('xiaohongshu.com') &&
                (href.includes('/explore/') || href.includes('/discovery/item/'))) {

                // 确保链接是可见的
                const rect = link.getBoundingClientRect();
                const isVisible = (
                    rect.top >= 0 &&
                    rect.left >= 0 &&
                    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
                );

                if (isVisible && !links.includes(href)) {
                    links.push(href);
                    console.log("找到笔记链接:", href);
                }
            }
        });

        console.log(`总共找到 ${links.length} 个笔记链接`);
    } catch (error) {
        console.error("提取笔记链接时出错:", error);
    }

    return links;
}

// 专门针对小红书首页的爬取函数
function scrapeXiaohongshuHomepage(noteLinks = []) {
    console.log("正在爬取小红书首页笔记...");
    const notes = [];

    try {
        // 确认是否在小红书相关页面
        if (!window.location.href.includes('xiaohongshu.com')) {
            console.log("不是小红书网站");
            return notes;
        }

        console.log("开始分析页面元素...");

        // 常见的小红书首页笔记卡片容器选择器
        const possibleContainerSelectors = [
            // 常见的卡片选择器
            '.feed-list .feed-item',
            '.note-card',
            '.feed-card',
            '.explore-card',
            '.note-item',
            '.note-container',
            '.feed-container .note',
            // 瀑布流中的笔记项
            '.waterfall-item',
            '.waterfall-container .item',
            '.wall-container .note',
            // 通用选择器，选取可能是笔记的元素
            '[data-v-note]',
            '[data-note-id]',
            '[data-id]',
            // 首页推荐流
            '.home-feed .feed-item',
            '.recommend-feed .feed-item',
            // 按视觉定位可能是笔记卡片的元素
            'article',
            '.card',
            '.post'
        ];

        // 尝试查找笔记容器
        let noteElements = [];
        for (const selector of possibleContainerSelectors) {
            const elements = document.querySelectorAll(selector);
            if (elements && elements.length > 0) {
                console.log(`找到选择器 ${selector} 匹配的元素: ${elements.length}个`);
                noteElements = Array.from(elements);
                break;
            }
        }

        // 如果没有找到明确的笔记元素，尝试查找所有可能的容器
        if (noteElements.length === 0) {
            console.log("未找到明确的笔记元素，尝试分析页面结构...");

            // 查找所有可能包含图片和文本的元素组合
            const possibleCards = document.querySelectorAll('div, article, section');
            noteElements = Array.from(possibleCards).filter(el => {
                // 检查元素是否包含图片和一些文本内容
                const hasImage = el.querySelector('img') !== null;
                const hasText = el.textContent.trim().length > 20; // 至少有一些文字
                const notTooLarge = el.querySelectorAll('*').length < 100; // 不是整个页面
                const notTooSmall = el.querySelectorAll('*').length > 5; // 不是简单元素

                return hasImage && hasText && notTooLarge && notTooSmall;
            });

            console.log(`通过启发式方法找到可能的笔记元素: ${noteElements.length}个`);
        }

        // 只处理屏幕上可见的元素
        noteElements = noteElements.filter(el => {
            const rect = el.getBoundingClientRect();
            return (
                rect.top >= 0 &&
                rect.left >= 0 &&
                rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                rect.right <= (window.innerWidth || document.documentElement.clientWidth)
            );
        });

        console.log(`屏幕上可见的笔记元素数量: ${noteElements.length}`);

        // 为每个笔记元素提取信息
        noteElements.forEach((element, index) => {
            console.log(`处理第 ${index + 1} 个笔记元素`);

            // 提取笔记链接以便获取完整内容
            let noteLink = '';
            const linkElement = element.querySelector('a[href*="/explore/"], a[href*="/discovery/item/"]');
            if (linkElement) {
                noteLink = linkElement.href;
                console.log(`找到笔记链接: ${noteLink}`);
            } else if (noteLinks.length > index) {
                noteLink = noteLinks[index];
                console.log(`使用预先提取的笔记链接: ${noteLink}`);
            }

            // 尝试多种选择器提取标题
            let title = '';
            const possibleTitleSelectors = ['.title', 'h1', 'h2', 'h3', '.desc', '.content', '.note-title'];
            for (const selector of possibleTitleSelectors) {
                const titleEl = element.querySelector(selector);
                if (titleEl && titleEl.textContent.trim()) {
                    title = titleEl.textContent.trim();
                    break;
                }
            }

            // 如果没有找到标题，尝试查找第一个非空文本节点
            if (!title) {
                const allTextEls = element.querySelectorAll('p, div, span');
                for (const el of allTextEls) {
                    if (el.textContent.trim() && el.textContent.trim().length < 100) {
                        title = el.textContent.trim();
                        break;
                    }
                }
            }

            // 尝试提取作者信息
            let author = '';
            const possibleAuthorSelectors = [
                '.author', '.nickname', '.user-nickname', '.user-name',
                '.creator', '.publisher', '.username', '.user'
            ];
            for (const selector of possibleAuthorSelectors) {
                const authorEl = element.querySelector(selector);
                if (authorEl && authorEl.textContent.trim()) {
                    author = authorEl.textContent.trim();
                    break;
                }
            }

            // 判断内容类型（图文/视频）- 增强检测方法
            let contentType = '图文';

            // 1. 查找视频元素
            const hasVideoElement = element.querySelector('video, .video-container, .videoframe') !== null;

            // 2. 查找视频图标或播放按钮
            const hasVideoIcon = element.querySelector('.video-icon, .video-play, .play-icon, .play-button, svg[class*="play"]') !== null;

            // 3. 查找视频时长标记
            const hasDuration = element.querySelector('.duration, .video-duration, .time-duration, [class*="duration"]') !== null;

            // 4. 查找标题中的视频关键词
            const titleContainsVideoKeyword = title.includes('视频') || title.includes('播放') || title.includes('看了');

            // 根据以上条件判断
            if (hasVideoElement || hasVideoIcon || hasDuration || titleContainsVideoKeyword) {
                contentType = '视频';
                console.log(`检测到视频笔记: ${hasVideoElement ? '视频元素' : ''} ${hasVideoIcon ? '播放图标' : ''} ${hasDuration ? '时长标记' : ''} ${titleContainsVideoKeyword ? '标题关键词' : ''}`);
            }

            // 尝试提取内容
            let content = '';
            const possibleContentSelectors = [
                '.content', '.desc', '.description', '.note-content',
                '.note-desc', '.text', 'p', '.summary'
            ];
            for (const selector of possibleContentSelectors) {
                const contentEls = element.querySelectorAll(selector);
                for (const el of contentEls) {
                    if (el.textContent.trim() && el.textContent.trim() !== title) {
                        content += el.textContent.trim() + ' ';
                    }
                }
                if (content) break;
            }

            // 如果未找到明确的内容，尝试提取除标题和作者外的所有文本
            if (!content) {
                const allText = element.textContent.trim();
                if (allText && allText !== title && allText !== author) {
                    // 移除标题和作者，获取剩余文本
                    let remainingText = allText;
                    if (title) remainingText = remainingText.replace(title, '');
                    if (author) remainingText = remainingText.replace(author, '');
                    content = remainingText.trim();
                }
            }

            // 尝试获取图片链接
            let imageLinks = [];
            const images = element.querySelectorAll('img');
            images.forEach(img => {
                const src = img.src || img.dataset.src;
                if (src && !src.includes('avatar') && !src.includes('profile') && !src.includes('logo')) {
                    imageLinks.push(src);
                }
            });

            // 只有当至少有标题或内容时才添加
            if (title || content) {
                notes.push({
                    title: title || '无标题',
                    author: author || '未知作者',
                    contentType,
                    content: content || '无内容',
                    noteLink,
                    imageLinks: imageLinks.join(', ')
                });
                console.log(`成功提取笔记 #${index + 1}: ${title}`);
            }
        });

        console.log(`总共提取了 ${notes.length} 条笔记`);
    } catch (error) {
        console.error("爬取过程中出错:", error);
    }

    return notes;
}

// 转换为CSV格式
function convertToCSV(notes) {
    // CSV表头 - 添加链接和图片列
    const headers = ['标题', '作者', '类型', '内容', '笔记链接', '图片链接'];
    const csvRows = [];

    // 添加表头
    csvRows.push(headers.join(','));

    // 添加数据行
    for (const note of notes) {
        // 处理CSV中的特殊字符
        const escapedValues = [
            `"${(note.title || '').replace(/"/g, '""')}"`,
            `"${(note.author || '').replace(/"/g, '""')}"`,
            `"${note.contentType || ''}"`,
            `"${(note.content || '').replace(/"/g, '""')}"`,
            `"${(note.noteLink || '').replace(/"/g, '""')}"`,
            `"${(note.imageLinks || '').replace(/"/g, '""')}"`
        ];
        csvRows.push(escapedValues.join(','));
    }

    return csvRows.join('\n');
}

// 下载CSV文件
function downloadCSV(csv) {
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const today = new Date().toISOString().slice(0, 10);

    const a = document.createElement('a');
    a.href = url;
    a.download = `小红书首页笔记_${today}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
