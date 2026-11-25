// Długość tekstu tak, jak liczy ją backend (Python, Pydantic): w znakach Unicode, nie w jednostkach UTF-16.
// Emoji i inne znaki spoza BMP mają w JS `.length` równe 2, więc limit „200 znaków” odrzucałby tytuł,
// który backend przyjmie.
export function charCount(text: string): number {
  return Array.from(text).length
}
