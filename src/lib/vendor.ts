import { useEffect, useState } from "react";

import { useSupportedTools } from "./supported-tools";

/**
 * 厂商：腾讯系（WorkBuddy / CodeBuddy 各端共用一个账号库）与 Qoder（独立账号包）平级。
 *
 * 切换放在侧栏最顶层：关联会话、Token 统计、积分统计都只有腾讯系的数据源，
 * 选 Qoder 时侧栏只保留 Qoder 能用的入口。持久化在 localStorage，
 * 与 `supported-tools.ts` 同风格；设置里关闭 Qoder 时一律视为腾讯系。
 */
export type Vendor = "tencent" | "qoder";

const STORAGE_KEY = "wb-switch.vendor";
const CHANGED_EVENT = "wb-switch:vendor-changed";

function readStored(): Vendor {
  try {
    return localStorage.getItem(STORAGE_KEY) === "qoder" ? "qoder" : "tencent";
  } catch {
    return "tencent";
  }
}

export function setVendor(vendor: Vendor): void {
  try {
    localStorage.setItem(STORAGE_KEY, vendor);
  } catch {
    /* 隐私模式等场景下写入失败：本次会话内仍生效（由事件驱动） */
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** 当前生效的厂商；同一标签页内切换后各处立即同步。 */
export function useVendor(): Vendor {
  const qoderEnabled = useSupportedTools().qoder;
  const [stored, setStored] = useState<Vendor>(readStored);
  useEffect(() => {
    const sync = () => setStored(readStored());
    window.addEventListener("storage", sync);
    window.addEventListener(CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(CHANGED_EVENT, sync);
    };
  }, []);
  return qoderEnabled ? stored : "tencent";
}
