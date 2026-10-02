import { hasTypingBetween, LEGACY_LABEL } from "./typing-rhythm";
import { TYPING_PCM, TYPING_SAMPLE_RATE } from "./typing-samples";
import { assetUrl } from "./asset-url";
export type Sound =
  | "page-open"
  | "page-close"
  | "ui-tick"
  | "brand"
  | "text-reveal"
  | "key"
  | "tick"
  | "column"
  | "open"
  | "confirm"
  | "back"
  | "scan"
  | "welcome"
  | "array"
  | "inspect"
  | "explode"
  | "assemble";
export type SoundScene = "boot" | "archive" | "detail" | "viewer";
export type AudioPreferences = {
  sound: boolean;
  music: boolean;
  soundVolume: number;
  musicVolume: number;
};
const STEMS = ["atmosphere", "motif", "pulse"] as const;
/**
 * 不支持 Ogg Vorbis 时的单轨降级：仓库里的混好试听版。
 * 旧版 iOS Safari（17 之前）解不了 Ogg，三段分轨会静默失败，用这首顶替。
 */
const FALLBACK_STEM = "observatory-preview";
const LOOP_SECONDS = 160 / 3;
/** 运行期探测能否解码 Ogg Vorbis（Safari 长期不支持）。 */
function supportsOggVorbis(): boolean {
  if (typeof document === "undefined") return true;
  const probe = document.createElement("audio");
  return probe.canPlayType('audio/ogg; codecs="vorbis"') !== "";
}
/**
 * iOS 会因为「当前不是用户手势」「音频会话被系统收走」等原因拒绝启动音频设备，
 * 报 `NotAllowedError: Failed to start the audio device`。这类失败换一次真实
 * 手势重试就有机会成功，不该被当成「这个站没有声音」。
 */
function isRetryableAudioFailure(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return /start the audio device|not allowed|NotAllowedError|interrupted/i.test(raw);
}
/**
 * 把音频失败翻译成人话。原始文案（`NotAllowedError: Failed to start the audio
 * device` 之类）用户看不出发生了什么，更不知道该做什么。
 */
function describeAudioError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (!raw) return "未知原因";
  if (isRetryableAudioFailure(error)) return "浏览器拒绝了这次播放，点一下即可重试";
  if (/decode|EncodingError/i.test(raw)) return "浏览器无法解码音乐文件（格式不受支持或文件不完整）";
  if (/abort|timed? ?out/i.test(raw)) return "音乐下载超时，请检查网络后重试";
  return raw;
}
/**
 * 等待音频设备 resume/suspend 的上限（毫秒）。
 * iOS Safari 在音频被系统打断后，这两个 Promise 可能永远不 resolve ——
 * 不加限制会把整条激活链卡死，之后再也听不到音乐，而且没有任何报错。
 */
const RESUME_TIMEOUT_MS = 1500;
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
const typingBuffers = new WeakMap<
  BaseAudioContext,
  { buffers: AudioBuffer[]; next: number }
>();
function typingSample(c: BaseAudioContext) {
  let bank = typingBuffers.get(c);
  if (!bank) {
    bank = {
      buffers: TYPING_PCM.map((encoded) => {
        const bytes = atob(encoded);
        const buffer = c.createBuffer(1, bytes.length / 2, TYPING_SAMPLE_RATE);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          const word =
            bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
          data[i] = (word > 32767 ? word - 65536 : word) / 32768;
        }
        return buffer;
      }),
      next: 0,
    };
    typingBuffers.set(c, bank);
  }
  return bank.buffers[bank.next++ % bank.buffers.length];
}
const clamp = (x: number) =>
  Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const level = (
  param: AudioParam,
  value: number,
  now: number,
  seconds = 0.05,
) => {
  // `cancelAndHoldAtTime` is Chromium/WebKit only; Firefox throws a TypeError,
  // which used to abort the whole boot. The fallback pins the current value and
  // drops whatever was scheduled after it, which is the same intent.
  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(now);
  } else {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
  }
  param.linearRampToValueAtTime(value, now + seconds);
};
export const BOOT_CUES: readonly { time: number; sound: Sound }[] = [
  { time: 9.16, sound: "brand" },
  { time: 11.84, sound: "confirm" },
  { time: 19.48, sound: "scan" },
  { time: 21.84, sound: "confirm" },
  { time: 22.76, sound: "welcome" },
  { time: 23.52, sound: "text-reveal" },
  { time: 25.04, sound: "text-reveal" },
  { time: 26.92, sound: "array" },
  { time: 30.68, sound: "open" },
  { time: 34.3, sound: "inspect" },
];

