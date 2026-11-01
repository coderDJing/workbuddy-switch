export const UPDATE_CHECK_TIMEOUT_MS = 15_000;

export class UpdateCheckTimeoutError extends Error {
  constructor() {
    super("更新检查超过 15 秒仍未完成，请稍后重试或打开发布页。");
    this.name = "UpdateCheckTimeoutError";
  }
}

/** Bound the UI wait even if the native IPC response never arrives. */
export async function waitForUpdateCheck<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new UpdateCheckTimeoutError()), UPDATE_CHECK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
