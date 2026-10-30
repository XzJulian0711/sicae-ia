"""Evalúa la regla de publicidad con correos .eml de las cuentas de prueba (paso 1.8).

Lee los .eml de:
  ml/data/eml/publicidad/  -> correos que SÍ son publicidad
  ml/data/eml/normal/      -> correos que NO son publicidad (personales, transaccionales)
y guarda en ml/reports/resultados_publicidad.json la precisión, el recall, la matriz de
confusión y cuántas veces se activó cada señal.

PRIVACIDAD: los .eml son correos reales y no se suben a Git (ver .gitignore). El JSON
guarda SOLO conteos: nunca asuntos, textos, direcciones ni nombres de archivo.

Uso (desde la raíz del proyecto):
    .venv\\Scripts\\python -m sicae_ml.evaluar_publicidad
"""

from collections import Counter
from pathlib import Path

from sicae_ml.publicidad import analizar_publicidad, leer_eml
from sicae_ml.train import guardar_json

CARPETA_ML = Path(__file__).resolve().parents[1]

CARPETA_EML = CARPETA_ML / "data" / "eml"
CARPETA_PUBLICIDAD = CARPETA_EML / "publicidad"
CARPETA_NORMAL = CARPETA_EML / "normal"
RUTA_RESULTADOS = CARPETA_ML / "reports" / "resultados_publicidad.json"


def listar_eml(carpeta):
    """Archivos .eml de una carpeta (sin distinguir mayúsculas), ordenados. [] si no existe."""
    carpeta = Path(carpeta)
    if not carpeta.is_dir():
        return []
    return sorted(p for p in carpeta.iterdir() if p.is_file() and p.suffix.lower() == ".eml")


def _dividir(a, b):
    return round(a / b, 4) if b else None


def evaluar_carpetas(carpeta_publicidad=CARPETA_PUBLICIDAD, carpeta_normal=CARPETA_NORMAL):
    """Aplica la regla a cada .eml y devuelve solo conteos. None si no hay ningún .eml.

    Clase positiva: publicidad. Un archivo que no se puede leer se cuenta en "no_leidos"
    (sin guardar su nombre).
    """
    archivos = {"publicidad": listar_eml(carpeta_publicidad), "normal": listar_eml(carpeta_normal)}
    if not archivos["publicidad"] and not archivos["normal"]:
        return None

    predichos = {"publicidad": Counter(), "normal": Counter()}  # real -> {predicho: n}
    senales = {"publicidad": Counter(), "normal": Counter()}
    no_leidos = Counter()
    for real, rutas in archivos.items():
        for ruta in rutas:
            try:
                cabeceras, asunto, cuerpo = leer_eml(ruta)
            except Exception:  # archivo dañado: se cuenta, no se detiene la evaluación
                no_leidos[real] += 1
                continue
            resultado = analizar_publicidad(cabeceras, asunto, cuerpo)
            predicho = "publicidad" if resultado["es_publicidad"] else "normal"
            predichos[real][predicho] += 1
            senales[real].update(resultado["motivos"])

    vp = predichos["publicidad"]["publicidad"]  # publicidad detectada
    fn = predichos["publicidad"]["normal"]  # publicidad que pasó como normal
    fp = predichos["normal"]["publicidad"]  # normal marcado como publicidad
    vn = predichos["normal"]["normal"]
    return {
        "correos": {clase: len(rutas) for clase, rutas in archivos.items()},
        "no_leidos": {clase: no_leidos[clase] for clase in archivos},
        "precision": _dividir(vp, vp + fp),
        "recall": _dividir(vp, vp + fn),
        "matriz_confusion": {
            "orden": ["normal", "publicidad"],
            "filas_real_columnas_predicho": [[vn, fp], [fn, vp]],
        },
        "senales_activadas": {clase: dict(sorted(c.items())) for clase, c in senales.items()},
    }


def main(carpeta_publicidad=CARPETA_PUBLICIDAD, carpeta_normal=CARPETA_NORMAL, ruta=RUTA_RESULTADOS):
    resultados = evaluar_carpetas(carpeta_publicidad, carpeta_normal)
    if resultados is None:
        print("No hay correos .eml para evaluar la regla de publicidad.")
        print(f"  Copie correos exportados de las cuentas de prueba en:\n"
              f"    {carpeta_publicidad}  (publicidad)\n    {carpeta_normal}  (no publicidad)")
        print("  Esas carpetas no se suben a Git.")
        return None

    for clase, n in resultados["correos"].items():
        if n == 0:
            print(f"Aviso: la carpeta '{clase}' está vacía; precisión o recall pueden quedar en None.")
    print(f"Correos: {resultados['correos']}  (no leídos: {resultados['no_leidos']})")
    print(f"Precisión: {resultados['precision']}  Recall: {resultados['recall']}")
    print(f"Matriz (filas real, columnas predicho, orden normal/publicidad): "
          f"{resultados['matriz_confusion']['filas_real_columnas_predicho']}")
    print(f"Señales activadas: {resultados['senales_activadas']}")
    guardar_json(resultados, ruta)
    print(f"Guardado en {ruta} (solo conteos, sin contenido de los correos)")
    return resultados


if __name__ == "__main__":
    main()