/** Shared by live playback and OfflineAudioContext verification. */
export function synthesizeSound(
  c: BaseAudioContext,
  destination: AudioNode,
  type: Sound,
  at: number,
  pan = 0,
) {
  const output = c.createGain(),
    stereo = c.createStereoPanner();
  stereo.pan.value = Math.max(-0.65, Math.min(0.65, pan));
  output.connect(stereo);
  stereo.connect(destination);
  const sources: AudioScheduledSourceNode[] = [];
  let remaining = 0,
    end = at;
  const connect = (
    source: AudioScheduledSourceNode,
    node: AudioNode,
    gain: number,
    delay: number,
    duration: number,
    attack = 0.006,
    preserveEnvelope = false,
  ) => {
    const env = c.createGain(),
      start = at + delay;
    if (preserveEnvelope) {
      // The reference excerpt already contains the impact envelope and edge fades.
      env.gain.setValueAtTime(gain, start);
    } else {
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(
        gain,
        start + Math.min(attack, duration * 0.3),
      );
      env.gain.exponentialRampToValueAtTime(0.00001, start + duration);
      env.gain.linearRampToValueAtTime(0, start + duration + 0.012);
    }
    node.connect(env);
    env.connect(output);
    sources.push(source);
    remaining++;
    source.onended = () => {
      source.disconnect();
      node.disconnect();
      env.disconnect();
      if (--remaining === 0) {
        output.disconnect();
        stereo.disconnect();
      }
    };
    source.start(start);
    source.stop(start + duration + 0.015);
    end = Math.max(end, start + duration + 0.015);
  };
  const tone = (
    f: number,
    to: number,
    gain: number,
    duration: number,
    delay = 0,
    attack = 0.006,
  ) => {
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(f, at + delay);
    osc.frequency.exponentialRampToValueAtTime(to, at + delay + duration);
    connect(osc, osc, gain, delay, duration, attack);
  };
  const air = (
    f: number,
    to: number,
    gain: number,
    duration: number,
    delay = 0,
    attack = 0.008,
  ) => {
    let buffer = noiseBuffers.get(c);
    if (!buffer) {
      buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 773;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = seed / 2147483648 - 1;
      }
      noiseBuffers.set(c, buffer);
    }
    const src = c.createBufferSource(),
      filter = c.createBiquadFilter();
    src.buffer = buffer;
    filter.type = "bandpass";
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(f, at + delay);
    filter.frequency.exponentialRampToValueAtTime(to, at + delay + duration);
    src.connect(filter);
    connect(src, filter, gain, delay, duration, attack);
  };
  // A thin glass plate: a fast contact transient excites unequal modes.
  // Upper modes fade first, leaving a small, clear body instead of a long bell.
  const glass = (
    fundamental: number,
    gain: number,
    decay: number,
    delay = 0,
  ) => {
    const modes = [
      [1, 1, 1],
      [1.47, 0.39, 0.66],
      [2.09, 0.21, 0.4],
      [2.73, 0.095, 0.25],
      [3.86, 0.035, 0.15],
    ];
    for (const [ratio, amplitude, damping] of modes) {
      const frequency = fundamental * ratio;
      if (frequency > Math.min(8500, c.sampleRate * 0.42)) continue;
      tone(
        frequency,
        frequency,
        gain * amplitude,
        decay * damping,
        delay,
        0.0012,
      );
    }
    air(4800, 3600, gain * 0.24, 0.013, delay, 0.0008);
  };
  switch (type) {
    case "page-open":
      air(700, 1800, 0.065, 0.18, 0, 0.025);
      tone(360, 480, 0.032, 0.16, 0, 0.014);
      tone(960, 960, 0.009, 0.075, 0.06, 0.01);
      break;
    case "page-close":
      air(1300, 600, 0.05, 0.13, 0, 0.014);
      tone(420, 280, 0.027, 0.13, 0, 0.01);
      break;
    case "ui-tick":
      air(1500, 1200, 0.042, 0.036, 0, 0.003);
      tone(820, 820, 0.022, 0.052, 0, 0.003);
      break;
    case "brand":
      tone(146.83, 146.83, 0.039, 0.72, 0, 0.08);
      tone(293.66, 293.66, 0.03, 0.62, 0.07, 0.07);
      tone(440, 440, 0.022, 0.54, 0.17, 0.055);
      air(420, 1750, 0.036, 0.7, 0, 0.13);
      break;
    case "text-reveal":
      air(2100, 1300, 0.033, 0.064, 0, 0.005);
      tone(1050, 1050, 0.012, 0.06, 0, 0.005);
      break;
    case "key": {
      const source = c.createBufferSource();
      source.buffer = typingSample(c);
      connect(source, source, 0.2, 0, source.buffer.duration, 0, true);
      break;
    }
    case "tick":
      glass(1680, 0.064, 0.24);
      break;
    case "column":
      glass(1280, 0.065, 0.32);
      glass(2050, 0.016, 0.18, 0.045);
      break;
    case "open":
      glass(1150, 0.071, 0.58);
      glass(2180, 0.025, 0.36, 0.16);
      air(3100, 4400, 0.014, 0.25, 0.035, 0.025);
      break;
    case "confirm":
      tone(640, 640, 0.039, 0.095, 0, 0.008);
      tone(960, 960, 0.026, 0.15, 0.095, 0.009);
      break;
    case "back":
      glass(1120, 0.066, 0.22);
      tone(560, 560, 0.012, 0.1, 0.025, 0.002);
      break;
    case "scan":
      air(1800, 3400, 0.025, 0.8, 0, 0.12);
      for (let i = 0; i < 4; i++)
        tone(760, 760, 0.025, 0.064, i * 0.19 + 0.15, 0.007);
      break;
    case "welcome":
      [293.66, 440, 659.25, 739.99].forEach((f, i) =>
        tone(f, f, 0.034, 1.6, i * 0.095, 0.05),
      );
      air(600, 1800, 0.065, 0.9, 0, 0.15);
      break;
    case "array":
      air(1600, 3300, 0.025, 0.8, 0, 0.12);
      for (let i = 0; i < 5; i++)
        glass(1180 + i * 170, 0.043 - i * 0.005, 0.31, 0.05 + i * 0.105);
      break;
    case "inspect":
      tone(1120, 1120, 0.026, 0.055, 0, 0.005);
      tone(1120, 1120, 0.018, 0.055, 0.11, 0.005);
      break;
    case "explode":
      [1220, 1680, 2260].forEach((f, i) =>
        glass(f, 0.054 - i * 0.01, 0.4 - i * 0.055, i * 0.115),
      );
      break;
    case "assemble":
      [2260, 1680, 1220].forEach((f, i) =>
        glass(f, 0.035 + i * 0.008, 0.2, i * 0.095),
      );
      break;
  }
  return {
    end,
    stop(now: number) {
      level(output.gain, 0, now, 0.018);
      for (const source of sources) {
        try {
          source.stop(now + 0.02);
        } catch {
          /* already ended */
        }
      }
    },
  };
}

