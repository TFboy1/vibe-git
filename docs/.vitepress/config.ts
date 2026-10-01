import { defineConfig } from 'vitepress'
import { cp, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const origin = 'https://tfboy1.github.io'
const base = '/vibe-git/'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Vibe-Git',
  description: '让多人 Agent 共享计划、需求和任务。新版工作台源码试用与完整操作教程。',
  base,
  cleanUrls: false,
  appearance: 'force-dark',
  srcExclude: ['README_*.md', 'marketing/**', 'frontend-proposal.md'],
  head: [
    ['link', { rel: 'icon', href: `${base}assets/vibe-git-logo-readme.svg` }],
    ['meta', { name: 'theme-color', content: '#0b1014' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:locale', content: 'zh_CN' }],
    ['meta', { property: 'og:site_name', content: 'Vibe-Git' }],
    ['meta', { property: 'og:image', content: `${origin}${base}assets/vibe-git-poster.png` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: `${origin}${base}assets/vibe-git-poster.png` }],
  ],
  transformHead({ pageData }) {
    const path = pageData.relativePath === 'index.md' ? '' : pageData.relativePath.replace(/\.md$/, '.html')
    const url = `${origin}${base}${path}`
    return [
      ['meta', { property: 'og:title', content: `${pageData.title || 'Vibe-Git'} · Vibe-Git` }],
      ['meta', { property: 'og:description', content: pageData.description || 'Vibe-Git 新版工作台与使用教程。' }],
      ...(!pageData.isNotFound ? [['link', { rel: 'canonical', href: url }], ['meta', { property: 'og:url', content: url }]] : []),
    ]
  },
  themeConfig: {
    logo: '/assets/vibe-git-logo-vector.svg',
    siteTitle: 'vibe-git',
    nav: [
      { text: '快速开始', link: '/guide/install.html' },
      { text: '使用文档', link: '/guide.html', activeMatch: '^/guide(?:/|\\.)' },
      { text: 'GitHub ↗', link: 'https://github.com/TFboy1/vibe-git' },
    ],
    sidebar: {
      '/guide': [
        { text: '开始使用', items: [
          { text: '教程总览', link: '/guide.html' },
          { text: '认识产品与身份', link: '/guide/intro.html' },
          { text: '环境与源码安装', link: '/guide/install.html' },
          { text: '队长创建房间', link: '/guide/captain.html' },
          { text: '配置协作算力', link: '/guide/compute.html' },
          { text: '成员加入房间', link: '/guide/member.html' },
        ] },
        { text: '完成第一轮协作', items: [
          { text: '每人提交计划', link: '/guide/plans.html' },
          { text: '整合计划与裁决', link: '/guide/alignment.html' },
          { text: '需求、分工与派发', link: '/guide/dispatch.html' },
          { text: '开发与任务汇报', link: '/guide/execution.html' },
          { text: '需求变更与重新派发', link: '/guide/changes.html' },
          { text: '代码协作与日常维护', link: '/guide/git.html' },
        ] },
        { text: '查阅与维护', items: [
          { text: 'CLI 与 Agent 提示词', link: '/guide/reference.html' },
          { text: '问题处理', link: '/guide/troubleshooting.html' },
          { text: '历史房间兼容', link: '/guide/legacy.html' },
          { text: '维护与发布文档站', link: '/guide/site.html' },
        ] },
      ],
    },
    outline: { level: [2, 3], label: '本页步骤' },
    docFooter: { prev: '上一步', next: '下一步' },
    sidebarMenuLabel: '教程目录',
    returnToTopLabel: '返回顶部',
    darkModeSwitchLabel: '外观',
    externalLinkIcon: true,
    editLink: {
      pattern: 'https://github.com/TFboy1/vibe-git/edit/codex/frontend-rebuild/docs/:path',
      text: '在 GitHub 上修改本页',
    },
    search: { provider: 'local', options: { locales: { root: { translations: {
      button: { buttonText: '搜索文档', buttonAriaLabel: '搜索使用文档' },
      modal: {
        noResultsText: '没有找到相关步骤',
        resetButtonTitle: '清除搜索',
        footer: { selectText: '打开', navigateText: '切换', closeText: '关闭' },
      },
    } } } } },
    notFound: {
      title: '这页暂时找不到',
      quote: '可以回到官网，或从使用文档继续寻找需要的操作步骤。',
      linkLabel: '返回 Vibe-Git 官网',
      linkText: '返回官网',
    },
    footer: { message: 'Git 记录代码，Vibe-Git 记录团队决定。' },
  },
  async buildEnd(site) {
    // Keep the existing public asset URLs and Markdown downloads without maintaining a second document.
    await cp(resolve(docsRoot, 'assets'), resolve(site.outDir, 'assets'), { recursive: true })
    await cp(resolve(docsRoot, 'guide'), resolve(site.outDir, 'guide'), { recursive: true })
    await writeFile(resolve(site.outDir, 'guide.md'), await readFile(resolve(docsRoot, 'guide.md'), 'utf8'), 'utf8')
  },
})
