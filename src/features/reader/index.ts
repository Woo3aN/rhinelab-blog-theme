import type { ImmersiveReader, ReaderTarget } from "./reader";

/**
 * 沉浸式 Markdown 阅读功能模块的唯一对外入口。
 *
 * 边界（详见 src/features/README.md 与 docs/FEATURES.md）：
 * - 本模块拥有：阅读层窗口、目录导航、内容加载、markdown 呈现样式，
 *   以及“从档案详情里的链接进入阅读层”的全部集成逻辑。
 * - 本模块不拥有：档案选中状态、三维场景、终端音效与提示、启动身份门。
 *   这些能力通过下面的宿主端口按需借用，因此移除本模块不会牵动核心。
 * - 阅读层代码与其 HTML 解析栈、样式表都按需加载，首屏 bundle 不为它付费
 *   （IR 计划 §5.3.2、§11.3）。
 */

/** 详情页里触发页内阅读的链接标记（由档案详情模板产出）。 */
export const READER_ENTRY_SELECTOR = '[data-action="read-immersive"]';

export type ReaderMode = "boot" | "archive" | "detail";

/** 宿主（三维档案应用）向阅读层提供的最小能力集。 */
export interface ReaderHost {
  /** 当前选中档案的可读目标；未选中任何档案时返回 null。 */
  currentTarget(): { postId: string; href: string; title: string } | null;
  /** 档案已就绪，阅读入口可用。 */
  isArchiveReady(): boolean;
  /** 启动身份门仍占用屏幕时，任何入口都不得打开阅读层。 */
  isIdentityGateActive(): boolean;
  /** 当前场景模式；离开详情后不再接受打开请求。 */
  currentMode(): ReaderMode;
  /** 终端提示条。 */
  notify(message: string): void;
  /** 终端音效。 */
  playSound(name: "page-open"): void;
  /** 阅读层打开期间冻结三维输入（指针、滚轮、键盘）。 */
  setSceneInputSuspended(suspended: boolean): void;
}

/** DEV 审阅用的只读快照。 */
export type ReaderReviewSnapshot = {
  active: boolean;
  state: string;
  load: string;
  pendingLink: string | null;
  pendingToken: number;
  lastDecline: string;
  moduleLoaded: boolean;
};

/** 核心通过这个门面使用阅读层；核心不直接接触 ImmersiveReader。 */
export interface ReaderFeature {
  /** 阅读层是否正在占用屏幕。 */
  isActive(): boolean;
  /** 事件是否发生在阅读层子树内（弹框与其顶层）。 */
  ownsEvent(event: Event): boolean;
  /** 从详情里的链接打开：非用户原意或状态已变时保持原生跳转。 */
  open(link: HTMLAnchorElement): Promise<void>;
  /** 详情面板出现后调用：空闲时预取阅读层分包，让点击不等下载。 */
  prefetch(): void;
  /** 上下文切换：静默关闭，不把焦点还给入口链接。 */
  closeIfActive(): void;
  /** 上下文切换的等待版（登出等需要确认关闭完成）。 */
  closeForContextChange(): Promise<void>;
  /** 先关闭阅读层再执行动作（模态、重播、场景切换）。 */
  withClosed<T>(action: () => T | Promise<T>): Promise<T>;
  /** 释放锁与待处理请求（bfcache 恢复、页面隐藏）。 */
  release(): void;
  /** DEV 审阅快照。 */
  snapshot(): ReaderReviewSnapshot;
  /** HMR：不得留下第二个阅读层、监听器或输入锁。 */
  dispose(): void;
}

