"""Resumen de la comparación de modelos de redacción (paso 6.4).

Une las calificaciones (hechas A CIEGAS, por código) con clave.csv y produce, por sistema:
  - mediana de segundos en frío y en caliente (Gemini es remoto: frío/caliente no aplica);
  - % que cumple la indicación, % con el tono correcto y % con dato inventado (calificación humana);
  - % con "posible dato inventado", en español y con una sola versión (revisión automática);
  - calidad media ± desviación estándar (muestral);
  - acuerdo entre los 2 evaluadores: kappa ponderado de Cohen (cuadrático, calidad 1 a 5), con el
    scikit-learn que ya usa el proyecto.

Salida (SÍ se sube a Git): evaluacion/redaccion/reportes/redaccion.json y redaccion.md.
El reporte tiene SOLO números: nunca el texto de los casos, de los borradores ni los comentarios.

Correr desde la raíz:
    python herramientas/resumir_redaccion.py --calificaciones evaluacion/redaccion/resultados/calificacion_A.csv \
        evaluacion/redaccion/resultados/calificacion_B.csv
"""

import argparse
import csv
import json
import math
import statistics
import sys
from datetime import date
from pathlib import Path

from sklearn.metrics import cohen_kappa_score

RAIZ = Path(__file__).resolve().parents[1]
CLAVE_POR_DEFECTO = RAIZ / "evaluacion" / "redaccion" / "resultados" / "clave.csv"
SALIDA_POR_DEFECTO = RAIZ / "evaluacion" / "redaccion" / "reportes"
CALIDADES = [1, 2, 3, 4, 5]
SI_NO = {"si": True, "no": False}


class CalificacionInvalida(Exception):
    """Una calificación no cumple el formato (si/no, 1 a 5, código conocido, sin repetir)."""


def _leer_csv(ruta):
    with open(ruta, encoding="utf-8-sig", newline="") as archivo:
        return [{(k or "").strip(): (v or "").strip() for k, v in fila.items()} for fila in csv.DictReader(archivo)]


def leer_clave(ruta):
    """clave.csv → {codigo: fila}."""
    return {fila["codigo"]: fila for fila in _leer_csv(ruta)}


def leer_calificaciones(rutas, clave):
    """Lee y valida las calificaciones. Ignora las filas sin calificar (todo vacío)."""
    calificaciones, vistas = [], set()
    for ruta in rutas:
        for numero, fila in enumerate(_leer_csv(ruta), start=2):
            lugar = f"{Path(ruta).name}, fila {numero}"
            campos = ("cumple_indicacion", "tono_correcto", "dato_inventado", "calidad_1a5")
            if not any(fila.get(c) for c in campos):
                continue  # todavía sin calificar
            codigo, evaluador = fila.get("codigo", ""), fila.get("evaluador", "")
            if codigo not in clave:
                raise CalificacionInvalida(f"{lugar}: el código {codigo or '?'} no está en la clave.")
            if not evaluador:
                raise CalificacionInvalida(f"{lugar}: falta el evaluador.")
            if (codigo, evaluador) in vistas:
                raise CalificacionInvalida(f"{lugar}: el evaluador {evaluador} ya calificó {codigo}.")
            vistas.add((codigo, evaluador))
            valores = {}
            for campo in ("cumple_indicacion", "tono_correcto", "dato_inventado"):
                valor = fila.get(campo, "").lower()
                if valor not in SI_NO:
                    raise CalificacionInvalida(f"{lugar}: {campo} debe ser «si» o «no».")
                valores[campo] = SI_NO[valor]
            try:
                calidad = int(fila.get("calidad_1a5", ""))
            except ValueError:
                calidad = None
            if calidad not in CALIDADES:
                raise CalificacionInvalida(f"{lugar}: calidad_1a5 debe ser un número entero de 1 a 5.")
            # El comentario NO se guarda: no va al reporte.
            calificaciones.append({"codigo": codigo, "evaluador": evaluador, "calidad": calidad, **valores})
    return calificaciones


