// 身份门面板：只保留「以访客身份进入」这一个动作。
//
// 本站不提供账号系统，原先的登录/注册表单、密码校验、请求重试与
// `shared/auth/client.ts` 的网络流程都已移除。面板现在只有标题和一个进入按钮。
//
// 为什么保留面板而不是直接自动进入：
//   1. 序幕交接需要一次真实的用户手势来解锁音频（宿主会调用 audio.unlock()）；
//   2. 面板 DOM 是序幕入场动画的目标（`[data-intro-row]` 的逐行浮现）。
import { guestIdentity, type ChosenIdentity } from "../../../shared/auth/identity";
import type { EntryPanelPhase } from "./identity";

export interface BootEntryOptions {
  mount: HTMLElement;
  onIdentityChosen: (identity: ChosenIdentity) => void;
  /** Synchronous user-activation hook: called from a real submit. */
  onEngage?: () => void;
  onPanelPhase: (phase: EntryPanelPhase, busy: boolean) => void;
}

export class BootEntry {
  readonly element: HTMLElement;
  private readonly form: HTMLFormElement;
  private phaseValue: EntryPanelPhase = "login";
  private busyValue = false;
  private started = false;

  constructor(private readonly options: BootEntryOptions) {
    this.element = document.createElement("section");
    this.element.id = "boot-entry";
    this.element.className = "boot-entry";
    this.element.dataset.phase = "login";
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-label", "进入三维档案");
    this.element.innerHTML = `
      <form id="entry-form" class="entry-form" novalidate aria-label="进入三维档案">
        <h1 class="entry-welcome" id="entry-title">WELCOME</h1>
        <button type="submit" class="entry-submit" id="entry-submit" data-intro-row>ENTER AS GUEST</button>
      </form>`;

    this.form = this.element.querySelector<HTMLFormElement>("#entry-form")!;
    this.form.addEventListener("submit", this.onSubmit);
    options.mount.append(this.element);
    this.options.onPanelPhase(this.phaseValue, this.busyValue);
  }

  get phase(): EntryPanelPhase {
    return this.phaseValue;
  }

  get busy(): boolean {
    return this.busyValue;
  }

  /** Called by the intro when the entry page becomes visible. */
  show(): void {
    this.reset();
    this.options.onPanelPhase(this.phaseValue, this.busyValue);
  }

  /** Explicit replay: back to a clean entry state. */
  reset(): void {
    this.started = false;
    this.busyValue = false;
    this.element.removeAttribute("data-busy");
    this.phaseValue = "login";
    this.element.dataset.phase = "login";
  }

  dispose(): void {
    this.form.removeEventListener("submit", this.onSubmit);
    this.element.remove();
  }

  private onSubmit = (event: Event): void => {
    event.preventDefault();
    // 必须在同一次用户手势里先解锁音频，再提交身份。
    this.options.onEngage?.();
    this.chooseGuest();
  };

  private chooseGuest(): void {
    if (this.started) return;
    this.started = true;
    this.busyValue = true;
    this.element.toggleAttribute("data-busy", true);
    this.options.onPanelPhase(this.phaseValue, true);
    this.options.onIdentityChosen(guestIdentity());
  }
}