export class TerminalAudio {
  private prefs: AudioPreferences = {
    sound: false,
    music: false,
    soundVolume: 0.55,
    musicVolume: 0.5,
  };
  private context?: AudioContext;
  private effects?: GainNode;
  private musicBus?: GainNode;
  private duck?: GainNode;
  private stemGains: GainNode[] = [];
  private buffers?: AudioBuffer[];
  private loading?: Promise<void>;
  private fetching?: Promise<ArrayBuffer[]>;
  private musicData?: ArrayBuffer[];
  /** 实际会加载的音轨（Ogg 分轨或单轨降级），首次访问时确定。 */
  private stems?: { name: string; file: string }[];
  private tracks: AudioBufferSourceNode[] = [];
  private voices: ReturnType<typeof synthesizeSound>[] = [];
  private lastSound = new Map<Sound, number>();
  private scene: SoundScene = "boot";
  private offset = 0;
  private startedAt = 0;
  private unlocked = false;
  private disposed = false;
  private bootTime: number | null = null;
  private error = "";
  /**
   * 这次失败是不是「再点一次可能就好」。
   * iOS 拒绝启动音频设备（`Failed to start the audio device`）属于这一类：
   * 设备是系统随时可能收走又还回来的，重试有意义，不该断言「无法播放」。
   */
  private errorRetryable = false;
  private requestId = 0;
  private suspension: Promise<void> = Promise.resolve();
  private bootMix = -1;
  private playedKeys = 0;
  private entryPending = false;
  /**
   * 回到前台后音乐没能响起来时通知宿主：
   * - `"gesture"`：iOS 需要一次新的用户手势才能恢复音频（切回 App 不算手势）；
   * - `"error"`：音频数据本身没加载/解码成功，例如旧版 iOS 解不了 Ogg Vorbis。
   */
  onSilent?: (reason: "gesture" | "error", detail: string) => void;
  private gestureNotified = false;
  constructor() {
    document.addEventListener("pointerdown", this.gesture, { capture: true });
    document.addEventListener("keydown", this.gesture, { capture: true });
    document.addEventListener("visibilitychange", this.visibility);
    window.addEventListener("pagehide", this.hide);
    window.addEventListener("pageshow", this.visibility);
  }
  private gesture = () => {
    if (this.entryPending) return;
    this.unlocked = true;
    this.gestureNotified = false;
    // 这是一次全新的尝试，旧错误不再代表当下。
    this.error = "";
    this.errorRetryable = false;
    void this.activate();
  };
  holdForEntry() {
    this.entryPending = true;
  }
  releaseEntry() {
    this.entryPending = false;
  }
  cancelEntry() {
    this.hide();
  }
  async unlock() {
    this.unlocked = true;
    this.gestureNotified = false;
    // 每次解锁都是一次重新尝试：先前的失败（尤其 iOS 的设备启动被拒）不该一直挂着。
    this.error = "";
    this.errorRetryable = false;
    await this.activate();
    // 首次进入（以及每次从后台回来）都在这里兜一次底：音乐没响就说清原因，
    // 而不是让用户以为「这个站没有声音」。
    this.reportIfSilent();
    return this.context?.state === "running" && (!this.prefs.music || Boolean(this.buffers));
  }
  // Fetch compressed tracks while the entry screen is visible; create/resume
  // the audio device only from a real click or keyboard activation.
  prepareMusic() {
    if (this.musicData) return Promise.resolve(this.musicData);
    this.fetching ??= Promise.all(this.stemFiles.map(async ({ name, file }) => {
      const controller = new AbortController();
      // 30 秒：手机弱网下这几 MB 音频常常要十几秒，15 秒会误判成失败，
      // 而失败一次就足以让用户以为「这个站没有声音」。
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(assetUrl(`audio/${file}`), { signal: controller.signal });
        if (!response.ok) throw new Error(`Music ${name}: ${response.status}`);
        return await response.arrayBuffer();
      } finally { clearTimeout(timeout); }
    })).then(data => this.musicData = data).finally(() => { this.fetching = undefined; });
    return this.fetching;
  }
  /**
   * 本机实际会加载的音轨。Ogg Vorbis 能用就加载三段分轨（可以按场景调比例），
   * 否则退回单个混音轨 —— 否则旧 Safari 上一声不响而且看不出原因。
   */
  private get stemFiles(): { name: string; file: string }[] {
    return this.stems ??= (supportsOggVorbis()
      ? STEMS.map((name) => ({ name, file: `${name}.ogg` }))
      : [{ name: FALLBACK_STEM, file: `${FALLBACK_STEM}.mp3` }]);
  }
  restartBoot() {
    this.stopEffects();
    this.bootTime = 6.76;
    this.bootMix = -1;
  }
  private hide = () => {
    this.requestId++;
    this.stopMusic();
    this.stopEffects();
    // 只需要「别在挂起完成前 resume」，而不是「必须等它完成」：iOS 上
    // `suspend()` 的 Promise 可能永远不 resolve，不加这个上限，之后每一次
    // 激活都要先干等一轮超时。
    const suspended = this.context?.suspend().catch(() => {}) ?? Promise.resolve();
    this.suspension = Promise.race([
      suspended,
      new Promise<void>((done) => { setTimeout(done, RESUME_TIMEOUT_MS); }),
    ]);
  };
  private visibility = () => {
    this.bootTime = null;
    if (document.hidden) {
      this.hide();
      return;
    }
    if (!this.unlocked || this.entryPending) return;
    void this.activate().then(() => this.reportIfSilent());
  };
  /**
   * 回到前台后音乐该响却没响起来。iOS 上这几乎总是因为系统要求一次新的用户
   * 手势（切回 App 不算），此时 `gesture` 里的激活要等用户碰一下屏幕才发生。
   * 只提示一次，用户一碰就会触发 `gesture` 并把提示状态清掉。
   */
  private reportIfSilent() {
    if (this.gestureNotified || this.disposed || document.hidden) return;
    if (!this.prefs.music || this.tracks.length) return;
    if (this.error && !this.errorRetryable) {
      // 数据没加载/解码成功：提示「点一下屏幕」也没用，把原因说出来。
      this.gestureNotified = true;
      this.onSilent?.("error", this.error);
      return;
    }
    if (this.context?.state === "running" && !this.error) return;
    // 其余情况（含 iOS 拒绝启动设备）都是「再碰一下屏幕就有机会」。
    this.gestureNotified = true;
    this.onSilent?.("gesture", "");
  }
  configure(prefs: AudioPreferences) {
    this.prefs = {
      sound: !!prefs.sound,
      music: !!prefs.music,
      soundVolume: clamp(prefs.soundVolume),
      musicVolume: clamp(prefs.musicVolume),
    };
    if (this.context) {
      level(
        this.effects!.gain,
        this.prefs.sound ? this.prefs.soundVolume : 0,
        this.context.currentTime,
      );
      level(
        this.musicBus!.gain,
        this.prefs.music ? this.prefs.musicVolume : 0,
        this.context.currentTime,
        0.2,
      );
    }
    if (!this.prefs.sound) this.stopEffects();
    if (!this.prefs.music) this.stopMusic();
    if (!this.prefs.sound && !this.prefs.music) this.hide();
    else if (this.unlocked && !this.entryPending) void this.activate();
  }
  private createContext() {
    const c = (this.context = new AudioContext()),
      master = c.createGain(),
      limiter = c.createDynamicsCompressor();
    master.gain.value = 0.8;
    limiter.threshold.value = -8;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    this.effects = c.createGain();
    this.musicBus = c.createGain();
    this.duck = c.createGain();
    this.effects.gain.value = this.prefs.sound ? this.prefs.soundVolume : 0;
    this.musicBus.gain.value = this.prefs.music ? this.prefs.musicVolume : 0;
    this.effects.connect(master);
    this.musicBus.connect(this.duck);
    this.duck.connect(master);
    master.connect(limiter);
    limiter.connect(c.destination);
    this.stemGains = this.stemFiles.map(() => {
      const gain = c.createGain();
      gain.gain.value = 0;
      gain.connect(this.musicBus!);
      return gain;
    });
    this.mixScene();
    return c;
  }
  private async activate() {
    if (
      this.disposed ||
      document.hidden ||
      !this.unlocked ||
      (!this.prefs.sound && !this.prefs.music)
    )
      return;
    const id = ++this.requestId;
    try {
      // iOS 会在系统收走音频会话之后把 AudioContext 变成 closed，那个实例再也
      // 起不来（resume 只会抛 `Failed to start the audio device`）。设备一旦
      // 失效就重建：AudioBuffer 可以跨 context 复用，丢掉的只有播放位置。
      let c = this.context ?? this.createContext();
      if (c.state === "closed") c = this.rebuildContext();
      // Call resume before awaiting network or an earlier suspension so the
      // browser observes this call in the user's activation handler.
      const resume = c.state === "running" ? Promise.resolve() : c.resume();
      // 超时保护见 RESUME_TIMEOUT_MS 的说明：宁可当作「这次没恢复成功」，
      // 也不能让 activation 链挂在一个永不 resolve 的 Promise 上。
      await Promise.race([
        Promise.all([this.suspension, resume]),
        new Promise<void>((done) => { setTimeout(done, RESUME_TIMEOUT_MS); }),
      ]);
      if (id !== this.requestId || this.disposed || document.hidden) return;
      if (c.state !== "running") return;
      if (id !== this.requestId || document.hidden || this.disposed) return;
      if (this.prefs.music) {
        await this.loadMusic(c);
        if (id === this.requestId) this.startMusic();
      }
    } catch (e) {
      this.error = describeAudioError(e);
      this.errorRetryable = isRetryableAudioFailure(e);
      console.warn("[audio] 激活失败：", e);
    }
  }
  /** 丢掉失效的音频设备，重建一套增益节点。 */
  private rebuildContext(): AudioContext {
    const dead = this.context;
    this.tracks = [];
    this.voices = [];
    this.suspension = Promise.resolve();
    try {
      void dead?.close();
    } catch {
      /* 已经关掉了 */
    }
    return this.createContext();
  }
  private loadMusic(c: AudioContext) {
    if (this.buffers) return Promise.resolve();
    this.loading ??= this.decodeMusic(c)
      .then((buffers) => {
        this.buffers = buffers;
        this.error = "";
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }
  /**
   * 解码背景音乐，失败时退回 mp3 单轨再试一次。
   *
   * 只看 `canPlayType('audio/ogg; codecs="vorbis"')` 是不够的：它只回答「这个容器
   * 名字认不认识」，Safari 在若干版本上会给出 `maybe` 却在真正 `decodeAudioData`
   * 时抛 EncodingError。那样用户只会看到一句「背景音乐无法播放」，而我方无从判断
   * 到底是格式不支持还是文件坏了。这里以**真实解码结果**为准 —— 顺带也覆盖了
   * 分段文件损坏、下载被截断等情况。
   */
  private async decodeMusic(c: AudioContext): Promise<AudioBuffer[]> {
    const fallbackOnly = this.stemFiles.length === 1;
    try {
      return await this.decodeTracks(c);
    } catch (error) {
      if (fallbackOnly) throw error;
      console.warn("[audio] Ogg 分轨解码失败，退回 mp3 单轨", error);
      // 换单轨：清掉分轨的下载与解码缓存，按新清单重新取一次。
      this.stems = [{ name: FALLBACK_STEM, file: `${FALLBACK_STEM}.mp3` }];
      this.musicData = undefined;
      this.fetching = undefined;
      return this.decodeTracks(c);
    }
  }
  private async decodeTracks(c: AudioContext) {
    const data = await this.prepareMusic();
    // 每段都传副本：`decodeAudioData` 会接管（detach）传入的 ArrayBuffer。
    return Promise.all(data.map((bytes) => c.decodeAudioData(bytes.slice(0))));
  }
  private startMusic() {
    const c = this.context;
    if (
      !c ||
      c.state !== "running" ||
      !this.buffers ||
      this.tracks.length ||
      !this.prefs.music ||
      this.disposed ||
      document.hidden
    )
      return;
    this.startedAt = c.currentTime + 0.04;
    this.tracks = this.buffers.map((buffer, i) => {
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = Math.min(LOOP_SECONDS, buffer.duration);
      src.connect(this.stemGains[i]);
      src.start(this.startedAt, this.offset % src.loopEnd);
      return src;
    });
    this.musicBus!.gain.cancelScheduledValues(c.currentTime);
    this.musicBus!.gain.setValueAtTime(0, c.currentTime);
    this.musicBus!.gain.linearRampToValueAtTime(
      this.prefs.musicVolume,
      c.currentTime + 1.2,
    );
  }
  private stopMusic() {
    const c = this.context;
    if (!c || !this.tracks.length) return;
    this.offset =
      (this.offset + Math.max(0, c.currentTime - this.startedAt)) %
      LOOP_SECONDS;
    this.tracks.forEach((track, i) => {
      const fade = c.createGain();
      track.disconnect();
      track.connect(fade);
      fade.connect(this.stemGains[i]);
      fade.gain.setValueAtTime(1, c.currentTime);
      fade.gain.linearRampToValueAtTime(0, c.currentTime + 0.06);
      track.stop(c.currentTime + 0.07);
      track.onended = () => {
        track.disconnect();
        fade.disconnect();
      };
    });
    this.tracks = [];
  }
  private stopEffects() {
    if (this.context)
      this.voices.forEach((v) => v.stop(this.context!.currentTime));
    this.voices = [];
    this.lastSound.clear();
  }
  setScene(scene: SoundScene) {
    if (this.scene === scene) return;
    this.scene = scene;
    this.bootTime = null;
    this.bootMix = -1;
    this.stopEffects();
    this.mixScene();
  }
  private mixScene() {
    if (!this.context) return;
    const table = {
      boot: [0.48, 0.32, 0.18],
      archive: [0.9, 0.72, 0.65],
      detail: [0.72, 0.36, 0.12],
      viewer: [0.8, 0.24, 0.28],
    }[this.scene];
    const gains = this.sceneLevels(table);
    this.stemGains.forEach((g, i) =>
      level(g.gain, gains[i] ?? 0, this.context!.currentTime, 1.1),
    );
  }
  /**
   * 单轨降级（旧 Safari 解不了 Ogg）时没有声部可配比，把该场景的配比压成
   * 一个总音量——取最响的那一轨，保持各场景之间的相对响度。
   */
  private sceneLevels(table: readonly number[]): number[] {
    // 单轨时（旧 Safari 解不了 Ogg，或运行期从 Ogg 退回 mp3）没有声部可配比，
    // 取表里最大的一档整轨放开。判断看实际轨数，而不是建 context 时的节点数 ——
    // 退回 mp3 发生在 stemGains 建好之后。
    const single = (this.buffers?.length ?? this.stemGains.length) === 1;
    return single ? [Math.max(...table)] : [...table];
  }
  play(type: Sound = "tick", pan = 0) {
    const c = this.context;
    if (
      !this.prefs.sound ||
      !c ||
      c.state !== "running" ||
      document.hidden ||
      this.disposed
    )
      return;
    const now = c.currentTime,
      interval =
        type === "key"
          ? 0.024
          : type === "tick" || type === "column"
            ? 0.055
            : 0.12;
    if (now - (this.lastSound.get(type) ?? -Infinity) < interval) return;
    this.lastSound.set(type, now);
    this.voices = this.voices.filter((v) => v.end > now);
    if (this.voices.length >= 10) this.voices.shift()!.stop(now);
    this.voices.push(synthesizeSound(c, this.effects!, type, now + 0.004, pan));
    if (type === "key") this.playedKeys++;
    if (
      ["open", "brand", "welcome", "array", "explode", "assemble"].includes(
        type,
      )
    ) {
      level(this.duck!.gain, 0.65, now, 0.035);
      this.duck!.gain.linearRampToValueAtTime(1, now + 0.9);
    }
  }
  updateBoot(appTime: number, frozen = false, label: string = LEGACY_LABEL) {
    const time = appTime + 5;
    const previous = this.bootTime;
    this.bootTime = time;
    const phase = time < 22.76 ? 0 : time < 26.92 ? 1 : time < 34.3 ? 2 : 3;
    if (phase !== this.bootMix && this.context) {
      this.bootMix = phase;
      const gains = this.sceneLevels([
        [0.48, 0.32, 0.18],
        [0.68, 0.55, 0.32],
        [0.9, 0.72, 0.65],
        [0.72, 0.36, 0.12],
      ][phase]);
      this.stemGains.forEach((g, i) =>
        level(g.gain, gains[i] ?? 0, this.context!.currentTime, 0.9),
      );
    }
    if (
      frozen ||
      previous === null ||
      time < previous ||
      time - previous > 0.3
    ) {
      this.stopEffects();
      return;
    }
    for (const cue of BOOT_CUES)
      if (cue.time > previous && cue.time <= time) this.play(cue.sound);
    if (hasTypingBetween(previous, time, label)) this.play("key");
  }
  stats() {
    return {
      state: this.context?.state ?? "locked",
      scene: this.scene,
      tracks: this.tracks.length,
      voices: this.voices.filter(
        (v) => v.end > (this.context?.currentTime ?? 0),
      ).length,
      loaded: !!this.buffers,
      playedKeys: this.playedKeys,
      error: this.error,
      retryable: this.errorRetryable,
      preferences: { ...this.prefs },
    };
  }
  dispose() {
    this.disposed = true;
    this.requestId++;
    this.stopMusic();
    this.stopEffects();
    document.removeEventListener("pointerdown", this.gesture, true);
    document.removeEventListener("keydown", this.gesture, true);
    document.removeEventListener("visibilitychange", this.visibility);
    window.removeEventListener("pagehide", this.hide);
    window.removeEventListener("pageshow", this.visibility);
    void this.context?.close();
  }
}