# ----- Estadística (lógica pura) -----


def mediana(valores):
    valores = [v for v in valores if v is not None]
    return round(statistics.median(valores), 2) if valores else None


def porcentaje(verdaderos, total):
    return round(100 * verdaderos / total, 1) if total else None


def media_desviacion(valores):
    """(media, desviación estándar muestral). Con un solo valor, la desviación es None."""
    if not valores:
        return None, None
    media = statistics.fmean(valores)
    desviacion = statistics.stdev(valores) if len(valores) > 1 else None
    return round(media, 2), (round(desviacion, 2) if desviacion is not None else None)


def kappa_ponderado(calificaciones, evaluadores):
    """Kappa ponderado de Cohen (cuadrático, calidad 1 a 5) entre 2 evaluadores, sobre los códigos
    que calificaron los dos. → (kappa o None, cantidad de pares)."""
    if len(evaluadores) != 2:
        return None, 0
    a, b = evaluadores
    de_a = {c["codigo"]: c["calidad"] for c in calificaciones if c["evaluador"] == a}
    de_b = {c["codigo"]: c["calidad"] for c in calificaciones if c["evaluador"] == b}
    comunes = sorted(set(de_a) & set(de_b))
    if len(comunes) < 2:
        return None, len(comunes)
    kappa = cohen_kappa_score([de_a[c] for c in comunes], [de_b[c] for c in comunes],
                              labels=CALIDADES, weights="quadratic")
    if kappa is None or (isinstance(kappa, float) and math.isnan(kappa)):
        return None, len(comunes)
    return round(float(kappa), 3), len(comunes)


def _numero(texto):
    try:
        return float(texto)
    except (TypeError, ValueError):
        return None


def resumir(clave, calificaciones):
    """El resumen por sistema y el global (solo números)."""
    evaluadores = sorted({c["evaluador"] for c in calificaciones})
    avisos = []
    if len(evaluadores) != 2:
        avisos.append(f"Hay {len(evaluadores)} evaluadores (se esperaban 2): no se calcula el kappa.")

    sistemas = {}
    for nombre in sorted({fila["sistema"] for fila in clave.values()}):
        filas = [f for f in clave.values() if f["sistema"] == nombre]
        exitosas = [f for f in filas if f["exitoso"] == "si"]
        remoto = any(f["proveedor"] == "demostracion" for f in filas)
        de_este = [c for c in calificaciones if clave[c["codigo"]]["sistema"] == nombre]
        media, desviacion = media_desviacion([c["calidad"] for c in de_este])
        kappa, pares = kappa_ponderado(de_este, evaluadores)
        sistemas[nombre] = {
            "proveedor": "demostracion" if remoto else "ollama",
            "borradores": len(filas),
            "fallidos": len(filas) - len(exitosas),
            # Gemini es remoto: frío/caliente no aplica (se informa el tiempo de respuesta).
            "segundos_frio_mediana": None if remoto else mediana(
                [_numero(f["segundos_frio"]) for f in filas if f["frio_confirmado"] == "si"]),
            "segundos_caliente_mediana": None if remoto else mediana([_numero(f["segundos_caliente"]) for f in filas]),
            "segundos_respuesta_mediana": mediana([_numero(f["segundos_caliente"]) for f in filas]) if remoto else None,
            "calificaciones": len(de_este),
            "cumple_indicacion_pct": porcentaje(sum(c["cumple_indicacion"] for c in de_este), len(de_este)),
            "tono_correcto_pct": porcentaje(sum(c["tono_correcto"] for c in de_este), len(de_este)),
            "dato_inventado_pct": porcentaje(sum(c["dato_inventado"] for c in de_este), len(de_este)),
            "posible_dato_inventado_auto_pct": porcentaje(sum(bool(f["posible_dato_inventado"]) for f in exitosas), len(exitosas)),
            "espanol_auto_pct": porcentaje(sum(f["espanol"] == "si" for f in exitosas), len(exitosas)),
            "una_version_auto_pct": porcentaje(sum(f["una_version"] == "si" for f in exitosas), len(exitosas)),
            "calidad_media": media,
            "calidad_desviacion": desviacion,
            "kappa_ponderado_calidad": kappa,
            "pares_para_kappa": pares,
        }
    kappa_global, pares_global = kappa_ponderado(calificaciones, evaluadores)
    return {
        "generado": date.today().isoformat(),
        "evaluadores": len(evaluadores),
        "calificaciones": len(calificaciones),
        "kappa_ponderado_global": kappa_global,
        "pares_para_kappa_global": pares_global,
        "sistemas": sistemas,
        "avisos": avisos,
    }


