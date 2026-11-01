import type { LucideIcon } from "lucide-react";
import { Link2, MessagesSquare, SlidersHorizontal, Sparkles, User } from "lucide-react";

import { useSupportedTools, type ToolId } from "./supported-tools";

/**
 * 平台注册表：侧栏平台栏、平台导航与路由都由这里生成。
 *
 * 平台按产品线命名，彼此平级、账号库互不相通。新增平台（如 Trae）= 在这里加一条
 * + 一个后端模块；页面里不要写 `platform === "xxx"` 判断能力，改这里的 `pages`。
 */
export type PlatformId = "codebuddy" | "qoder";

/** 平台内的页面。同一个 key 在不同平台由各自的页面组件实现。 */
export type PlatformPageKey = "accounts" | "sessions" | "token-stats" | "credit-stats" | "settings";

export interface PlatformPageDef {
  key: PlatformPageKey;
  label: string;
  icon: LucideIcon;
}

export interface PlatformDef {
  id: PlatformId;
  /** 平台栏 tooltip 与平台导航标题。 */
  label: string;
  /** 该平台是否启用：任一关联的「支持工具」开着即启用。 */
  tools: ToolId[];
  /** 该平台支持的页面，按导航顺序；第一项是平台首页。 */
  pages: PlatformPageDef[];
}

const ACCOUNTS: PlatformPageDef = { key: "accounts", label: "账号管理", icon: User };

export const PLATFORMS: PlatformDef[] = [
  {
    id: "codebuddy",
    label: "WorkBuddy / CodeBuddy",
    tools: ["workbuddy", "codebuddyIde", "codebuddyCli", "vscodeExt", "jetbrains"],
    pages: [
      ACCOUNTS,
      { key: "sessions", label: "关联会话", icon: Link2 },
      { key: "token-stats", label: "Token 统计", icon: MessagesSquare },
      { key: "credit-stats", label: "积分统计", icon: Sparkles },
      { key: "settings", label: "平台设置", icon: SlidersHorizontal },
    ],
  },
  {
    id: "qoder",
    label: "Qoder",
    tools: ["qoder"],
    pages: [ACCOUNTS],
  },
];

export function platformPath(platform: PlatformId, page: PlatformPageKey = "accounts"): string {
  return `/p/${platform}/${page}`;
}

export function findPlatform(id: string | undefined): PlatformDef | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

/** 已启用的平台，按注册顺序。全部关掉时仍保留第一个，避免界面无处可去。 */
export function useEnabledPlatforms(): PlatformDef[] {
  const tools = useSupportedTools();
  const enabled = PLATFORMS.filter((p) => p.tools.some((t) => tools[t]));
  return enabled.length > 0 ? enabled : PLATFORMS.slice(0, 1);
}

const LAST_PLATFORM_KEY = "wb-switch.platform";
/** 上一版「腾讯系 / Qoder」两段式切换的存储键，读到时迁移。 */
const LEGACY_VENDOR_KEY = "wb-switch.vendor";

export function readLastPlatform(): PlatformId | undefined {
  try {
    const stored = localStorage.getItem(LAST_PLATFORM_KEY);
    if (findPlatform(stored ?? undefined)) return stored as PlatformId;
    if (localStorage.getItem(LEGACY_VENDOR_KEY) === "qoder") return "qoder";
  } catch {
    /* 读不到就用默认平台 */
  }
  return undefined;
}

export function rememberPlatform(id: PlatformId): void {
  try {
    localStorage.setItem(LAST_PLATFORM_KEY, id);
    localStorage.removeItem(LEGACY_VENDOR_KEY);
  } catch {
    /* 隐私模式下写入失败：只影响下次启动落在哪个平台 */
  }
}
