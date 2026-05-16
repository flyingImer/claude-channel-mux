export function safeWorktreeSlug(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-').slice(0, 80) || 'session'
}
