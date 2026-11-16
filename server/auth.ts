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

export async function makeSessionCookie(env: { APP_PASSWORD?: string; SESSION_SECRET?: string }) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE
  const sig = await hmac(secretOf(env), String(exp))
  return `${COOKIE}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export async function isAuthenticated(
  cookieHeader: string | null | undefined,
  env: { APP_PASSWORD?: string; SESSION_SECRET?: string },
): Promise<boolean> {
  if (!cookieHeader) return false
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))
  if (!m) return false
  const [exp, sig] = m[1].split('.')
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false
  const expected = await hmac(secretOf(env), exp)
  return timingSafeEqual(sig, expected)
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