export function createReaderFeature(host: ReaderHost): ReaderFeature {
  let reader: ImmersiveReader | null = null;
  let modulePending: Promise<ImmersiveReader> | null = null;
  let lastFocus: HTMLElement | null = null;
  /** 最近一次 open 的结果，只读诊断，用于 IR4 集成证据。 */
  let decline = "idle";
  const pending = { token: 0, link: null as HTMLAnchorElement | null };

  const isActive = (): boolean => reader?.isActive === true;

  /** 事件是否属于阅读层表面（弹框与其顶层）。 */
  const ownsEvent = (event: Event): boolean =>
    event.target instanceof Element && Boolean(event.target.closest("dialog.article-reader"));

  const targetFor = (link: HTMLAnchorElement): ReaderTarget | null => {
    const record = host.currentTarget();
    if (!record) return null;
    const href = link.getAttribute("href") ?? record.href;
    if (!href) return null;
    return { postId: record.postId, href, title: record.title };
  };

  /** 阅读层按需加载的三块资源；预取与正式打开共用同一条路径。 */
  const loadModules = () =>
    Promise.all([
      import("./reader"),
      import("./loader"),
      // 样式表与阅读层同批加载：首屏不为阅读层付费，弹框出现时样式必已就位。
      import("./styles"),
    ]);

  async function ensure(): Promise<ImmersiveReader> {
    if (reader) return reader;
    modulePending ??= (async () => {
      const [mod, content, styles] = await loadModules();
      void styles;
      const installed = mod.installArticleReader({
        origin: location.origin,
        // 挂在 #stage 之外：阅读层是独立顶层表面，不能被舞台的 inert 快照
        // 或模态 inert 清扫捕获。
        mount: document.body,
        stylesheetHref: null,
        load: content.loadArticleContent,
        onInputSuspended: (value) => host.setSceneInputSuspended(value),
        onChange: (snapshot) => {
          if (snapshot.state !== "closed") return;
          const target = lastFocus;
          lastFocus = null;
          // 退出动画由阅读层自己掌控；它结束后再把焦点同步回来。
          if (target && target.isConnected && document.contains(target)) {
            target.focus({ preventScroll: true });
          }
        },
      });
      reader = installed.reader;
      return reader;
    })().catch((error) => {
      modulePending = null;
      throw error;
    });
    return modulePending;
  }

  /**
   * 详情面板出现后提前把阅读层的分包拉到本地缓存。
   * 这不是首屏开销（详情是用户主动进入的），却能让「阅读全文」不再等 200 多 KB
   * 下载完才打开 —— 点击时资源大多已经就位，弱网下也少一次失败的机会。
   * 失败静默：正式打开时会重新走一次 ensure()，届时再按真实结果处理。
   */
  function prefetch(): void {
    if (reader || modulePending) return;
    const start = () => void loadModules().catch(() => {});
    // Safari 长期不支持 requestIdleCallback，退化成短延时；两条路都放在后台，
    // 不阻塞详情面板的渲染与动画。
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number })
      .requestIdleCallback;
    if (typeof idle === "function") idle(start, { timeout: 2500 });
    else setTimeout(start, 600);
  }

  /**
   * 模块加载失败的提示文案。浏览器原文（`Failed to fetch dynamically imported
   * module` 之类）没有可读性，只保留两类对用户有意义的原因。
   */
  function describeModuleFailure(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const stale = /dynamically imported module|Importing a module script failed|MIME type|404/i;
    return stale.test(message) ? "页面版本已更新" : "网络异常";
  }

  async function open(link: HTMLAnchorElement): Promise<void> {
    const reject = (why: string) => {
      decline = why;
    };
    decline = "entered";
    if (host.isIdentityGateActive()) return reject("identity");
    if (!host.isArchiveReady()) return reject("not-ready");
    if (!link.isConnected) return reject("link-disconnected");
    const target = targetFor(link);
    if (!target) return reject("no-target");
    const token = ++pending.token;
    pending.link = link;
    host.notify("正在准备全文阅读…");
    let instance: ImmersiveReader;
    try {
      instance = await ensure();
    } catch (error) {
      if (token === pending.token) pending.link = null;
      // 阅读层是带内容哈希的独立分包（reader / loader / styles 三个 chunk）。
      // 页面停留期间站点若重新部署过，旧分包就是 404；弱网下也可能整包加载失败。
      // ES 模块的加载失败会被 module map 记住 —— 同一个 URL 再 import 只会立刻
      // 失败，重试没有意义，所以这里直接走文案所说的兜底。
      console.warn("[reader] 全文阅读模块加载失败", target.href, error);
      host.notify(`全文阅读模块加载失败（${describeModuleFailure(error)}），已打开独立文章页`);
      // 提示必须与行为一致：真正导航过去。上游只发了提示，而入口链接的默认
      // 跳转早已被 preventDefault 掉，结果是「既不打开阅读器、也不跳转」。
      // 用 location.assign 而不是 window.open —— 后者在 await 之后会被
      // Safari 当作弹窗拦掉，同源导航不受这个限制。
      location.assign(target.href);
      return reject("import-failed");
    }
    // await 之后重新确认归属：用户可能已离开详情、选中项可能已变、
    // 或者另一个链接已经点过。
    if (token !== pending.token) return reject("superseded");
    pending.link = null;
    if (host.currentMode() !== "detail") return reject(`mode:${host.currentMode()}`);
    if (host.isIdentityGateActive()) return reject("identity-after-await");
    if (!link.isConnected) return reject("link-disconnected-after-await");
    const current = targetFor(link);
    if (!current) return reject("no-target-after-await");
    if (current.href !== target.href || current.postId !== target.postId) return reject("target-changed");
    lastFocus = link;
    const opened = instance.open(current, link);
    if (!opened) {
      lastFocus = null;
      // 这里只可能是阅读层自身状态异常（已释放 / 正在收起 / showModal 失败），
      // 不是「内容取不到」，所以不要谎报已经跳转到独立文章页。
      host.notify("无法打开沉浸式阅读，请重试");
      return reject(`open-returned-false:${instance.state}`);
    }
    decline = "opened";
    host.playSound("page-open");
  }

  /** 上下文切换：静默关闭，不把焦点还给入口链接。 */
  function closeIfActive(): void {
    if (!isActive()) return;
    void reader?.close("context-change", { restoreFocus: false });
  }

  async function closeForContextChange(): Promise<void> {
    if (!isActive()) return;
    await reader?.close("context-change", { restoreFocus: false });
  }

  async function withClosed<T>(action: () => T | Promise<T>): Promise<T> {
    if (reader) await reader.close("context-change", { restoreFocus: false });
    pending.token += 1;
    pending.link = null;
    return action();
  }

  /** 释放：作废待处理请求并静默关闭（页面隐藏 / bfcache 恢复）。 */
  function release(): void {
    pending.token += 1;
    pending.link = null;
    if (reader?.isActive) void reader.close("context-change", { restoreFocus: false });
  }

  function snapshot(): ReaderReviewSnapshot {
    return {
      active: isActive(),
      state: reader?.state ?? "none",
      load: reader?.loadState ?? "none",
      pendingLink: pending.link?.getAttribute("href") ?? null,
      pendingToken: pending.token,
      lastDecline: decline,
      moduleLoaded: Boolean(reader),
    };
  }

  function dispose(): void {
    pending.token += 1;
    pending.link = null;
    reader?.dispose();
    reader = null;
    modulePending = null;
  }

  // 页面隐藏与 bfcache 恢复都由本模块自理：核心不需要知道阅读层的锁。
  window.addEventListener("pagehide", release);

  return { isActive, ownsEvent, open, prefetch, closeIfActive, closeForContextChange, withClosed, release, snapshot, dispose };
}
