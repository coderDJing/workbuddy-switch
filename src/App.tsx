import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { BrowserRouter, HashRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { ArrowUp, Loader2, Play, Settings } from "lucide-react";

import { cn } from "@/lib/utils";
import * as api from "@/lib/api";
import AccountsPage from "@/pages/AccountsPage";
import SessionsPage from "@/pages/SessionsPage";
import CreditStatsPage from "@/pages/CreditStatsPage";
import TokenStatsPage from "@/pages/TokenStatsPage";
import SettingsPage, { CodebuddySettingsPage } from "@/pages/SettingsPage";
import QoderPage from "@/pages/QoderPage";
import { StatusDot } from "@/components/product-marks";
import { CompanionDemoDialog } from "@/components/companion-demo-dialog";
import { UpdateInstallDialog } from "@/components/update-install-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import companionTrayIcon from "@/assets/agent-companion-tray.png";
import { DEMO_UNAVAILABLE_MESSAGE, demoModeEnabled, pagesDemoHostingEnabled } from "@/lib/demo-mode";
import { useSessionsNavEnabled } from "@/lib/nav-prefs";
import { findPlatform, platformPath, readLastPlatform, rememberPlatform, useEnabledPlatforms, type PlatformId, type PlatformPageKey } from "@/lib/platforms";
import { PlatformNav, PlatformRail } from "@/components/platform-sidebar";
import { changeCompanionEnabled, useCompanionEnabled } from "@/lib/use-companion-enabled";
import { useCreditAutoRefresh } from "@/lib/use-credit-auto-refresh";
import { useRotateDeferredNotice } from "@/lib/use-rotate-deferred-notice";
import { useUpdateState } from "@/lib/use-update-state";
import { useWorkbuddyStatusRefresh } from "@/lib/use-workbuddy-status-refresh";
import { useAccountsStore } from "@/stores/accounts";

/**
 * 悬浮窗面板：从 footer 向上滑出，开关与设置同屏。
 *
 * footer 只保留一个「图标位」——点图标弹面板，而不是并排第二个按钮：
 * 开关与设置都在面板里，关掉悬浮窗时也不必留一个灰掉的死图标。
 * 面板关闭后进入设置的常驻路径仍是：设置页 → Agent Companion → 悬浮窗设置。
 */
const COMPANION_MENU_CONTENT = { side: "top", align: "start", sideOffset: 8, className: "w-56" } as const;

function CompanionFooter() {
  const { enabled, busy } = useCompanionEnabled();
  /** 面板打开时收起 hover tooltip——两者都朝上弹，同时出现会叠在一起。 */
  const [menuOpen, setMenuOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);

  async function onToggle() {
    if (enabled === null) return;
    try {
      const confirmed = await changeCompanionEnabled(!enabled);
      toast.success(confirmed ? "已启用 Agent Companion 悬浮窗" : "已关闭 Agent Companion 悬浮窗");
    } catch (cause) {
      toast.error("悬浮窗设置失败", { description: api.asError(cause) });
    }
  }

  async function openSettings() {
    try {
      await api.openCompanionSettings();
    } catch (cause) {
      toast.error("打开悬浮窗设置失败", { description: api.asError(cause) });
    }
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <Tooltip open={tipOpen && !menuOpen} onOpenChange={setTipOpen}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 rounded-lg" aria-label="会话悬浮窗" disabled={enabled === null || busy}>
              <img src={companionTrayIcon} alt="" className={cn("size-6 object-contain transition-all", !enabled && "grayscale opacity-55")} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">会话悬浮窗</TooltipContent>
      </Tooltip>
      <DropdownMenuContent {...COMPANION_MENU_CONTENT}>
        {/* 整行即开关（方向键 / Enter 同语义）；行尾 Switch 只作视觉，点击穿透到行上，避免出现两个焦点。 */}
        <DropdownMenuItem
          className="gap-3"
          disabled={enabled === null || busy}
          onSelect={(event) => {
            // 面板保持打开：切换是异步的，让用户看到开关落定。
            event.preventDefault();
            void onToggle();
          }}
        >
          <span className="min-w-0 flex-1">会话悬浮窗</span>
          <Switch checked={Boolean(enabled)} tabIndex={-1} aria-hidden className="pointer-events-none" />
        </DropdownMenuItem>
        <p className="px-2.5 pb-1 text-xs leading-4 text-muted-foreground">
          {enabled ? "关闭后悬浮栏将隐藏，并停止 wb-switch 中的会话监听。" : "开启后会显示悬浮栏，并开始监听会话状态。"}
        </p>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={enabled === null || busy || !enabled} onSelect={() => void openSettings()}>
          <Settings />悬浮窗设置
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 演示模式的悬浮窗入口：与桌面正式版同形（一个图标位 + 向上弹出的面板），
 * 但面板里的开关与设置只提示「演示不可用」，不触发任何本机命令；
 * 多一条「查看悬浮栏演示」，打开只读演示浮层。
 */
function CompanionDemoFooter() {
  const [open, setOpen] = useState(false);
  /** 面板打开时收起 hover tooltip，与正式版同一处理。 */
  const [menuOpen, setMenuOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);

  /** 演示面板里的行：保持可聚焦（键盘也能走一遍），但只说明不可用。 */
  function unavailable(event: Event) {
    event.preventDefault();
    toast.info(DEMO_UNAVAILABLE_MESSAGE);
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <Tooltip open={tipOpen && !menuOpen} onOpenChange={setTipOpen}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 rounded-lg" aria-label="会话悬浮窗">
              <img src={companionTrayIcon} alt="" className="size-6 object-contain" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">会话悬浮窗</TooltipContent>
      </Tooltip>
      <DropdownMenuContent {...COMPANION_MENU_CONTENT}>
        <DropdownMenuItem className="gap-3" onSelect={unavailable}>
          <span className="min-w-0 flex-1">会话悬浮窗</span>
          <Switch checked tabIndex={-1} aria-hidden className="pointer-events-none" />
        </DropdownMenuItem>
        <p className="px-2.5 pb-1 text-xs leading-4 text-muted-foreground">关闭后悬浮栏将隐藏，并停止 wb-switch 中的会话监听。</p>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={unavailable}>
          <Settings />悬浮窗设置
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setOpen(true)}>
          <Play />查看悬浮栏演示
        </DropdownMenuItem>
      </DropdownMenuContent>
      <CompanionDemoDialog open={open} onOpenChange={setOpen} />
    </DropdownMenu>
  );
}

function UpdateCenter({ running }: { running: boolean | undefined }) {
  const version = useAccountsStore((s) => s.status?.version);
  const snapshot = useUpdateState();
  const [dialogOpen, setDialogOpen] = useState(false);
  const showCompanion = api.isDesktop() && !demoModeEnabled;
  // 演示模式只提供只读演示浮层，不渲染正式版的悬浮窗开关。
  const showCompanionDemo = demoModeEnabled;

  // 阶段由 Rust 更新服务经 `update-state` 推送（托盘同源），前端不再轮询检查。
  // 已知目标版本时，检查中 / 失败也要保留入口，与托盘「升级到 vX / 点击重试」对齐。
  const hasKnownTarget = Boolean(snapshot.latest);
  const hasUpdate =
    snapshot.phase === "available" ||
    snapshot.phase === "downloading" ||
    snapshot.phase === "readyToRestart" ||
    (hasKnownTarget && (snapshot.phase === "error" || snapshot.phase === "checking"));
  const updateHint =
    snapshot.phase === "downloading"
      ? snapshot.percent === null
        ? "正在下载更新…"
        : `正在下载更新 ${snapshot.percent}%`
      : snapshot.phase === "readyToRestart"
        ? "重启以完成升级"
        : snapshot.phase === "error"
          ? "更新失败，点击重试"
          : snapshot.phase === "checking"
            ? "正在检查…"
            : "更新";

  return (
    <>
      <section className="mt-auto border-t border-sidebar-border px-2 pt-3 text-xs">
        <div className="flex items-center gap-2 text-[13px] text-sidebar-foreground">
          {showCompanion ? <CompanionFooter /> : showCompanionDemo ? <CompanionDemoFooter /> : (
            <>
              <StatusDot on={Boolean(running)} />
              <span className="min-w-0 flex-1 truncate">WorkBuddy</span>
            </>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <span className="text-sidebar-foreground/50">v{version || "?"}</span>
            {hasUpdate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    className="size-5 rounded-full p-0"
                    aria-label={updateHint}
                    onClick={() => setDialogOpen(true)}
                  >
                    {snapshot.phase === "downloading" || snapshot.phase === "checking" ? (
                      <Loader2 className="size-3 animate-spin" strokeWidth={2.5} aria-hidden="true" />
                    ) : (
                      <ArrowUp className="size-3" strokeWidth={2.5} aria-hidden="true" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{updateHint}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </section>
      <UpdateInstallDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

function Layout() {
  const running = useAccountsStore((s) => s.status?.running);
  const hasUnifiedTitleBar =
    api.isDesktop() && typeof navigator !== "undefined" && navigator.userAgent.includes("Macintosh");
  const sessionsNavEnabled = useSessionsNavEnabled();
  const platforms = useEnabledPlatforms();
  const { pathname } = useLocation();
  const onSettings = pathname.startsWith("/settings");
  /** 平台页取路径里的平台；在全局设置页时沿用上次所在平台的导航。 */
  const routePlatform = findPlatform(pathname.match(/^\/p\/([^/]+)/)?.[1]);
  const activePlatform =
    platforms.find((p) => p.id === routePlatform?.id) ??
    platforms.find((p) => p.id === readLastPlatform()) ??
    platforms[0];
  const topPadding = hasUnifiedTitleBar ? "pt-20" : "pt-4";
  useCreditAutoRefresh();
  useWorkbuddyStatusRefresh();
  useRotateDeferredNotice();

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-background">
      {hasUnifiedTitleBar ? (
        <div
          data-tauri-drag-region
          className="fixed inset-x-0 top-0 z-50 h-8"
          aria-hidden="true"
        />
      ) : null}
      <PlatformRail
        platforms={platforms}
        activePlatform={activePlatform.id}
        onSettings={onSettings}
        running={{ codebuddy: Boolean(running) }}
        topPadding={topPadding}
      />
      <PlatformNav
        platform={activePlatform}
        sessionsNavEnabled={sessionsNavEnabled}
        demoMode={demoModeEnabled}
        topPadding={topPadding}
        footer={api.isWebui() && !demoModeEnabled ? null : <UpdateCenter running={running} />}
      />
      <main
        className={cn(
          "min-w-0 flex-1 overflow-y-auto bg-background overscroll-contain",
          hasUnifiedTitleBar && "pt-16 [&>div]:pt-4",
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}

/** 各平台各页面的实现。注册表声明页面存在，这里给出组件；两边要对得上。 */
const PLATFORM_PAGES: Record<PlatformId, Partial<Record<PlatformPageKey, ReactNode>>> = {
  codebuddy: {
    accounts: <AccountsPage />,
    sessions: <SessionsPage />,
    "token-stats": <TokenStatsPage />,
    "credit-stats": <CreditStatsPage />,
    settings: <CodebuddySettingsPage />,
  },
  qoder: { accounts: <QoderPage /> },
};

/** 进入应用时落到上次所在的平台（已关闭则取第一个启用的平台）。 */
function HomeRedirect() {
  const platforms = useEnabledPlatforms();
  const last = readLastPlatform();
  const target = platforms.find((p) => p.id === last) ?? platforms[0];
  return <Navigate to={platformPath(target.id)} replace />;
}

/**
 * `/p/:platform/:page`：平台未启用或不支持该页面时回到首页（含旧书签与手改地址）。
 * 合法时记下当前平台，供下次启动与全局设置页沿用。
 */
function PlatformRoute() {
  const { platform, page } = useParams();
  const enabled = useEnabledPlatforms();
  const def = enabled.find((p) => p.id === platform);
  const pageDef = def?.pages.find((p) => p.key === page);
  const element = def && pageDef ? PLATFORM_PAGES[def.id][pageDef.key] : undefined;
  useEffect(() => {
    if (def && element) rememberPlatform(def.id);
  }, [def, element]);
  // 平台有效但没有该页面（`/p/qoder`、`/p/qoder/settings`）：进该平台首页，而不是跳到别的平台。
  if (def && !element) return <Navigate to={platformPath(def.id)} replace />;
  if (!def) return <HomeRedirect />;
  return <>{element}</>;
}

export default function App() {
  const Router = pagesDemoHostingEnabled ? HashRouter : BrowserRouter;

  return (
    <TooltipProvider delayDuration={250}>
      <Router>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/p/:platform" element={<PlatformRoute />} />
            <Route path="/p/:platform/:page" element={<PlatformRoute />} />
            {/* 旧版顶层路径：这些页面原本只属于 WorkBuddy / CodeBuddy。 */}
            <Route path="/sessions" element={<Navigate to={platformPath("codebuddy", "sessions")} replace />} />
            <Route path="/credit-stats" element={<Navigate to={platformPath("codebuddy", "credit-stats")} replace />} />
            <Route path="/token-stats" element={<Navigate to={platformPath("codebuddy", "token-stats")} replace />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<HomeRedirect />} />
          </Route>
        </Routes>
        <Toaster />
      </Router>
    </TooltipProvider>
  );
}
