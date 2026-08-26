const numerals: Record<string, string> = { '〇':'0','一':'1','二':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9' }

export function normalizeJapanese(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s\u3000・]/g, '').replace(/[〇一二三四五六七八九](?=丁目)/g, (char) => numerals[char] ?? char).replace(/^r(?=\d)/, '').replace(/^国道(?=\d)/, '').replace(/号$/, '')
}
