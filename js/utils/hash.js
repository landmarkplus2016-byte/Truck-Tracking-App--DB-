/**
 * hash.js — SHA-256 for the admin password (CLAUDE.md §4). Same bytes as sha256Hex_
 * in apps-script/Admin.gs: the UTF-8 text, lowercase hex. The password is hashed
 * exactly as typed — never trimmed — on both sides.
 */

export async function sha256Hex(text) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  // WebCrypto only exists in a secure context: https:// or localhost.
  if (!subtle) throw Object.assign(new Error('WebCrypto is unavailable'), { code: 'hash_unavailable' });
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
