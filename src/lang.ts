export function isChinese(): boolean {
  try {
    const lang = (window as unknown as { siyuan?: { config?: { lang?: string } } }).siyuan?.config
      ?.lang;
    return Boolean(lang?.toLowerCase().startsWith("zh"));
  } catch {
    return false;
  }
}
