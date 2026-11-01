import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { Settings } from "lucide-react";

import { AppIconMark, QoderMark, WorkBuddyMark } from "@/components/product-marks";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { platformPath, type PlatformDef, type PlatformId } from "@/lib/platforms";
import { cn } from "@/lib/utils";

/** 平台栏图标：按产品线取产品图标。 */
export function PlatformMark({ id, size }: { id: PlatformId; size: number }) {
  return id === "qoder" ? <QoderMark size={size} /> : <WorkBuddyMark size={size} />;
}

const railItemClass = (active: boolean) =>
  cn(
    "relative flex size-10 items-center justify-center rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring/50",
    active ? "bg-foreground/[0.08]" : "opacity-70 hover:bg-foreground/[0.05] hover:opacity-100",
  );

/** 激活指示：平台栏左缘的竖条。 */
function ActiveBar({ show }: { show: boolean }) {
  if (!show) return null;
  return <span aria-hidden className="absolute -left-2 top-2 h-6 w-1 rounded-r-full bg-primary" />;
}

interface RailProps {
  platforms: PlatformDef[];
  /** 当前所在平台；在全局设置页时为上次所在平台（不高亮）。 */
  activePlatform: PlatformId;
  onSettings: boolean;
  /** 各平台客户端是否在运行；缺省不画状态点。 */
  running: Partial<Record<PlatformId, boolean>>;
  topPadding: string;
}

/** 最左侧平台栏：应用标识、各平台图标（带运行状态点）、底部全局设置。 */
export function PlatformRail({ platforms, activePlatform, onSettings, running, topPadding }: RailProps) {
  return (
    <nav
      aria-label="平台"
      className={cn("flex w-14 shrink-0 flex-col items-center gap-1.5 border-r border-sidebar-border bg-sidebar pb-4", topPadding)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="mb-3 inline-flex">
            <AppIconMark size={32} className="drop-shadow-sm" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">WorkBuddy Switch Next</TooltipContent>
      </Tooltip>
      {platforms.map((p) => {
        const active = !onSettings && p.id === activePlatform;
        const isRunning = running[p.id];
        return (
          <Tooltip key={p.id}>
            <TooltipTrigger asChild>
              <Link to={platformPath(p.id)} aria-label={p.label} aria-current={active ? "page" : undefined} className={railItemClass(active)}>
                <ActiveBar show={active} />
                <PlatformMark id={p.id} size={28} />
                {isRunning !== undefined && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute bottom-1 right-1 size-2.5 rounded-full ring-2 ring-sidebar",
                      isRunning ? "bg-emerald-500" : "bg-muted-foreground/40",
                    )}
                  />
                )}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">
              {p.label}
              {isRunning !== undefined ? `：${isRunning ? "运行中" : "未运行"}` : ""}
            </TooltipContent>
          </Tooltip>
        );
      })}
      <div className="mt-auto">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link to="/settings" aria-label="设置" aria-current={onSettings ? "page" : undefined} className={railItemClass(onSettings)}>
              <ActiveBar show={onSettings} />
              <Settings className="size-5 text-sidebar-foreground" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">设置</TooltipContent>
        </Tooltip>
      </div>
    </nav>
  );
}

interface NavProps {
  platform: PlatformDef;
  /** 用户在设置里隐藏「关联会话」时为 false。 */
  sessionsNavEnabled: boolean;
  demoMode: boolean;
  topPadding: string;
  /** 底部区域（版本与更新、悬浮窗开关）。 */
  footer: ReactNode;
}

/** 平台导航：只列出当前平台支持的页面。 */
export function PlatformNav({ platform, sessionsNavEnabled, demoMode, topPadding, footer }: NavProps) {
  const pages = platform.pages.filter((page) => page.key !== "sessions" || sessionsNavEnabled);
  return (
    <aside className={cn("flex min-h-0 w-[200px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 pb-4", topPadding)}>
      <div className="px-2 pb-5 pt-1.5">
        <div
          className="text-[15px] leading-5 tracking-[-0.02em] text-sidebar-foreground/90 [overflow-wrap:anywhere]"
          style={{ fontFamily: '"Bricolage Grotesque Variable", "SF Pro Display", ui-sans-serif, sans-serif', fontWeight: 640 }}
          title={platform.label}
        >
          {platform.label}
        </div>
        {demoMode && (
          <Badge variant="secondary" className="mt-1 h-5 border-0 px-1.5 text-[10px] text-sidebar-foreground/60 shadow-none">
            演示模式
          </Badge>
        )}
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5" aria-label={`${platform.label} 导航`}>
        {pages.map((page) => (
          <NavLink
            key={page.key}
            to={platformPath(platform.id, page.key)}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring/50",
                isActive
                  ? "bg-foreground/[0.06] font-medium text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
              )
            }
          >
            <page.icon className="size-4" />
            {page.label}
          </NavLink>
        ))}
      </nav>
      {footer}
    </aside>
  );
}
