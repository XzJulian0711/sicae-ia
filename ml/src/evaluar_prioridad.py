"""Evalúa la regla de prioridad contra etiquetas de dos evaluadores (paso 1.6).

Entradas (fuera de Git, en ml/data/eml/):
  normal/                    -> correos .eml legítimos de las cuentas de prueba
  etiquetas_prioridad.csv    -> columnas archivo, evaluador_1, evaluador_2
                                (alta / media / baja; utf-8, separado por comas)

Calcula:
  1. Acuerdo entre evaluadores con la kappa de Cohen (acuerdo más allá del azar).
  2. Etiqueta de consenso: solo los correos donde los dos evaluadores coinciden.
  3. Exactitud y matriz de confusión de la regla contra el consenso.

PRIVACIDAD: ml/reports/resultados_prioridad.json guarda SOLO conteos: nunca nombres de
archivo, asuntos, direcciones ni texto de los correos.

Uso (desde la raíz del proyecto):
    .venv\\Scripts\\python ml/src/evaluar_prioridad.py
"""

import math
import sys
from collections import Counter
from pathlib import Path

import pandas as pd
from sklearn.metrics import cohen_kappa_score, confusion_matrix

CARPETA_ML = Path(__file__).resolve().parents[1]
if str(CARPETA_ML) not in sys.path:
    sys.path.insert(0, str(CARPETA_ML))

from src.evaluar_publicidad import CARPETA_NORMAL, listar_eml  # noqa: E402
from src.priority import (  # noqa: E402
    NOMBRE_CONFIG_LOCAL,
    PRIORIDADES,
    asignar_prioridad,
    cargar_config,
    ruta_config,
)
from src.publicidad import analizar_publicidad, leer_eml  # noqa: E402
from src.train import guardar_json  # noqa: E402

RUTA_ETIQUETAS = CARPETA_ML / "data" / "eml" / "etiquetas_prioridad.csv"
RUTA_RESULTADOS = CARPETA_ML / "reports" / "resultados_prioridad.json"
COLUMNAS = ["archivo", "evaluador_1", "evaluador_2"]


def _normalizar(etiqueta):
    """' Alta ' -> 'alta'. Devuelve None si no es alta, media ni baja."""
    texto = str(etiqueta).strip().lower() if isinstance(etiqueta, str) else ""
    return texto if texto in PRIORIDADES else None


def evaluar(ruta_csv=RUTA_ETIQUETAS, carpeta=CARPETA_NORMAL, config=None):
    """Kappa entre evaluadores y exactitud de la regla contra el consenso. Solo conteos.

    Devuelve None si no existe el CSV de etiquetas o no hay ningún .eml en la carpeta.
    """
    ruta_csv = Path(ruta_csv)
    if not ruta_csv.is_file() or not listar_eml(carpeta):
        return None
    if config is None:
        ruta_usada = ruta_config()
        config = cargar_config(ruta_usada)
        tipo_config = "local" if ruta_usada.name == NOMBRE_CONFIG_LOCAL else "repositorio"
    else:
        tipo_config = "proporcionada"  # se pasó desde el código (por ejemplo, en pruebas)

    etiquetas = pd.read_csv(ruta_csv, sep=",", encoding="utf-8-sig", dtype=str)
    faltan = set(COLUMNAS) - set(etiquetas.columns)
    assert not faltan, f"Al CSV de etiquetas le faltan columnas: {sorted(faltan)}"
    e1 = etiquetas["evaluador_1"].map(_normalizar)
    e2 = etiquetas["evaluador_2"].map(_normalizar)
    validas = e1.notna() & e2.notna()

    # 1. Acuerdo entre evaluadores.
    kappa = None
    if validas.any():
        valor = cohen_kappa_score(e1[validas], e2[validas], labels=PRIORIDADES)
        kappa = None if math.isnan(valor) else round(float(valor), 4)
    acuerdo = validas & (e1 == e2)

    # 2 y 3. Regla contra el consenso.
    archivos = {p.name: p for p in listar_eml(carpeta)}
    reales, predichos = [], []
    motivos = Counter()
    sin_archivo = no_leidos = marcados_publicidad = 0
    for nombre, consenso in zip(etiquetas.loc[acuerdo, "archivo"], e1[acuerdo]):
        ruta = archivos.get(str(nombre).strip())
        if ruta is None:
            sin_archivo += 1
            continue
        try:
            cabeceras, asunto, cuerpo = leer_eml(ruta)
        except Exception:  # archivo dañado: se cuenta y se sigue
            no_leidos += 1
            continue
        # Se mide la regla de prioridad sola; aparte se cuenta cuántos marcaría publicidad.
        if analizar_publicidad(cabeceras, asunto, cuerpo)["es_publicidad"]:
            marcados_publicidad += 1
        resultado = asignar_prioridad(cabeceras, asunto, cuerpo, config)
        reales.append(consenso)
        predichos.append(resultado["prioridad"])
        motivos.update(resultado["motivos"])

    aciertos = sum(r == p for r, p in zip(reales, predichos))
    matriz = (
        confusion_matrix(reales, predichos, labels=PRIORIDADES).tolist()
        if reales else [[0] * 3 for _ in range(3)]
    )
    return {
        # Solo QUÉ archivo de configuración se usó, nunca su contenido (remitentes reales).
        "configuracion": tipo_config,
        "etiquetas": {
            "filas": int(len(etiquetas)),
            "validas": int(validas.sum()),
            "invalidas": int((~validas).sum()),
            "acuerdos": int(acuerdo.sum()),
            "desacuerdos": int((validas & (e1 != e2)).sum()),
        },
        "kappa_cohen": kappa,
        "consenso_por_clase": {p: int((e1[acuerdo] == p).sum()) for p in PRIORIDADES},
        "evaluados": len(reales),
        "sin_archivo": sin_archivo,
        "no_leidos": no_leidos,
        "marcados_publicidad": marcados_publicidad,
        "exactitud": round(aciertos / len(reales), 4) if reales else None,
        "matriz_confusion": {"orden": PRIORIDADES, "filas_real_columnas_predicho": matriz},
        "motivos_activados": dict(sorted(motivos.items())),
    }


def main(ruta_csv=RUTA_ETIQUETAS, carpeta=CARPETA_NORMAL, ruta=RUTA_RESULTADOS, config=None):
    resultados = evaluar(ruta_csv, carpeta, config)
    if resultados is None:
        print("No hay datos para evaluar la prioridad.")
        print(f"  Se necesitan los dos:\n"
              f"    {carpeta}  (correos .eml legítimos)\n"
              f"    {ruta_csv}  (columnas archivo, evaluador_1, evaluador_2)")
        print("  Cada evaluador etiqueta los mismos correos como alta, media o baja, sin ver "
              "las etiquetas del otro. Esos archivos no se suben a Git.")
        return None

    print(f"Configuración usada: {resultados['configuracion']}")
    print(f"Etiquetas: {resultados['etiquetas']}")
    print(f"Kappa de Cohen: {resultados['kappa_cohen']}")
    print(f"Consenso por clase: {resultados['consenso_por_clase']}  "
          f"(evaluados: {resultados['evaluados']}, sin archivo: {resultados['sin_archivo']})")
    print(f"Exactitud de la regla contra el consenso: {resultados['exactitud']}")
    print(f"Matriz (filas consenso, columnas regla, orden {PRIORIDADES}): "
          f"{resultados['matriz_confusion']['filas_real_columnas_predicho']}")
    guardar_json(resultados, ruta)
    print(f"Guardado en {ruta} (solo conteos, sin contenido de los correos)")
    return resultados


if __name__ == "__main__":
    main()
