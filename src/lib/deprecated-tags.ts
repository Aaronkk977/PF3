/** 已停用、不再顯示或建議的標籤名稱 */
export const DEPRECATED_TAG_NAMES = ["long-term", "momentum"] as const;

export function isDeprecatedTag(name: string): boolean {
  return (DEPRECATED_TAG_NAMES as readonly string[]).includes(name);
}

export function withoutDeprecatedTags(names: string[]): string[] {
  return names.filter((n) => !isDeprecatedTag(n));
}
