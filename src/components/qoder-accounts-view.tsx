import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Pencil, RefreshCw, Terminal, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DemoAction } from "@/components/demo-action";
import { QoderMark } from "@/components/product-marks";
import * as api from "@/lib/api";
import type { QoderBundle, QoderStatus, QoderTarget, QoderTargetStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type Pending = { kind: "switch" | "delete"; bundle: QoderBundle };

const TARGETS: QoderTarget[] = ["desktop", "cli"];

function formatTime(ms?: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

function stateText(s: QoderTargetStatus | undefined): string {
  if (!s?.installed) return "未检测到";
  if (!s.loggedIn) return "未登录";
  return s.running ? "运行中" : "已接入";
}

function TargetMark({ target, size }: { target: QoderTarget; size: number }) {
  if (target === "desktop") return <QoderMark size={size} />;
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[22%] border border-white/10 bg-zinc-950 text-emerald-400 shadow-sm"
      style={{ width: size, height: size }}
    >
      <Terminal style={{ width: size * 0.56, height: size * 0.56 }} />
    </span>
  );
}

/** 页顶状态徽标：与 WorkBuddy / CodeBuddy 各端同一套样式（接入 = 品牌色描边，未接入 = 灰）。 */
function HeaderBadge({ status }: { status: QoderTargetStatus | undefined }) {
  const target = status?.target ?? "desktop";
  return (
    <span className="group relative inline-flex cursor-default">
      <span
        className={
          status?.loggedIn
            ? "inline-flex rounded-[22%] bg-primary p-[2px] shadow-sm shadow-primary/40"
            : "inline-flex rounded-[22%] bg-muted-foreground/30 p-[2px]"
        }
      >
        <TargetMark target={target} size={28} />
      </span>
      <span className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden whitespace-nowrap rounded-md bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg ring-1 ring-black/5 group-hover:block">
        {status?.label ?? (target === "desktop" ? "Qoder CN" : "Qoder CN CLI")}：{stateText(status)} · 当前账号：
        {status?.currentLabel ?? (status?.loggedIn ? "未认领" : "未登录")}
      </span>
    </span>
  );
}

interface CardProps {
  bundle: QoderBundle;
  active: boolean;
  /** 任一 Qoder 操作进行中：禁用全部按钮，防止并发切换。 */
  busy: boolean;
  switching: boolean;
  editing: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onSwitch: () => void;
  onDelete: () => void;
}

/** Qoder 账号卡片：外观与 WorkBuddy / CodeBuddy 账号卡片一致（圆角卡片、header 标识、footer 操作）。 */
function QoderAccountCard({ bundle, active, busy, switching, editing, draft, onDraftChange, onStartRename, onCommitRename, onCancelRename, onSwitch, onDelete }: CardProps) {
  const targetLabel = bundle.target === "desktop" ? "Qoder CN" : "Qoder CN CLI";
  return (
    <article
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,.025),0_10px_28px_rgba(15,23,42,.035)] transition-shadow hover:shadow-[0_2px_4px_rgba(15,23,42,.04),0_14px_34px_rgba(15,23,42,.055)]",
        active && "border-primary/50",
      )}
    >
      <header className={cn("flex items-center gap-3 border-b border-border px-5 py-4", active && "bg-primary/[0.06]")}>
        <TargetMark target={bundle.target} size={32} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              autoFocus
              aria-label="账号名称"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onBlur={onCommitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCommitRename();
                if (e.key === "Escape") onCancelRename();
              }}
              className="h-8"
            />
          ) : (
            <div className="truncate font-semibold" title={bundle.label}>
              {bundle.label}
            </div>
          )}
          <div className="truncate text-xs text-muted-foreground">
            {targetLabel}
            {bundle.echoName && bundle.echoName !== bundle.label ? ` · ${bundle.echoName}` : ""}
          </div>
        </div>
        {active && (
          <Badge variant="secondary" className="shrink-0 gap-1">
            <Check className="size-3" />
            当前
          </Badge>
        )}
      </header>
      <div className="flex-1 px-5 py-4 text-xs leading-5 text-muted-foreground">
        <div>认领于 {formatTime(bundle.capturedAt)}</div>
        <div>上次切换 {formatTime(bundle.lastSwitchedAt)}</div>
      </div>
      <footer className="flex items-center gap-2 border-t border-border px-5 py-3">
        <DemoAction>
          <Button size="sm" className="h-7 rounded-full px-3 text-xs" disabled={busy || active} onClick={onSwitch}>
            {switching && <Loader2 className="animate-spin" />}
            {active ? "使用中" : `切换到 ${targetLabel}`}
          </Button>
        </DemoAction>
        <div className="ml-auto flex items-center gap-1">
          <DemoAction>
            <Button size="icon" variant="ghost" className="size-7" aria-label={`重命名 ${bundle.label}`} disabled={busy} onClick={onStartRename}>
              <Pencil className="size-4" />
            </Button>
          </DemoAction>
          <DemoAction>
            <Button size="icon" variant="ghost" className="size-7" aria-label={`删除 ${bundle.label}`} disabled={busy} onClick={onDelete}>
              <Trash2 className="size-4" />
            </Button>
          </DemoAction>
        </div>
      </footer>
    </article>
  );
}

