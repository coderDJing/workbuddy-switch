import { useState } from "react";
import { Check, Loader2, Pencil, RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QoderMark } from "@/components/product-marks";
import type { QoderBundle, QoderTargetStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatTime(ms?: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

function statusText(s: QoderTargetStatus): string {
  if (!s.installed) return "未检测到";
  if (!s.loggedIn) return "未登录";
  return s.running ? "运行中" : "已退出";
}

interface Props {
  status: QoderTargetStatus;
  bundles: QoderBundle[];
  /** 正在执行的操作对应的账号包 id（或 `capture:<target>`），用于禁用并发操作。 */
  busyKey: string | null;
  onCapture: () => void;
  onSwitch: (bundle: QoderBundle) => void;
  onRename: (bundle: QoderBundle, label: string) => void;
  onDelete: (bundle: QoderBundle) => void;
}

/** 一个切换目标（桌面端或 CLI）的现场状态与账号包列表。 */
export function QoderTargetSection({ status, bundles, busyKey, onCapture, onSwitch, onRename, onDelete }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const busy = busyKey !== null;
  const captureBusy = busyKey === `capture:${status.target}`;
  // 现场已登录但没对上任何账号包：提示认领，否则切走后回不来。
  const unclaimed = status.loggedIn && !status.currentId;

  function commitRename(bundle: QoderBundle) {
    const label = draft.trim();
    setEditingId(null);
    if (label && label !== bundle.label) onRename(bundle, label);
  }

  return (
    <section className="space-y-3" aria-label={status.label}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <QoderMark size={28} />
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{status.label}</h2>
            <p className="text-xs text-muted-foreground">
              {statusText(status)} · 当前账号：
              {status.currentLabel ?? (status.loggedIn ? "未认领" : "—")}
              {status.echoName && status.currentLabel !== status.echoName ? `（${status.echoName}）` : ""}
            </p>
          </div>
        </div>
        <Button
          variant={unclaimed ? "default" : "outline"}
          size="sm"
          disabled={busy || !status.loggedIn}
          onClick={onCapture}
          title={status.loggedIn ? "把当前登录态保存为账号包" : `请先在 ${status.label} 中登录`}
        >
          {captureBusy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {unclaimed ? "认领当前登录" : "刷新当前登录"}
        </Button>
      </div>

      {bundles.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            还没有保存的账号。在 {status.label} 中登录后点「认领当前登录」；
            换另一个账号登录后再认领一次，即可在两者之间一键切换。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {bundles.map((bundle) => {
            const active = bundle.id === status.currentId;
            const switching = busyKey === bundle.id;
            return (
              <Card key={bundle.id} className={cn(active && "border-emerald-500/50")}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    {editingId === bundle.id ? (
                      <Input
                        autoFocus
                        aria-label="账号名称"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => commitRename(bundle)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(bundle);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="h-8"
                      />
                    ) : (
                      <div className="min-w-0">
                        <div className="truncate font-medium" title={bundle.label}>
                          {bundle.label}
                        </div>
                        {bundle.echoName && bundle.echoName !== bundle.label && (
                          <div className="truncate text-xs text-muted-foreground">{bundle.echoName}</div>
                        )}
                      </div>
                    )}
                    {active && (
                      <Badge variant="secondary" className="shrink-0 gap-1">
                        <Check className="size-3" />
                        当前
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs leading-5 text-muted-foreground">
                    <div>保存于 {formatTime(bundle.capturedAt)}</div>
                    <div>上次切换 {formatTime(bundle.lastSwitchedAt)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" disabled={busy || active} onClick={() => onSwitch(bundle)}>
                      {switching && <Loader2 className="size-4 animate-spin" />}
                      {active ? "使用中" : "切换"}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`重命名 ${bundle.label}`}
                      disabled={busy}
                      onClick={() => {
                        setDraft(bundle.label);
                        setEditingId(bundle.id);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`删除 ${bundle.label}`}
                      disabled={busy}
                      onClick={() => onDelete(bundle)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
