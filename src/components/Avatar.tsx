import { cx } from './ui'

export const initialsOf = (name: string) =>
  name
    .replace(/[^\p{L}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

/** Foto profil bulat; tanpa foto tampil inisial nama. */
export function Avatar({ name, photo, size = 32, className }: { name: string; photo?: string | null; size?: number; className?: string }) {
  return photo ? (
    <img src={photo} alt={`Foto ${name}`} width={size} height={size} className={cx('shrink-0 rounded-full object-cover', className)} style={{ width: size, height: size }} />
  ) : (
    <span
      className={cx('flex shrink-0 items-center justify-center rounded-full bg-navy font-semibold text-white', className)}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  )
}

/** Memotong gambar jadi persegi di tengah lalu mengecilkan ke 256 px (JPEG), supaya ringan disimpan. */
export async function squarePhoto(file: File, px = 256): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pilih file gambar (JPG, PNG, atau sejenisnya)')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('Gambar tidak bisa dibaca'))
      i.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = px
    canvas.height = px
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, px, px)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}
