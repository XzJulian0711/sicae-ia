"""Resumen de la prueba funcional del prototipo (paso 7.1).

Lee evaluacion/funcional/resultados.csv (lo llena a mano el equipo desde la pestaña Analizar) y
produce:
  - matriz de confusión 3×3 (esperado vs. obtenido) y exactitud;
  - phishing vs. no phishing: VP, FP, FN, VN, y precisión, recall y F1 de phishing;
  - % de lectura correcta (asunto, remitente, cuerpo) y cuántos "parcial";
  - % de casos con confianza "dudosa" y cuántos de ellos eran errores;
  - boletines: cuántos salieron como publicidad;
  - aciertos por autor (solo "Integrante N" o "Boletín", nunca nombres);
  - motivos claros: media ± desviación estándar.

Salida (SÍ se sube a Git): evaluacion/funcional/reportes/resumen.json y tabla.md.
El reporte tiene SOLO números: nunca asuntos, observaciones ni el id de cada caso.

Correr desde la raíz:
    python herramientas/resumir_funcional.py
"""

import argparse
import csv
import json
import sys
from datetime import date
from pathlib import Path

from sklearn.metrics import confusion_matrix

from resumir_redaccion import _f, _leer_csv, media_desviacion, porcentaje

RAIZ = Path(__file__).resolve().parents[1]
RESULTADOS_POR_DEFECTO = RAIZ / "evaluacion" / "funcional" / "resultados.csv"
SALIDA_POR_DEFECTO = RAIZ / "evaluacion" / "funcional" / "reportes"

COLUMNAS = ["id", "autor", "asunto", "esperado", "obtenido", "confianza", "prioridad",
            "asunto_ok", "remitente_ok", "cuerpo_ok", "motivos_claros_1a5", "observacion"]
AUTORES = ["Integrante 1", "Integrante 2", "Integrante 3", "Boletín"]
CATEGORIAS = ["legitimo", "publicidad", "phishing"]  # orden de la matriz
CONFIANZAS = ["alta", "dudosa"]
PRIORIDADES = ["alta", "media", "baja"]
LECTURAS = ["si", "parcial", "no"]
CAMPOS_LECTURA = ["asunto_ok", "remitente_ok", "cuerpo_ok"]
# Campos que se llenan al analizar. Si todos están vacíos, la fila todavía no se probó.
CAMPOS_EVALUACION = ["obtenido", "confianza", "prioridad", *CAMPOS_LECTURA, "motivos_claros_1a5"]


class ResultadoInvalido(Exception):
    """Una fila de resultados.csv no cumple el formato."""


def _autor(texto):
    """'Integrante 2', 'integrante 2', 'Boletin' o 'boletín' → la forma oficial. Si no, None."""
    limpio = " ".join(texto.split()).lower().replace("í", "i")
    for autor in AUTORES:
        if limpio == autor.lower().replace("í", "i"):
            return autor
    return None


def leer_resultados(ruta):
    """Lee y valida resultados.csv. Salta las filas sin llenar.

    Devuelve las filas validadas SIN asunto ni observación (no van al reporte)."""
    with open(ruta, encoding="utf-8-sig", newline="") as archivo:
        encabezados = [c.strip() for c in next(csv.reader(archivo), [])]
    if encabezados != COLUMNAS:
        raise ResultadoInvalido(f"los encabezados deben ser: {','.join(COLUMNAS)}.")
    filas, ids = [], set()
    for numero, fila in enumerate(_leer_csv(ruta), start=2):
        lugar = f"fila {numero}"
        if not any(fila.get(c) for c in CAMPOS_EVALUACION):
            continue  # todavía sin analizar

        id_caso = fila.get("id", "")
        if not id_caso:
            raise ResultadoInvalido(f"{lugar}: falta el id.")
        if id_caso in ids:
            raise ResultadoInvalido(f"{lugar}: el id {id_caso} está repetido.")
        ids.add(id_caso)

        autor = _autor(fila.get("autor", ""))
        if autor is None:
            raise ResultadoInvalido(f"{lugar}: autor debe ser {', '.join(AUTORES)}.")

        valores = {}
        for campo, permitidos in (("esperado", CATEGORIAS), ("obtenido", CATEGORIAS),
                                  ("confianza", CONFIANZAS),
                                  *((c, LECTURAS) for c in CAMPOS_LECTURA)):
            valor = fila.get(campo, "").lower()
            if valor not in permitidos:
                raise ResultadoInvalido(f"{lugar}: {campo} debe ser {', '.join(permitidos)}.")
            valores[campo] = valor

        prioridad = fila.get("prioridad", "").lower()
        if valores["obtenido"] == "phishing":
            if prioridad:
                raise ResultadoInvalido(f"{lugar}: un phishing no lleva prioridad (deja la celda vacía).")
        elif prioridad not in PRIORIDADES:
            raise ResultadoInvalido(f"{lugar}: prioridad debe ser {', '.join(PRIORIDADES)}.")

        motivos = fila.get("motivos_claros_1a5", "")
        if motivos:
            try:
                motivos = int(motivos)
            except ValueError:
                motivos = None
            if motivos not in (1, 2, 3, 4, 5):
                raise ResultadoInvalido(f"{lugar}: motivos_claros_1a5 debe ser un número entero de 1 a 5.")
        else:
            motivos = None  # es opcional

        # El asunto y la observación NO se guardan: no van al reporte.
        filas.append({"autor": autor, "prioridad": prioridad or None, "motivos": motivos, **valores})
    return filas


