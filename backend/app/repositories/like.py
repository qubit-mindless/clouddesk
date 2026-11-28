LIKE_ESCAPE = "\\"


def escape_like(value: str) -> str:
    """Tekst do wzorca LIKE/ILIKE dosłownie: %, _ i \\ nie działają jak symbole wieloznaczne.

    Wzorzec trzeba użyć z `escape=LIKE_ESCAPE`.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
