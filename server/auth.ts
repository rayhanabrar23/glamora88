// Login sederhana dengan satu kata sandi bersama (APP_PASSWORD).
// Sesi disimpan di cookie bertanda tangan HMAC, berlaku 30 hari.
const COOKIE = 'g88_session'
const MAX_AGE = 60 * 60 * 24 * 30

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function secretOf(env: { APP_PASSWORD?: string; SESSION_SECRET?: string }) {
  return env.SESSION_SECRET || `g88:${env.APP_PASSWORD ?? ''}`
}

/**
 * Sesi menyimpan id pengguna: 0 = kata sandi tim bersama, -1 = owner (masuk dengan OWNER_PASSWORD),
 * angka positif = akun di tabel users.
 */
export async function makeSessionCookie(env: { APP_PASSWORD?: string; SESSION_SECRET?: string }, uid = 0) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE
  const sig = await hmac(secretOf(env), `${exp}.${uid}`)
  return `${COOKIE}=${exp}.${uid}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

/** Mengembalikan id pengguna dari cookie sesi, atau null bila tidak sah. */
export async function sessionUid(cookieHeader: string | null | undefined, env: { APP_PASSWORD?: string; SESSION_SECRET?: string }): Promise<number | null> {
  if (!cookieHeader) return null
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))
  if (!m) return null
  const parts = m[1].split('.')
  const exp = parts[0]
  if (!exp || Number(exp) < Date.now() / 1000) return null
  if (parts.length === 2) {
    // format lama (sebelum ada akun): dianggap sesi tim bersama
    return timingSafeEqual(parts[1], await hmac(secretOf(env), exp)) ? 0 : null
  }
  const [, uid, sig] = parts
  if (!/^-?\d+$/.test(uid ?? '') || !sig) return null
  return timingSafeEqual(sig, await hmac(secretOf(env), `${exp}.${uid}`)) ? Number(uid) : null
}

export async function isAuthenticated(cookieHeader: string | null | undefined, env: { APP_PASSWORD?: string; SESSION_SECRET?: string }): Promise<boolean> {
  return (await sessionUid(cookieHeader, env)) != null
}

// ---------- Kata sandi akun: PBKDF2-SHA256 ----------
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))
const ITER = 100000
export async function hashPassword(password: string, saltB64?: string) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256)
  return { hash: b64(new Uint8Array(bits)), salt: b64(salt) }
}
export async function verifyPassword(password: string, hash: string, salt: string) {
  const h = await hashPassword(password, salt)
  return timingSafeEqual(h.hash, hash)
}

export function checkPassword(input: string, env: { APP_PASSWORD?: string }) {
  return !!env.APP_PASSWORD && timingSafeEqual(input, env.APP_PASSWORD)
}

// ---------- Kunci owner: kata sandi terpisah (OWNER_PASSWORD), sesi 8 jam ----------
const OWNER_COOKIE = 'g88_owner'
const OWNER_MAX_AGE = 60 * 60 * 8
type OwnerEnv = { APP_PASSWORD?: string; SESSION_SECRET?: string; OWNER_PASSWORD?: string }
const ownerSecret = (env: OwnerEnv) => `${secretOf(env)}:owner:${env.OWNER_PASSWORD ?? ''}`

export async function makeOwnerCookie(env: OwnerEnv) {
  const exp = Math.floor(Date.now() / 1000) + OWNER_MAX_AGE
  const sig = await hmac(ownerSecret(env), `owner.${exp}`)
  return `${OWNER_COOKIE}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${OWNER_MAX_AGE}`
}
export function clearOwnerCookie() {
  return `${OWNER_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}
export async function isOwner(cookieHeader: string | null | undefined, env: OwnerEnv): Promise<boolean> {
  if (!env.OWNER_PASSWORD || !cookieHeader) return false
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${OWNER_COOKIE}=([^;]+)`))
  if (!m) return false
  const [exp, sig] = m[1].split('.')
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false
  return timingSafeEqual(sig, await hmac(ownerSecret(env), `owner.${exp}`))
}
export function checkOwnerPassword(input: string, env: OwnerEnv) {
  return !!env.OWNER_PASSWORD && timingSafeEqual(input, env.OWNER_PASSWORD)
}
