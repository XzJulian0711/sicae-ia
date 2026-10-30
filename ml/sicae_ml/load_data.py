"""Carga y limpieza de SpaPhish.

Pasos:
  1. Leer el CSV crudo (comas + UTF-8 con BOM, aunque el README diga ';').
  2. Verificar que esté completo: 1.395 filas, 731 phishing y 664 legítimos.
  3. Quedarse solo con las columnas que usa el modelo y ponerles nombre en español.
  4. Quitar filas sin asunto o con cuerpo de menos de 30 caracteres.
  5. Guardar ml/data/processed/correos.csv.

Uso (desde la raíz del proyecto):
    .venv\\Scripts\\python -m sicae_ml.load_data
"""

from pathlib import Path

import pandas as pd

# Rutas calculadas desde este archivo, así el script funciona desde cualquier carpeta.
CARPETA_ML = Path(__file__).resolve().parents[1]
RUTA_CRUDO = CARPETA_ML / "data" / "raw" / "spaphish" / "Spaphish dataset - DiB.csv"
RUTA_SALIDA = CARPETA_ML / "data" / "processed" / "correos.csv"

# Conteos que publica el README de SpaPhish.
TOTAL_ESPERADO = 1395
PHISHING_ESPERADO = 731
LEGITIMO_ESPERADO = 664

# Columna original -> nombre nuevo. "date" y las de persuasión quedan fuera a propósito.
COLUMNAS = {
    "subject": "asunto",
    "body": "cuerpo",
    "urls": "urls",
    "url_count": "n_urls",
    "attachments_count": "n_adjuntos",
    "Label": "etiqueta",
}

# En SpaPhish, Label 1 = phishing y Label 0 = legítimo.
ETIQUETAS = {1: "phishing", 0: "legitimo"}

# Un cuerpo más corto que esto casi no tiene texto del que aprender.
MIN_CUERPO = 30


def cargar_spaphish(ruta=RUTA_CRUDO):
    """Lee el CSV crudo. 'utf-8-sig' quita el BOM para que la primera columna se llame bien."""
    return pd.read_csv(ruta, sep=",", encoding="utf-8-sig")


def verificar_conteos(df, total=TOTAL_ESPERADO, phishing=PHISHING_ESPERADO, legitimo=LEGITIMO_ESPERADO):
    """Lanza ValueError si el archivo no tiene las filas y clases esperadas."""
    real_total = len(df)
    real_phishing = int((df["Label"] == 1).sum())
    real_legitimo = int((df["Label"] == 0).sum())
    if (real_total, real_phishing, real_legitimo) != (total, phishing, legitimo):
        raise ValueError(
            f"SpaPhish no coincide: hay {real_total} filas "
            f"({real_phishing} phishing, {real_legitimo} legitimos), "
            f"se esperaban {total} ({phishing} phishing, {legitimo} legitimos)."
        )


def seleccionar_y_renombrar(df):
    """Deja solo las 6 columnas útiles, en español, y la etiqueta como texto."""
    nuevo = df[list(COLUMNAS)].rename(columns=COLUMNAS)
    nuevo["etiqueta"] = nuevo["etiqueta"].map(ETIQUETAS)
    if nuevo["etiqueta"].isna().any():
        raise ValueError("Hay valores de Label distintos de 0 y 1.")
    # Un correo sin enlaces trae 'urls' vacía: la dejamos como texto vacío, no como nulo.
    nuevo["urls"] = nuevo["urls"].fillna("")
    return nuevo


def filtrar_filas(df, min_cuerpo=MIN_CUERPO):
    """Quita filas sin asunto o con cuerpo corto.

    Devuelve (df_limpio, n_sin_asunto, n_cuerpo_corto). Una fila sin asunto se
    cuenta solo como "sin asunto", aunque su cuerpo también sea corto.
    """
    asunto = df["asunto"].fillna("").astype(str).str.strip()
    cuerpo = df["cuerpo"].fillna("").astype(str).str.strip()

    sin_asunto = asunto == ""
    cuerpo_corto = (cuerpo.str.len() < min_cuerpo) & ~sin_asunto

    limpio = df[~(sin_asunto | cuerpo_corto)].reset_index(drop=True)
    return limpio, int(sin_asunto.sum()), int(cuerpo_corto.sum())


def guardar(df, ruta=RUTA_SALIDA):
    """Escribe el CSV limpio con el mismo formato del original (comas + utf-8-sig)."""
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(ruta, sep=",", encoding="utf-8-sig", index=False)


def main():
    crudo = cargar_spaphish()
    print(f"1) Cargadas {len(crudo)} filas de {RUTA_CRUDO.name}")

    verificar_conteos(crudo)
    print(f"   Verificado: {PHISHING_ESPERADO} phishing y {LEGITIMO_ESPERADO} legitimos")

    correos = seleccionar_y_renombrar(crudo)
    print(f"2) Columnas: {', '.join(correos.columns)}")

    correos, n_sin_asunto, n_cuerpo_corto = filtrar_filas(correos)
    print(
        f"3) Quitadas {n_sin_asunto + n_cuerpo_corto} filas "
        f"({n_sin_asunto} sin asunto, {n_cuerpo_corto} con cuerpo < {MIN_CUERPO} caracteres)"
    )
    conteo = correos["etiqueta"].value_counts()
    print(
        f"   Quedan {len(correos)} filas: "
        f"{conteo.get('phishing', 0)} phishing y {conteo.get('legitimo', 0)} legitimos"
    )

    guardar(correos)
    print(f"4) Guardado en {RUTA_SALIDA}")


if __name__ == "__main__":
    main()