# ----- Métricas (lógica pura) -----


def _acierto(fila):
    return fila["esperado"] == fila["obtenido"]


def _division(numerador, denominador):
    return round(numerador / denominador, 3) if denominador else None


def matriz_confusion(filas):
    """Matriz 3×3 (filas = esperado, columnas = obtenido, orden CATEGORIAS) y exactitud."""
    if not filas:
        return {"etiquetas": CATEGORIAS, "matriz": [[0] * 3 for _ in CATEGORIAS], "exactitud": None}
    matriz = confusion_matrix([f["esperado"] for f in filas], [f["obtenido"] for f in filas],
                              labels=CATEGORIAS)
    return {"etiquetas": CATEGORIAS, "matriz": matriz.tolist(),
            "exactitud": _division(sum(_acierto(f) for f in filas), len(filas))}


def phishing_binario(filas):
    """Phishing (clase positiva) contra no phishing (legítimo + publicidad)."""
    vp = sum(f["esperado"] == "phishing" and f["obtenido"] == "phishing" for f in filas)
    fp = sum(f["esperado"] != "phishing" and f["obtenido"] == "phishing" for f in filas)
    fn = sum(f["esperado"] == "phishing" and f["obtenido"] != "phishing" for f in filas)
    vn = sum(f["esperado"] != "phishing" and f["obtenido"] != "phishing" for f in filas)
    precision, recall = _division(vp, vp + fp), _division(vp, vp + fn)
    f1 = _division(2 * vp, 2 * vp + fp + fn)  # = 2·P·R / (P + R), sin redondear antes
    return {"vp": vp, "fp": fp, "fn": fn, "vn": vn, "precision": precision, "recall": recall, "f1": f1}


def lectura(filas):
    """Por campo: cuántos si / parcial / no y el % leído correctamente (si)."""
    resultado = {}
    for campo in CAMPOS_LECTURA:
        conteo = {valor: sum(f[campo] == valor for f in filas) for valor in LECTURAS}
        resultado[campo.removesuffix("_ok")] = {**conteo, "correcta_pct": porcentaje(conteo["si"], len(filas))}
    return resultado


def dudosas(filas):
    """Casos con confianza "dudosa" y cuántos eran errores; lo mismo para "alta", para comparar."""
    dudosa = [f for f in filas if f["confianza"] == "dudosa"]
    alta = [f for f in filas if f["confianza"] == "alta"]
    return {
        "dudosas": len(dudosa),
        "dudosas_pct": porcentaje(len(dudosa), len(filas)),
        "errores_en_dudosas": sum(not _acierto(f) for f in dudosa),
        "altas": len(alta),
        "errores_en_altas": sum(not _acierto(f) for f in alta),
    }


def boletines(filas):
    """De los casos con autor Boletín, cuántos salieron como publicidad."""
    de_boletin = [f for f in filas if f["autor"] == "Boletín"]
    publicidad = sum(f["obtenido"] == "publicidad" for f in de_boletin)
    return {"casos": len(de_boletin), "como_publicidad": publicidad,
            "como_publicidad_pct": porcentaje(publicidad, len(de_boletin))}


def por_autor(filas):
    """Casos, aciertos y % por autor (solo las etiquetas de la columna, nunca nombres)."""
    resultado = {}
    for autor in AUTORES:
        suyas = [f for f in filas if f["autor"] == autor]
        if suyas:
            aciertos = sum(_acierto(f) for f in suyas)
            resultado[autor] = {"casos": len(suyas), "aciertos": aciertos,
                                "aciertos_pct": porcentaje(aciertos, len(suyas))}
    return resultado


def motivos(filas):
    """Media ± desviación estándar muestral de motivos_claros_1a5 (solo las filas que lo tienen)."""
    valores = [f["motivos"] for f in filas if f["motivos"] is not None]
    media, desviacion = media_desviacion(valores)
    return {"casos": len(valores), "media": media, "desviacion": desviacion}