def _f(valor, sufijo=""):
    if valor is None:
        return "—"
    return f"{valor}{sufijo}".replace(".", ",")


def tabla_md(resumen):
    """Tabla en Markdown para la tesis (solo números)."""
    lineas = [
        "# Comparación de modelos de redacción (paso 6.4)",
        "",
        f"Generado: {resumen['generado']} · evaluadores: {resumen['evaluadores']} · calificaciones: "
        f"{resumen['calificaciones']} · kappa ponderado global (calidad): {_f(resumen['kappa_ponderado_global'])}",
        "",
        "| Sistema | Frío (mediana) | Caliente (mediana) | Cumple indicación | Tono correcto | Dato inventado "
        "(humano) | Posible dato inventado (auto) | Calidad (media ± DE) | Kappa ponderado |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for nombre, s in resumen["sistemas"].items():
        if s["proveedor"] == "demostracion":
            frio = "no aplica"
            caliente = f"no aplica ({_f(s['segundos_respuesta_mediana'], ' s')} de respuesta)"
        else:
            frio, caliente = _f(s["segundos_frio_mediana"], " s"), _f(s["segundos_caliente_mediana"], " s")
        calidad = "—" if s["calidad_media"] is None else (
            f"{_f(s['calidad_media'])} ± {_f(s['calidad_desviacion'])}")
        lineas.append(f"| {nombre} | {frio} | {caliente} | {_f(s['cumple_indicacion_pct'], ' %')} | "
                      f"{_f(s['tono_correcto_pct'], ' %')} | {_f(s['dato_inventado_pct'], ' %')} | "
                      f"{_f(s['posible_dato_inventado_auto_pct'], ' %')} | {calidad} | "
                      f"{_f(s['kappa_ponderado_calidad'])} |")
    lineas += ["", "Kappa ponderado de Cohen, cuadrático, sobre la calidad de 1 a 5. Ver docs/metricas.md (paso 6.4)."]
    if resumen["avisos"]:
        lineas += ["", *[f"- Aviso: {a}" for a in resumen["avisos"]]]
    return "\n".join(lineas) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Resume la comparación de modelos de redacción (paso 6.4).")
    parser.add_argument("--clave", type=Path, default=CLAVE_POR_DEFECTO)
    parser.add_argument("--calificaciones", type=Path, nargs="+", required=True)
    parser.add_argument("--salida", type=Path, default=SALIDA_POR_DEFECTO)
    args = parser.parse_args(argv)
    try:
        clave = leer_clave(args.clave)
        calificaciones = leer_calificaciones(args.calificaciones, clave)
    except (CalificacionInvalida, FileNotFoundError, KeyError) as error:
        print(f"No se puede resumir: {error}")
        return 2
    resumen = resumir(clave, calificaciones)
    args.salida.mkdir(parents=True, exist_ok=True)
    (args.salida / "redaccion.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (args.salida / "redaccion.md").write_text(tabla_md(resumen), encoding="utf-8")
    for aviso in resumen["avisos"]:
        print(f"Aviso: {aviso}")
    print(f"Listo: {args.salida / 'redaccion.json'} y {args.salida / 'redaccion.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
