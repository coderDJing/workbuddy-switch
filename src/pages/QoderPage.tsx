import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

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
import { QoderTargetSection } from "@/components/qoder-target-section";
import * as api from "@/lib/api";
import type { QoderBundle, QoderStatus, QoderTarget } from "@/lib/types";

type Pending = { kind: "switch" | "delete"; bundle: QoderBundle };

/**
 * Qoder CN 桌面端 / CLI 账号切换页。
 *
 * Qoder 账号与 WorkBuddy 账号库不相通：这里管理的是「账号包」—— 整组加密凭据
 * 文件的本机副本。认领 = 保存现场登录态；切换 = 备份现场后整组写回并校验。
 */
export default function QoderPage() {
  const [status, setStatus] = useState<QoderStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

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
      const notes = [r.autoSavedId ? "原登录态已自动保存为账号包" : null, r.relaunched ? "已重新打开 Qoder CN" : null, ...(r.warnings ?? [])].filter(Boolean);
      toast.success(`已切换到 ${bundle.label}`, { description: notes.join("；") || undefined });
    }, "切换失败");
  }

  function doDelete(bundle: QoderBundle) {
    void run(bundle.id, () => api.deleteQoderAccount(bundle.id), () => toast.success("账号包已删除"), "删除失败");
  }

  function rename(bundle: QoderBundle, label: string) {
    void run(bundle.id, () => api.renameQoderAccount(bundle.id, label), () => {}, "重命名失败");
  }

  /** 目标运行中才需要确认（会被关闭）；未运行直接切。 */
  function requestSwitch(bundle: QoderBundle) {
    const target = bundle.target === "desktop" ? status?.desktop : status?.cli;
    if (target?.running) setPending({ kind: "switch", bundle });
    else doSwitch(bundle);
  }

  const pendingTarget = pending?.bundle.target === "cli" ? status?.cli : status?.desktop;

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-8 sm:px-8 sm:py-9">
      <header className="mb-6">
        <h1 className="text-[28px] font-semibold tracking-tight">Qoder</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Qoder CN 桌面端与 Qoder CN CLI 的账号各自独立切换。账号包是本机加密凭据的副本，只能在本机当前系统用户下使用，不参与 WebDAV 同步；Qoder 的会话历史不按账号隔离，切换后不同账号会看到同一份本地历史。
        </p>
      </header>

      {loadError && <p className="mb-4 text-sm text-destructive">读取 Qoder 状态失败：{loadError}</p>}
      {status && (
        <div className="space-y-8">
          {(["desktop", "cli"] as const).map((target) => (
            <QoderTargetSection
              key={target}
              status={status[target]}
              bundles={status.bundles.filter((b) => b.target === target)}
              busyKey={busyKey}
              onCapture={() => capture(target)}
              onSwitch={requestSwitch}
              onRename={rename}
              onDelete={(bundle) => setPending({ kind: "delete", bundle })}
            />
          ))}
        </div>
      )}

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "delete" ? `删除账号包「${pending.bundle.label}」？` : `切换到「${pending?.bundle.label}」？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "delete"
                ? "只删除本工具保存的凭据副本，不影响 Qoder 当前登录。删除后需重新登录该账号并认领才能再切回。"
                : pending?.bundle.target === "cli"
                  ? "Qoder CN CLI 正在运行，切换会关闭它，当前 CLI 会话会中断且不会自动重开。"
                  : `${pendingTarget?.label ?? "Qoder CN"} 正在运行，切换时会先关闭它，写入完成后自动重新打开。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pending) return;
                if (pending.kind === "delete") doDelete(pending.bundle);
                else doSwitch(pending.bundle);
                setPending(null);
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
