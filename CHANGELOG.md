# 更新日志

本文件记录 woo3an.top 这个 fork 的改动与上线记录。上游是
[JesseLee-CN/rhinelab-blog-theme](https://github.com/JesseLee-CN/rhinelab-blog-theme)，
其三维界面又源自 [LBEILC/RhineLabUI](https://github.com/LBEILC/RhineLabUI)。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)：按日期倒序，
条目分「新增 / 变更 / 移除 / 内容」四类，需要时另加「修复 / 说明 / 注意」。

## 维护约定

**每次改动网站都要同步这两个文件**，否则仓库说明会和线上实际不一致：

1. 本文件加一条记录（按改动性质归到对应小节；同一天的改动合并在一段里，不要新开日期）
2. `README.md` 顶部的 fork 说明 —— 如果改动影响「本站相对上游的差异」，补进去

改完再 `git commit && git push`。上线用 `bash cf-deploy/publish.sh`（或 `deploy.sh`）；
现在推到 `main` 也会自动上线，两者互不依赖，见 [`cf-deploy/README.md`](cf-deploy/README.md)。

## 2026-10-03

### 修复

- **弹窗顶栏的 sticky 背景跟随主题色板**：上一日的 sticky 修复把顶栏背景硬编码为
  亮色 `#edeae4`，暗色主题下它会是一块亮色补丁。上游 RhineLabUI 在合并我们的顶栏
  PR（[#11](https://github.com/LBEILC/RhineLabUI/pull/11)，已合并）之后一分钟内
  跟进打磨（`cdf30aa`），改为 `var(--theme-panel, #edeae4)` —— 本站同样具备亮暗
  主题与该变量，直接同步。
- **窄屏（≤370px）弹窗内边距补齐**：sticky 修复的窄屏部分（容器 12px 保持原样、
  顶栏 `padding-top` 与容器统一为 12px）此前只进了提交给上游的 PR 分支，没有进
  本仓库的 main，一并补上；阅读器的窗口盒与工具栏照旧不掺和。
- **iOS Safari 冷启动后没声音**：iOS 会把音频设备留在「`state` 仍是 `running`、
  时钟却已经停住」的僵尸态（WebKit bug
  [276016](https://webkit.org/b/276016) / [283419](https://webkit.org/b/283419)），
  而 `activate()` 里「`running` 就不用 `resume()`」的短路恰好让设备永远起不来 ——
  表现就是「刚进来没声音，切到别的标签页再回来反而有了」（切走时 `hide()` 真的
  `suspend()` 了一次，回来才走得到 `resume()` 那条路）。现在激活后挂一个 420ms
  的时钟探针：`state` 说在跑不算数，只有 `currentTime` 推进才算；停滞时用
  suspend → resume 唤醒设备（WebKit bug 上验证过的唯一手段），仍然叫不醒才提示
  用户点一下屏幕。探针只在时钟确实停住时才动手，正常路径零额外开销。

  真机反馈（Safari）：提示仍会出现，且**点按后要等零点几秒**才出声 —— 说明
  无手势的 suspend → resume 也叫不醒全新设备，iOS 只认「用户手势窗口里的那次
  启动」。于是再补一手：进门那次点击（`panel.ts` 的 `submit` → `onEngage` →
  `unlock` → `activate`，同一条同步调用链）本身就在手势窗口里，趁它没关之前把
  `suspend()` + `resume()` 连着调一遍（不 `await`：iOS 上 suspend 的 Promise
  可能永远不 resolve，交给 WebKit 自己排队），只做一次。探针随后接住仍然没起来
  的设备，并把「设备根本没在跑」也纳入提示条件。

## 2026-10-02

这一天做了两件事：把档案与内容理顺（编号、分类、研究记录，并补两篇文章），以及按真机
反馈修了一批移动端与 iOS 的问题；顺手把发布流程自动化。

### 新增

- **推送到 `main` 即自动上线**：`.github/workflows/deploy.yml` 在 GitHub 的机器上跑完整
  构建再上传 Cloudflare。仓库 Secret `CLOUDFLARE_API_TOKEN` 已配置并端到端验证通过
  （14 步全绿，约 47 秒）。本地 `publish.sh` / `deploy.sh` 仍然可用——想先在本地看效果
  再决定上不上线就走那条路。

  用 GitHub Actions 而不是 Cloudflare 自带的 Git 集成，是因为后者需要在 Cloudflare
  后台做 GitHub OAuth 授权（只能本人操作），而 Actions 只要一个 Token。
- **发布脚本**：
  - `cf-deploy/import-posts.mjs`：从写作端（Obsidian 的 `Blog/_posts`，Hexo 格式）导入
    新文章。按标题去重、`hello-world.md` 之类忽略、**id 自动分配**（取现有最大的
    `wp-<数字>` 顺延）、网址沿用 `/年/月/日/标题/`。
  - `cf-deploy/publish.sh`：导入 → 构建 → 部署一条龙。发现带「摘要待润色」标记的文章
    会先提示确认（`SKIP_REVIEW=1` 可跳过）。
- **`/lab/` 顶栏「← 主站」**：一键回到 woo3an.top。顶栏的按钮与链接现在共用同一套排版。
- **进档案详情后预取阅读层**：阅读层仍是按需加载（三维入口首屏不为它付费），但在用户
  读概述时就把 `reader` / `loader` / `styles` 三个分包取回来（`ReaderFeature.prefetch()`，
  空闲时发起、失败静默）。点「阅读全文」不必现等 200 多 KB——弱网下最容易失败的就是
  这一步。
- **触屏设备首访用「性能」画质**：SSAO（32 次采样）与景深在手机上很贵，持续拖动档案阵列
  时最容易掉帧。粗指针设备首次访问从 `performance` 预设起步（桌面仍是 `original`），
  用户动过画质设置后以存档为准。
- **「研究记录」有内容了**：三维档案详情面板的 `02 研究记录` 标签页一直都在
  （`.research-notes` 编号列表，与上游一致），但生成记录时把 `findings` 直接写成
  `[description]`——于是它和 `01 概述` 显示的是同一段话，等于没有。现在文章可以用
  `findings` 字段写自己的条目（`schema.mjs` 放行，`build-lab-content.mjs` 优先采用，
  没写才退回摘要），并已按上游的条目风格给 7 篇内容各补 3 条。写法规范见
  [`content/README.md`](content/README.md) 的「研究记录怎么写」。

### 变更

- **档案编号改为稳定分配**：原先按遍历主题列累加，加一篇文章会把后面所有编号顶掉。
  现改为按文章 `id` 排序取序号（`wp-000 → X-001`、`wp-001 → X-002`……），新增文章只会
  往后追加，与主题列顺序、归类调整都无关。「其他」列因此移回最后。
- **档案槽位 40 → 11 → 7**：`SLOTS_PER_THEME` 由 8 改成 3 且不再循环重复；空列只各补
  1 篇（见「内容」）。原先 5 主题 × 8 槽位会把 4 篇文章摊成 X-001…X-040，看着像有几十篇。
  3D 场景的卡片数是固定的（与记录数无关），所以减少记录不会让档案墙变空。
- **分类改用四字标题**：文章归入 读书笔记 / 观影笔记 / 技术笔记 / 杂感随笔 / 其他，
  与旧博客的对应关系见下节映射表。
- **「关于」不再挂分类**：它在新旧两站都只是独立页面（id 仍为 `wp-000`）。
- **导航去掉 RSS 入口**：`/rss.xml` 仍然生成，只是不放入口。
- **线上 Worker 改名 `rhinelab-blog`，博饼拆分到独立 Worker**：此前本仓库与游戏仓库
  （[Woo3aN/bobing](https://github.com/Woo3aN/bobing)）用**同一个 Worker 名 `bobing`**
  部署，谁后部署谁把对方整个覆盖掉——游戏一上线，博客就没了（根路径 520）。
  现在一个域名两个 Worker、按路径分工、各自独立部署：

  | Worker | 路由 | 仓库 | 内容 |
  | --- | --- | --- | --- |
  | `rhinelab-blog` | `woo3an.top/*` | 本仓库 `cf-deploy/` | `/` 博客、`/lab/` 三维档案 |
  | `bobing-game` | `woo3an.top/bobing*`、`woo3an.top/ws*` | Woo3aN/bobing `cf/` | 博饼页、房间服务 |

  Cloudflare 按路由特异性分发，`/bobing*` 比 `/*` 更具体，游戏那两条路径的请求
  不会落到本站。
- **文档同步**：`docs/READER.md`（页面契约、失败与降级）、`docs/FEATURES.md`（门面方法）、
  `content/README.md`（`findings` 字段与「研究记录怎么写」）、`README.md` 与本文件。

### 移除

- 博饼相关全部迁到游戏仓库，本仓库不再有第二份：`cf-deploy/bobing/index.html`、
  `worker.js` 里的 `/ws` 与 `/bobing` 分支及 `RoomDO` 房间服务、
  `wrangler.jsonc` 的 Durable Object 绑定与 `migrations`、
  `deploy.sh` 与 `deploy.yml` 里合并博饼页的步骤。
  房间服务只留一份是有意的：两个 Worker 的 Durable Object 存储互相隔离，
  两边都实现会让同一个房间号出现两份互不相干的房间数据。

### 内容

- 新增两篇文章，填满档案里原本没有对应内容的两列：
  `wp-005`「本站是怎么搭起来的」（技术笔记）、`wp-006`「搬家小记」（杂感随笔）。
- 现在 7 篇内容在 `/lab/` 里各占一个档案编号（X-001…X-007），**没有重复**。

### 修复

**档案与展示**

- **档案编号前后不一致**：详情面板的 `NO.xxx`、三维卡片上的 `NO.xxx` 用的是数组下标
  （`selected + 1`），而档案编号 `X-00N` 用的是按文章 id 排序的稳定序号——于是会看到
  「NO.007 对应 X-001」这种对不上的组合。现在三处（详情面板、脚注、场景卡片）都取
  `displayNumber`，编号从 001 起。
- **等宽字体的中文回退**：博客侧 `--font-mono` 少写了 `"MiSans"`，而 JetBrains Maple Mono
  是纯拉丁子集（`unicodes` 里不含 CJK 区），导致标签、日期、元信息等用等宽字体的中文掉到
  系统等宽字体（中文 Windows 上是 NSimSun），与正文的 MiSans 明显不是一套。现已补上，与
  阅读层 `reader.css` 的定义一致；同类兜底列表 `shared/reading/prose.css` 也一并补上。

**移动端与 iOS**

- **关闭按钮的焦点方框被裁**：面板右上的 CLOSE ×、阅读器的 CLOSE ×、详情面板的
  「阅读全文」都贴着容器右边界，而焦点环用的是 7px 的 `outline-offset`，会越出 7–9px
  被容器的 `overflow` 裁掉右边——看上去就是「文字外面套着一个缺口的方框」。
  - **触摸设备**：干脆不画。这里的焦点常常是程序化产生的（打开阅读器时会
    `closeButton.focus()`、收起阅读器时会把焦点还给入口按钮），Safari 会把这判定成
    `:focus-visible`，用户没碰键盘也会凭空看到方框；触摸用户本来也不需要这个提示。
    规则用 `@media (pointer: coarse), (hover: none)` 覆盖 `button / a / input / select /
    summary / [tabindex]`，加 `!important` 是因为阅读层样式表按需加载、插在主样式表之后。
  - **桌面（键盘用户）**：保留焦点环，但改为向内画（`outline-offset: -2px`），不再越界。
- **滚动条压住正文**（两处，同一类问题）：窄屏滚动条是浮层、不占位，正文会一直贴到条子
  底下。阅读栏与详情面板正文各留出 14px 右侧空隙（只在紧凑/竖屏布局生效，桌面版心不
  受影响；详情面板原先只有 3px）。
- **弹窗的关闭按钮不再随内容滚动**：`.modal-top` 改为 sticky 钉在弹窗顶部，容器原本的
  `padding-top` 移交给它。手机上设置面板很长，滚到中段就够不着 × 了。
- **切列会让界面“卡住”**：档案刻度（`.file-ticks`）只在启动时按当时那一列生成一次，
  切到档案更少的列时 `files[slot]` 落空，`records[undefined].id` 抛 TypeError，
  `updateSelection` 随之中断——表现就是切列之后界面不再更新。现在刻度按当前列重建
  （点击走 document 上的委托，重建 innerHTML 不丢事件）。上一次把「其他」列从第一位
  挪到最后时，初始列从 1 篇变成 3 篇，正好把这个潜伏的问题放大了。

**背景音乐（iOS Safari）**

- **切回浏览器后音乐不再播放**：iOS 从后台切回时 `AudioContext.resume()` 的 Promise
  可能永远不 resolve，原来的 `await Promise.all([this.suspension, resume])` 会把整条
  激活链卡死——之后就再也听不到音乐，而且没有任何报错。现在加了 1.5 秒超时保护
  （`RESUME_TIMEOUT_MS`），超时按「这次没恢复成功」处理，交给下一次手势重试。
  `suspend()` 也加了同样的上限：它在 iOS 上同样可能永不 resolve，此前会让此后每一次
  激活都先干等一轮。
- **误报「无法播放」**：真机上的错误是
  `NotAllowedError: Failed to start the audio device`——系统拒绝启动音频设备，
  **不是格式问题**，换一次真实手势重试就有机会成功。之前它会一路走到
  「BACKGROUND MUSIC 无法播放」，把人引向错误的结论。现在：
  - 这类失败归入「可重试」：提示改成可点的「恢复播放」，设置面板里也给出当前状态
    （引擎状态 / 数据是否就绪 / 具体原因），不再是黑箱；
  - **打开设置面板本身就是一次真实手势**，顺势补一次解锁——用户点开设置就能响，不必去
    猜「点一下屏幕」是什么意思；
  - `AudioContext` 变成 `closed`（系统收走音频会话）时重建一套增益节点，而不是继续
    `resume()` 一个已经死掉的实例；
  - 解码失败时自动退回 mp3 单轨——不再只信
    `canPlayType('audio/ogg; codecs="vorbis"')`（Safari 会给出 `maybe` 却在实际解码时
    抛 `EncodingError`），同时覆盖下载被截断、分段损坏等情况。该 mp3 原先不在
    `prepare-assets.mjs` 白名单里，根本不会被打包进产物，已一并加入；
  - 音乐下载超时 15 → 30 秒（手机上弱网很容易误判成失败）。
- **音乐开关读错了键**：`prefs.music` 原本取的是 `storedPrefs.sound`，把音效的开关当成
  音乐的。已改为读 `storedPrefs.music`；同时给存档加上版本号 `v: 2`，并把此前被这个 bug
  写死的 `music: false`（症状是 `music` 与 `sound` 同时为 `false`）迁移掉——否则用户怎么
  翻设置都是静音，连提示都不会出现。

**阅读层**

- **「关于」在 `/lab/` 里不再报「不满足阅读契约」**：上游契约只放行
  `data-reader-kind="post"`，`check-reader` 还明确禁止页面带契约标记。本站要让独立页面
  也能沉浸阅读，于是放行 `page` 类型——`shared/reading/contract.ts` 接受两种 kind；
  `PostLayout.astro` 给页面输出同一套标记（kind 按实际类型）；
  `scripts/blog/check-reader.mjs` 由「页面不得带标记」改为「页面必须满足契约且 kind 为
  page」。
- **提示「已打开独立文章页」但其实什么都没打开**：阅读层是带内容哈希的独立分包，页面
  停留期间站点若重新部署过，旧分包就是 404；弱网下也可能整包加载失败。原来的失败处理
  只发了一条提示，而入口链接的默认跳转早在点击时就被 `preventDefault` 掉了——结果既不
  开阅读器、也不跳转。现在按提示所说的真的导航过去（`location.assign`，不用
  `window.open`：它在 `await` 之后会被 Safari 当弹窗拦掉），并把原因写进提示
  （「页面版本已更新」/「网络异常」）与 `console.warn`。ES 模块的加载失败会被 module map
  记住，重试同一个 URL 只会立刻失败，所以这里不做重试。另外「无法打开沉浸式阅读」这条
  不再谎报已跳转——它只可能是阅读层自身状态异常。

### 分类映射（档案主题列 ← 旧博客分类）

`/lab/` 的策展主题是独立于文章分类的一层，文章按下面的对应关系归类：

| 档案主题列 | 旧博客分类 | 现有内容 |
| --- | --- | --- |
| 读书笔记 | 读书笔记 | wp-001 / wp-002 / wp-003 |
| 观影笔记 | 观后感 | wp-004 |
| 技术笔记 | — | wp-005「本站是怎么搭起来的」 |
| 杂感随笔 | 随笔 | wp-006「搬家小记」 |
| 其他 | — | wp-000「关于」 |

「关于」在新旧两站都不再挂分类（它是独立页面）。原先技术笔记与杂感随笔没有对应文章，
曾用 wp-003 占位；现在补了两篇真实的文章（wp-005 / wp-006），占位取消。空主题会自动
回退显示所有公开文章，所以档案墙不会出现空列。

### 说明

- **摘要仍由人（或 AI）写**。主题强制要求非空、≤300 字，它会出现在首页列表、搜索结果、
  RSS 和三维档案卡片上。导入脚本只能从正文首段草拟一句并在 frontmatter 里写上
  `# 摘要待润色` 标记，上线前应改成真正想要的那句话。
- 只有 `deploy.sh` / `publish.sh`（以及推到 `main` 触发的 Actions）会让线上变化；
  `git push` 到别的分支只是备份代码。

### 注意

- `.terminal-modal` 与 `.reader-sheet`、`.modal-top` 与 `.reader-toolbar` 是**成对复用**的
  类名（`sheet.className = "terminal-modal reader-sheet"`、`toolbar.className =
  "reader-toolbar modal-top"`）。改动其中一条规则时必须排除另一侧，否则阅读器会跟着变。
- **音频类的验证要在线上做**：本机 Chrome 对 `localhost` 的 `fetch` 会返回 204 / 0 字节
  （`curl` 对同一 URL 却是 200 + 完整字节），`decodeAudioData` 必然失败——那是环境问题，
  不是代码问题。
- **两个仓库的 Worker 名字不能重名**：Worker 名就是部署单元的 ID，同名部署 =
  后部署的把先部署的整个覆盖掉（2026-10-02 之前两边都叫 `bobing`，游戏一上线
  博客就整个没了）。改路由请改仓库里的 `wrangler.jsonc`，不要只改 Cloudflare
  控制台——下次部署以配置为准，控制台的手工改动会被冲掉。
- **route pattern 必须带 `*`（游戏那边的教训）**：pattern 匹配的是完整 URL，
  写死 `woo3an.top/ws` 只匹配不带 query 的 `/ws`，而游戏连的是 `/ws?code=1234`，
  会漏回本站的 `woo3an.top/*` 拿到 404 页，且这个 404 会被边缘缓存住。

## 2026-10-01 — 站点上线

博客主站替换掉原来 `/` 直接 302 到 `/bobing` 的单一入口。现在一个 Cloudflare Worker
同时托管三块内容：`/` 博客、`/lab/` 三维档案终端、`/bobing` 与 `/ws` 中秋博饼。

### 新增

- `cf-deploy/`：Cloudflare Worker 的部署配置（`wrangler.jsonc`、`worker.js`、`deploy.sh`）。
  构建、部署与本机特有的两个坑都写在 [`cf-deploy/README.md`](cf-deploy/README.md)。
- 404 改用主题设计好的页面（之前返回空响应）。
- 三维内容里补上 `tags` 字段，供 `/lab/` 的档案元信息显示。

### 变更

- 站名、作者默认值、页脚与 RSS 换成 Woo3aN's Blog。
- `/lab/` 的档案元信息改成博客自己的字段，不再用虚构的莱茵生命设定：

  | 原来 | 现在 |
  | --- | --- |
  | `DEPARTMENT / 科室` | `CATEGORY / 分类` |
  | `COLLECTION / 编目范围` | `DATE / 日期` |
  | `RELATED / 相关人物` | `TAGS / 标签` |

  原来「相关人物」取的是文章作者，而本站作者恒为一人，没有信息量，换成标签更实用。
- 检索弹窗里残留的「科室」统一改成「分类」。
- 三维档案的五个策展主题换成博客自己的分类：读书笔记、观影笔记、技术笔记、杂感随笔、归档。

### 移除

- **`/lab/` 的注册与登录**：身份门只保留「以访客身份进入」。本站没有账号系统，
  `services/lab-auth`（Go + SQLite）不部署，代码留着只为方便同步上游。
- 登录/注册表单、密码校验、请求重试与 HTTP 账号客户端调用，以及
  `src/features/auth/dev-port.ts`（失去引用会变成孤儿文件，被功能边界守卫拦下）。
- 博客页头的「登录」入口、账号岛脚本，以及 `/account/` 的登录表单（改为静态说明页）。

### 内容

- 迁入原 Hexo 博客的 4 篇文章与「关于」页，**保留原网址**：

  | 文章 | 网址 | 分类 | id |
  | --- | --- | --- | --- |
  | 鲁迅先生的冷与热 | `/2026/07/15/鲁迅先生的冷与热/` | 读书笔记 | `wp-001` |
  | 【补完计划】《鼠疫》与《局外人》 | `/2026/07/16/【补完计划】《鼠疫》与《局外人》/` | 读书笔记 | `wp-002` |
  | 我看娜拉出走 | `/2026/07/18/我看娜拉出走/` | 读书笔记 | `wp-003` |
  | 【补完计划】俗女养成记 | `/2026/07/19/【补完计划】俗女养成记/` | 观影笔记 | `wp-004` |
  | 关于（页面） | `/about/` | 杂感随笔 | `wp-000` |

- 主题自带的示例文章与示例页面全部删除。

### 说明

- **收藏功能不受去登录影响**：它本来就存在浏览器 `localStorage` 里（键 `example-saved`，
  存的是文章 id），不依赖账号，代价是换设备或清缓存会丢。
- 文章 id 只需满足「格式为 `wp-<数字>`、不重复、发布后不再改」三条。改 id 会导致
  已收藏的文章丢失、三维档案的映射断掉。
