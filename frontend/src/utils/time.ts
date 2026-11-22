// Czas względny po polsku („5 min temu”, „2 h temu”, „3 d temu”) – dokładna data idzie do `title`/`dateTime`.
export function timeAgo(iso: string, now: number = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'przed chwilą'
  if (minutes < 60) return `${minutes} min temu`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h temu`
  return `${Math.round(hours / 24)} d temu`
}

// Pora dnia do powitania („Dzień dobry” / „Dobry wieczór”).
export function greeting(date: Date = new Date()): string {
  const hour = date.getHours()
  return hour >= 18 || hour < 5 ? 'Dobry wieczór' : 'Dzień dobry'
}
