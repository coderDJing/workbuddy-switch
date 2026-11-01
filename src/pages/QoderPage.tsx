import { QoderAccountsView } from "@/components/qoder-accounts-view";

/** Qoder 平台的「账号管理」：与 WorkBuddy / CodeBuddy 账号页平级。卡片疏密沿用账号页的紧凑偏好。 */
export default function QoderPage() {
  let compact = true;
  try {
    compact = localStorage.getItem("wb-switch.compact") !== "0";
  } catch {
    /* 读取失败沿用默认紧凑模式 */
  }
  return <QoderAccountsView compact={compact} />;
}
