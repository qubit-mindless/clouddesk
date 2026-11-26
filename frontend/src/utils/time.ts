export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}

const shortDate = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
// Wpis z innego roku dostaje rok – inaczej zeszłoroczny „20 lis” wyglądałby jak świeży.
const shortDateWithYear = new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

// Czas względny po polsku: „przed chwilą”, „5 min temu”, „3 h temu”, „2 d temu”, a starsze niż tydzień – data.
// Pełne jednostki w dół (25 h = „1 d temu”), żeby ta sama chwila wszędzie wyglądała tak samo.
// Dokładna data idzie do `title`/`dateTime`.
export function timeAgo(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return '—'
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'przed chwilą'
  if (minutes < 60) return `${minutes} min temu`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h temu`
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / 1440)} d temu`
  const date = new Date(at)
  return (date.getFullYear() === new Date(now).getFullYear() ? shortDate : shortDateWithYear).format(date)
}

// Pora dnia do powitania („Dzień dobry” / „Dobry wieczór”).
export function greeting(date: Date = new Date()): string {
  const hour = date.getHours()
  return hour >= 18 || hour < 5 ? 'Dobry wieczór' : 'Dzień dobry'
}

// Polska odmiana liczebnika: 1 zgłoszenie, 2–4 zgłoszenia, 5+ zgłoszeń (12–14 też „zgłoszeń”).
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one
  const d = n % 10
  const t = n % 100
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many
}