def advertencia(n):
    return (f"Muestra pequeña ({n} correos), escritos por el equipo. "
            "No es una estimación del desempeño del modelo.")


def resumir(filas):
    """El resumen completo (solo números)."""
    return {
        "generado": date.today().isoformat(),
        "casos": len(filas),
        "advertencia": advertencia(len(filas)),
        "confusion": matriz_confusion(filas),
        "phishing_vs_no_phishing": phishing_binario(filas),
        "lectura": lectura(filas),
        "confianza": dudosas(filas),
        "boletines": boletines(filas),
        "por_autor": por_autor(filas),
        "motivos_claros": motivos(filas),
    }


def tabla_md(resumen):
    """Tablas en Markdown para la tesis (solo números). La advertencia va al inicio."""
    c, b, m = resumen["confusion"], resumen["phishing_vs_no_phishing"], resumen["motivos_claros"]
    lineas = [
        "# Prueba funcional del prototipo (paso 7.1)",
        "",
        f"> **Advertencia:** {resumen['advertencia']}",
        "",
        f"Generado: {resumen['generado']} · casos: {resumen['casos']} · exactitud: {_f(c['exactitud'])}",
        "",
        "## Matriz de confusión",
        "",
        "| Esperado (filas) / Obtenido (columnas) | " + " | ".join(c["etiquetas"]) + " |",
        "|---|" + "---|" * len(c["etiquetas"]),
    ]
    for etiqueta, fila in zip(c["etiquetas"], c["matriz"]):
        lineas.append(f"| **{etiqueta}** ({sum(fila)}) | " + " | ".join(str(n) for n in fila) + " |")
    lineas += [
        "",
        "## Phishing vs. no phishing",
        "",
        "| VP | FP | FN | VN | Precisión | Recall | F1 |",
        "|---|---|---|---|---|---|---|",
        f"| {b['vp']} | {b['fp']} | {b['fn']} | {b['vn']} | {_f(b['precision'])} | {_f(b['recall'])} | {_f(b['f1'])} |",
        "",
        "## Lectura del correo",
        "",
        "| Campo | Correcta | Parcial | No |",
        "|---|---|---|---|",
    ]
    for campo, l in resumen["lectura"].items():
        lineas.append(f"| {campo} | {l['si']} ({_f(l['correcta_pct'], ' %')}) | {l['parcial']} | {l['no']} |")
    d, bo = resumen["confianza"], resumen["boletines"]
    lineas += [
        "",
        "## Confianza",
        "",
        "| Confianza | Casos | Errores |",
        "|---|---|---|",
        f"| dudosa | {d['dudosas']} ({_f(d['dudosas_pct'], ' %')}) | {d['errores_en_dudosas']} |",
        f"| alta | {d['altas']} | {d['errores_en_altas']} |",
        "",
        "## Boletines",
        "",
        f"{bo['como_publicidad']} de {bo['casos']} salieron como publicidad ({_f(bo['como_publicidad_pct'], ' %')}).",
        "",
        "## Aciertos por autor",
        "",
        "| Autor | Casos | Aciertos |",
        "|---|---|---|",
    ]
    for autor, a in resumen["por_autor"].items():
        lineas.append(f"| {autor} | {a['casos']} | {a['aciertos']} ({_f(a['aciertos_pct'], ' %')}) |")
    lineas += [
        "",
        "## Motivos claros (1 a 5)",
        "",
        f"Media ± desviación: {_f(m['media'])} ± {_f(m['desviacion'])} ({m['casos']} casos).",
        "",
        "Cómo se calcula cada métrica: docs/metricas.md (paso 7.1).",
    ]
    return "\n".join(lineas) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Resume la prueba funcional del prototipo (paso 7.1).")
    parser.add_argument("--resultados", type=Path, default=RESULTADOS_POR_DEFECTO)
    parser.add_argument("--salida", type=Path, default=SALIDA_POR_DEFECTO)
    args = parser.parse_args(argv)
    try:
        filas = leer_resultados(args.resultados)
    except (ResultadoInvalido, FileNotFoundError) as error:
        print(f"No se puede resumir: {error}")
        return 2
    if not filas:
        print("Todavía no hay casos llenos en resultados.csv: no se escribe ningún reporte.")
        return 0
    resumen = resumir(filas)
    args.salida.mkdir(parents=True, exist_ok=True)
    (args.salida / "resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (args.salida / "tabla.md").write_text(tabla_md(resumen), encoding="utf-8")
    print(f"Aviso: {resumen['advertencia']}")
    print(f"Listo: {args.salida / 'resumen.json'} y {args.salida / 'tabla.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