interface Props {
  compact?: boolean;
}

/**
 * Qoder 账号管理：与 WorkBuddy / CodeBuddy 账号页同一套版式（页顶徽标、添加账号面板、账号卡片网格）。
 *
 * Qoder 账号与 WorkBuddy / CodeBuddy 账号库不相通，这里的「账号」是账号包 —— 整组加密凭据文件的
 * 本机副本。认领 = 保存现场登录态；切换 = 备份现场后整组写回并校验。
 */
export function QoderAccountsView({ compact = false }: Props) {
  const [status, setStatus] = useState<QoderStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getQoderStatus());
      setLoadError(null);
    } catch (e) {
      setLoadError(api.asError(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run<T>(key: string, action: () => Promise<T>, onOk: (v: T) => void, failTitle: string) {
    setBusyKey(key);
    try {
      onOk(await action());
    } catch (e) {
      toast.error(failTitle, { description: api.asError(e) });
    } finally {
      setBusyKey(null);
      void refresh();
    }
  }

  function capture(target: QoderTarget) {
    void run(`capture:${target}`, () => api.captureQoderAccount(target), (b) => toast.success("已保存当前登录", { description: b.label }), "认领失败");
  }

  function doSwitch(bundle: QoderBundle) {
    void run(bundle.id, () => api.switchQoderAccount(bundle.id), (r) => {
      if (r.unchanged) {
        toast.info(r.message ?? "已是该账号");
        return;
      }
      const notes = [r.autoSavedId ? "原登录态已自动保存为账号" : null, r.relaunched ? "已重新打开 Qoder CN" : null, ...(r.warnings ?? [])].filter(Boolean);
      toast.success(`已切换到 ${bundle.label}`, { description: notes.join("；") || undefined });
    }, "切换失败");
  }

  function commitRename(bundle: QoderBundle) {
    const label = draft.trim();
    setEditingId(null);
    if (!label || label === bundle.label) return;
    void run(bundle.id, () => api.renameQoderAccount(bundle.id, label), () => {}, "重命名失败");
  }

  function targetStatus(target: QoderTarget) {
    return target === "desktop" ? status?.desktop : status?.cli;
  }

  /** 目标运行中才需要确认（会被关闭）；未运行直接切。 */
  function requestSwitch(bundle: QoderBundle) {
    if (targetStatus(bundle.target)?.running) setPending({ kind: "switch", bundle });
    else doSwitch(bundle);
  }

  const bundles = status?.bundles ?? [];
  const busy = busyKey !== null;

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-8 sm:px-8 sm:py-9">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold tracking-tight">Qoder 账号管理</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              管理 Qoder CN 桌面端与 Qoder CN CLI 账号，两端各自独立切换。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2.5 pt-1">
            <HeaderBadge status={status?.desktop} />
            <HeaderBadge status={status?.cli} />
          </div>
        </div>
      </header>

      <div className="relative mb-6 overflow-visible rounded-2xl border border-border bg-muted/30 px-5 py-5 shadow-[0_6px_20px_rgba(15,23,42,.025)]">
        <div className="relative flex flex-wrap items-center gap-x-5 gap-y-4">
          <div className="min-w-[190px] flex-1">
            <h2 className="text-sm font-semibold text-foreground">添加账号</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              在 Qoder 中登录后认领当前登录；换另一个账号登录再认领一次，即可一键切换。同一账号再次认领会刷新原账号。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {TARGETS.map((target) => {
              const s = targetStatus(target);
              const unclaimed = Boolean(s?.loggedIn && !s.currentId);
              return (
                <DemoAction key={target}>
                  <Button
                    variant={unclaimed ? "default" : "outline"}
                    className="h-10 px-4"
                    disabled={busy || !s?.loggedIn}
                    title={s?.loggedIn ? "把当前登录态保存为账号" : `请先在 ${s?.label ?? "Qoder"} 中登录`}
                    onClick={() => capture(target)}
                  >
                    {busyKey === `capture:${target}` ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    认领 {target === "desktop" ? "Qoder CN" : "CLI"} 登录
                  </Button>
                </DemoAction>
              );
            })}
          </div>
        </div>
      </div>

      {loadError && <p className="mb-4 text-sm text-destructive">读取 Qoder 状态失败：{loadError}</p>}

      <section className="mt-7 min-w-0" aria-labelledby="qoder-accounts-title">
        <div className="mb-4 flex items-center gap-2">
          <h2 id="qoder-accounts-title" className="text-base font-semibold tracking-tight">账号</h2>
          <Badge
            variant="secondary"
            className="h-6 min-w-6 rounded-full border-0 px-1.5 text-[11px] tabular-nums text-muted-foreground shadow-none"
            aria-label={`${bundles.length} 个 Qoder 账号`}
          >
            {bundles.length}
          </Badge>
        </div>
        {!status && !loadError ? (
          <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" />
            加载账号…
          </div>
        ) : bundles.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-16 text-center text-sm text-muted-foreground">
            <p>暂无 Qoder 账号。</p>
            <p className="mt-2 text-xs leading-5">
              在 Qoder CN 或 Qoder CN CLI 中登录后，点击上方「认领」保存；本机当前登录的账号也请认领，以便随时切回。
            </p>
          </div>
        ) : (
          <div className={cn("grid min-w-0 gap-5", compact ? "grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))]" : "grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))]")}>
            {bundles.map((bundle) => (
              <QoderAccountCard
                key={bundle.id}
                bundle={bundle}
                active={bundle.id === targetStatus(bundle.target)?.currentId}
                busy={busy}
                switching={busyKey === bundle.id}
                editing={editingId === bundle.id}
                draft={draft}
                onDraftChange={setDraft}
                onStartRename={() => {
                  setDraft(bundle.label);
                  setEditingId(bundle.id);
                }}
                onCommitRename={() => commitRename(bundle)}
                onCancelRename={() => setEditingId(null)}
                onSwitch={() => requestSwitch(bundle)}
                onDelete={() => setPending({ kind: "delete", bundle })}
              />
            ))}
          </div>
        )}
        <p className="mt-5 text-xs leading-5 text-muted-foreground">
          账号是本机加密凭据的副本，只能在本机当前系统用户下使用，不参与 WebDAV 同步；Qoder 的会话历史不按账号隔离，切换后不同账号会看到同一份本地历史。
        </p>
      </section>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "delete" ? `删除账号「${pending.bundle.label}」？` : `切换到「${pending?.bundle.label}」？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "delete"
                ? "只删除本工具保存的凭据副本，不影响 Qoder 当前登录。删除后需重新登录该账号并认领才能再切回。"
                : pending?.bundle.target === "cli"
                  ? "Qoder CN CLI 正在运行，切换会关闭它，当前 CLI 会话会中断且不会自动重开。"
                  : "Qoder CN 正在运行，切换时会先关闭它，写入完成后自动重新打开。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pending) return;
                const { kind, bundle } = pending;
                setPending(null);
                if (kind === "delete") {
                  void run(bundle.id, () => api.deleteQoderAccount(bundle.id), () => toast.success("账号已删除"), "删除失败");
                } else {
                  doSwitch(bundle);
                }
              }}
            >
              {pending?.kind === "delete" ? "删除" : "关闭并切换"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
