"""Comparación de modelos de redacción para la tesis (paso 6.4).

Genera un borrador por caso con cada sistema y los deja listos para calificar A CIEGAS:
  - gemma4:e2b y gemma4:e4b (Ollama en este equipo);
  - gemini-3.5-flash-lite (modo demostración, con la clave del .env).

Usa EXACTAMENTE el mismo código que POST /redactar: importa app.redaccion (misma función
redactar(), mismo mensaje de sistema, mismo recorte, mismo enmascarado y misma limpieza de
enlaces) y valida cada caso con el mismo esquema de la API. No copia nada.

Tiempos, por caso y por sistema local:
  1. se descarga el modelo de la memoria (POST /api/generate con keep_alive 0) y se confirma
     con GET /api/ps;
  2. FRÍO: se genera y se mide (ese borrador no se guarda);
  3. CALIENTE: se genera otra vez y se mide; ESTE es el que se califica.
Con Gemini (remoto) también se hacen dos llamadas, pero frío/caliente no aplica.

Solo con correos INVENTADOS: casos.csv debe tener la columna "inventado" con "si" en cada
caso; si no, el script se niega. Las filas con ejemplo=si se ignoran.

Salidas en evaluacion/redaccion/resultados/ (NO se sube a Git):
  - borradores.csv: código aleatorio + caso + borrador, SIN sistema ni tiempos (a ciegas);
  - clave.csv: código -> sistema, tiempos y revisiones automáticas (aparte);
  - calificacion_por_llenar.csv: una fila por código y evaluador (A y B).

Correr desde la raíz:  python herramientas/comparar_redaccion.py [--sin-gemini] [--sobrescribir]
Prueba rápida antes:   python herramientas/comparar_redaccion.py --prueba 2
  (solo los 2 primeros casos, en resultados/prueba/; NO es para calificar. Los casos con id
  "provisional-…" solo se aceptan en la prueba.)
"""

import argparse
import csv
import json
import random
import re
import secrets
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
# Igual que pytest (pyproject: pythonpath = ["api"]): así se importa app.redaccion de la API.
if str(RAIZ / "api") not in sys.path:
    sys.path.insert(0, str(RAIZ / "api"))

from app import redaccion  # noqa: E402  (después de ajustar sys.path)
from app.config import Ajustes  # noqa: E402
from app.esquemas import crear_redactar_entrada  # noqa: E402

CASOS_POR_DEFECTO = RAIZ / "evaluacion" / "redaccion" / "casos.csv"
SALIDA_POR_DEFECTO = RAIZ / "evaluacion" / "redaccion" / "resultados"
CASOS_ESPERADOS = 12

COLUMNAS_CASOS = ["id", "asunto", "cuerpo", "indicacion", "tono", "inventado", "ejemplo"]
COLUMNAS_BORRADORES = ["codigo", "caso_id", "asunto", "indicacion", "tono", "borrador", "revision_automatica"]
COLUMNAS_CLAVE = ["codigo", "caso_id", "sistema", "proveedor", "segundos_frio", "segundos_caliente",
                  "frio_confirmado", "exitoso", "error", "espanol", "una_version", "enlaces_quitados",
                  "posible_dato_inventado"]
COLUMNAS_CALIFICACION = ["codigo", "evaluador", "cumple_indicacion", "tono_correcto", "dato_inventado",
                         "calidad_1a5", "comentario"]
EVALUADORES = ("A", "B")

# Los tres sistemas que se comparan. "demo" = modo demostración (Gemini).
SISTEMAS = {
    "gemma4:e2b": {"demo": False},
    "gemma4:e4b": {"demo": False},
    "gemini-3.5-flash-lite": {"demo": True},
}

ESPERA_PS_S = 30  # cuánto se espera a que Ollama descargue el modelo
PAUSA_GEMINI_S = 4  # entre llamadas a Gemini (capa gratuita)
ESPERA_LIMITE_GEMINI_S = 60  # si Gemini responde 429, se espera esto y se reintenta UNA vez
ALFABETO_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sin 0/O ni 1/I, que se confunden
LARGO_CODIGO = 6
# Casos con un tono todavía PROVISIONAL (el id empieza así): sirven para --prueba, pero la corrida
# completa se niega hasta que cada autor dé el tono definitivo (y el id pase a c01, c02…).
PREFIJO_PROVISIONAL = "provisional-"
CARPETA_PRUEBA = "prueba"  # --prueba guarda en resultados/prueba/, aparte de la corrida completa


class CasosInvalidos(Exception):
    """casos.csv no cumple las reglas (inventado=si, tono, indicación, id únicos)."""


def casos_provisionales(casos):
    """Los ids de los casos con tono provisional (prefijo "provisional-")."""
    return [c["id"] for c in casos if c["id"].lower().startswith(PREFIJO_PROVISIONAL)]


def seleccionar_prueba(casos, n):
    """Los n primeros casos reales, en el orden del archivo (si hay menos, todos). n debe ser ≥ 1."""
    if not isinstance(n, int) or isinstance(n, bool) or n < 1:
        raise ValueError("--prueba necesita un número entero de 1 o más.")
    return casos[:n]


def carpeta_de_salida(salida, prueba):
    """Con --prueba, una carpeta APARTE (resultados/prueba/): nunca se mezcla con la corrida completa."""
    return Path(salida) / CARPETA_PRUEBA if prueba else Path(salida)


# ---------------------------------------------------------------------------
# Casos
# ---------------------------------------------------------------------------


def _si(valor):
    return str(valor or "").strip().lower() == "si"


def leer_casos(ruta):
    """Lee casos.csv (comas, utf-8-sig). Devuelve (casos, avisos). Ignora las filas ejemplo=si.
    Lanza CasosInvalidos si falta una columna o alguna fila no cumple."""
    with open(ruta, encoding="utf-8-sig", newline="") as archivo:
        lector = csv.DictReader(archivo)
        columnas = [c.strip() for c in (lector.fieldnames or [])]
        faltan = [c for c in COLUMNAS_CASOS if c not in columnas]
        if faltan:
            raise CasosInvalidos(f"A casos.csv le faltan columnas: {', '.join(faltan)}. "
                                 "Solo se aceptan correos INVENTADOS (columna inventado=si).")
        filas = [{(k or "").strip(): (v or "") for k, v in fila.items()} for fila in lector]

    casos, vistos = [], set()
    for numero, fila in enumerate(filas, start=2):  # la fila 1 es el encabezado
        if _si(fila.get("ejemplo")):
            continue
        id_caso = fila["id"].strip()
        if not _si(fila.get("inventado")):
            raise CasosInvalidos(f"Fila {numero} (id {id_caso or '?'}): inventado debe ser «si». "
                                 "Este script solo trabaja con correos inventados.")
        if not id_caso:
            raise CasosInvalidos(f"Fila {numero}: falta el id.")
        if id_caso in vistos:
            raise CasosInvalidos(f"Fila {numero}: el id {id_caso} está repetido.")
        tono = fila["tono"].strip().lower()
        if tono not in redaccion.TONOS:
            raise CasosInvalidos(f"Fila {numero} (id {id_caso}): el tono debe ser formal, breve o cordial.")
        indicacion = fila["indicacion"].strip()
        if not 1 <= len(indicacion) <= 500:
            raise CasosInvalidos(f"Fila {numero} (id {id_caso}): la indicación debe tener de 1 a 500 caracteres.")
        vistos.add(id_caso)
        casos.append({"id": id_caso, "asunto": fila["asunto"], "cuerpo": fila["cuerpo"],
                      "indicacion": indicacion, "tono": tono})

    avisos = []
    if len(casos) != CASOS_ESPERADOS:
        avisos.append(f"Hay {len(casos)} casos (se esperaban {CASOS_ESPERADOS}). Se sigue igual.")
    if not casos:
        raise CasosInvalidos("casos.csv no tiene casos (las filas ejemplo=si no cuentan).")
    return casos, avisos


# ---------------------------------------------------------------------------
# Revisiones automáticas (lógica pura): ayudas para la revisión HUMANA
# ---------------------------------------------------------------------------

PALABRAS_ES = {"el", "la", "los", "las", "de", "que", "y", "en", "un", "una", "por", "para", "con", "no",
               "se", "su", "al", "del", "lo", "como", "más", "pero", "sus", "le", "ya", "este", "esta",
               "muy", "gracias", "saludos", "estimado", "estimada", "cordialmente", "hola", "quedo",
               "atento", "atenta", "nos", "les", "es", "son", "fecha"}
PALABRAS_EN = {"the", "and", "to", "of", "you", "is", "for", "in", "that", "with", "we", "your", "thank",
               "thanks", "regards", "dear", "please", "will", "be", "this", "are", "have", "best",
               "hello", "hi", "sincerely"}


def parece_espanol(texto):
    """Heurística sin paquetes: más palabras frecuentes del español que del inglés."""
    palabras = re.findall(r"[a-záéíóúüñ]+", str(texto).lower())
    es = sum(p in PALABRAS_ES for p in palabras)
    en = sum(p in PALABRAS_EN for p in palabras)
    marcas = len(re.findall(r"[áéíóúñ¿¡]", str(texto).lower()))
    return (es + min(marcas, 3)) >= 3 and es >= 2 * en


VARIAS_VERSIONES = [
    # Al empezar una línea ("Opción 1", "**Versión B**")…
    re.compile(r"(?im)^\s*[*#_]*\s*(opci[oó]n|versi[oó]n|alternativa|variante|propuesta)\s*(\d+|[a-c]\b|uno\b|dos\b)"),
    # …o en medio, como rótulo ("…. Opción 2: …"); "la versión 2 del documento" no cuenta.
    re.compile(r"(?i)\b(opci[oó]n|versi[oó]n|alternativa|variante|propuesta)\s*(\d+|[a-c]|uno|dos)\s*[:)]"),
    re.compile(r"(?im)^\s*([-*_=]\s*){3,}$"),
    re.compile(r"(?i)aqu[ií] tienes|otra (opci[oó]n|versi[oó]n)|si prefieres un tono|tambi[eé]n podr[ií]as"),
]


def una_sola_version(texto):
    """¿El borrador es UNA sola versión? (sin "Opción 1/2", separadores, "Aquí tienes"…)."""
    texto = str(texto)
    if len(re.findall(r"(?im)^\s*(asunto|subject)\s*:", texto)) > 1:
        return False
    return not any(patron.search(texto) for patron in VARIAS_VERSIONES)


MESES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
         "setiembre", "octubre", "noviembre", "diciembre")
DIAS = ("lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo")


def _sin_tildes(texto):
    return "".join(c for c in unicodedata.normalize("NFD", str(texto).lower()) if unicodedata.category(c) != "Mn")


def _datos(texto):
    """Cifras (cada grupo de dígitos, sin ceros a la izquierda) y fechas (meses, días) del texto."""
    plano = _sin_tildes(texto)
    numeros = [n.lstrip("0") or "0" for n in re.findall(r"\d+", plano)]
    palabras = re.findall(r"[a-z]+", plano)
    fechas = [p for p in palabras if p in MESES or p in DIAS]
    return numeros + fechas


def datos_nuevos(borrador, *fuentes):
    """Cifras y fechas del borrador que NO aparecen en las fuentes (correo e indicación), en orden."""
    conocidos = set()
    for fuente in fuentes:
        conocidos.update(_datos(fuente))
    nuevos = []
    for dato in _datos(borrador):
        if dato not in conocidos and dato not in nuevos:
            nuevos.append(dato)
    return nuevos


def revisar(borrador, caso, enlaces_quitados):
    """Revisiones automáticas de un borrador (solo una ayuda: la calificación es humana)."""
    return {
        "espanol": parece_espanol(borrador),
        "una_version": una_sola_version(borrador),
        "enlaces_quitados": int(enlaces_quitados or 0),
        "posible_dato_inventado": datos_nuevos(borrador, caso["asunto"], caso["cuerpo"], caso["indicacion"]),
    }


def texto_revision(revision):
    """Texto corto para la columna revision_automatica de borradores.csv."""
    partes = []
    if revision["posible_dato_inventado"]:
        partes.append("posible dato inventado: " + ", ".join(revision["posible_dato_inventado"]))
    if revision["enlaces_quitados"]:
        partes.append(f"se quitaron {revision['enlaces_quitados']} enlaces nuevos")
    if not revision["espanol"]:
        partes.append("no parece español")
    if not revision["una_version"]:
        partes.append("parece tener más de una versión")
    return "; ".join(partes)


# ---------------------------------------------------------------------------
# Ollama: descargar el modelo de la memoria (frío)
# ---------------------------------------------------------------------------


def leer_ps_urllib(url, tiempo):
    """GET /api/ps de Ollama (local, sin proxies ni redirecciones) → nombres de los modelos cargados."""
    class SinRedirecciones(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    abridor = urllib.request.build_opener(urllib.request.ProxyHandler({}), SinRedirecciones())
    with abridor.open(urllib.request.Request(url, method="GET"), timeout=tiempo) as respuesta:
        datos = json.loads(respuesta.read(1_000_000).decode("utf-8"))
    return [m.get("name") or m.get("model") for m in datos.get("models", []) if isinstance(m, dict)]


def descargar_modelo(ajustes, modelo, transporte, leer_ps, esperar, reloj):
    """Saca el modelo de la memoria (keep_alive 0) y espera a que /api/ps ya no lo muestre.
    → True si se confirmó; False si no (el tiempo "frío" se marca sin confirmar)."""
    motivo = redaccion.motivo_url_ollama_invalida(ajustes.ia_url)
    if motivo:
        raise CasosInvalidos(motivo)
    base = ajustes.ia_url.strip().rstrip("/")
    try:
        transporte(f"{base}/api/generate", {"model": modelo, "keep_alive": 0}, {}, ajustes.ia_tiempo_max_s, True)
    except OSError:
        return False
    limite = reloj() + ESPERA_PS_S
    while True:
        try:
            if modelo not in leer_ps(f"{base}/api/ps", ajustes.ia_tiempo_max_s):
                return True
        except (OSError, ValueError):
            return False
        if reloj() >= limite:
            return False
        esperar(1)


# ---------------------------------------------------------------------------
# Generar con el MISMO código que /redactar
# ---------------------------------------------------------------------------


def ajustes_para(base, sistema):
    """Los ajustes del .env con el modelo de este sistema."""
    if SISTEMAS[sistema]["demo"]:
        return base.model_copy(update={"demo_modelo": sistema})
    return base.model_copy(update={"ia_modelo": sistema})


def entrada_de(caso, ajustes, demo):
    """La misma entrada (y validación) que recibe POST /redactar."""
    Entrada = crear_redactar_entrada(ajustes)
    return Entrada(indicacion=caso["indicacion"], tono=caso["tono"], asunto=caso["asunto"],
                   cuerpo=caso["cuerpo"], modo="demostracion" if demo else "local")


def generar(caso, sistema, ajustes, transporte, reloj):
    """Una generación con redaccion.redactar (lo mismo que /redactar). → {ok, resultado|codigo, segundos}."""
    demo = SISTEMAS[sistema]["demo"]
    entrada = entrada_de(caso, ajustes, demo)
    inicio = reloj()
    try:
        resultado = redaccion.redactar(entrada, demo, ajustes, transporte)
    except redaccion.ErrorRedaccion as error:
        return {"ok": False, "codigo": error.tipo, "segundos": round(reloj() - inicio, 3)}
    return {"ok": True, "resultado": resultado, "segundos": round(reloj() - inicio, 3)}


def comparar(casos, sistemas, ajustes_base, *, transporte=redaccion.transporte_urllib, leer_ps=leer_ps_urllib,
             esperar=time.sleep, reloj=time.monotonic, pausa_gemini=PAUSA_GEMINI_S, avisar=print):
    """Genera frío y caliente por caso y por sistema. → lista de filas (una por borrador caliente)."""
    filas = []
    for sistema in sistemas:
        demo = SISTEMAS[sistema]["demo"]
        ajustes = ajustes_para(ajustes_base, sistema)
        for numero, caso in enumerate(casos, start=1):
            if demo:
                frio_confirmado = False  # remoto: frío/caliente no aplica
                if numero > 1:
                    esperar(pausa_gemini)
            else:
                frio_confirmado = descargar_modelo(ajustes, sistema, transporte, leer_ps, esperar, reloj)
            frio = _generar_con_reintento(caso, sistema, ajustes, transporte, reloj, esperar, demo)
            if demo:
                esperar(pausa_gemini)
            caliente = _generar_con_reintento(caso, sistema, ajustes, transporte, reloj, esperar, demo)
            fila = {
                "caso": caso,
                "sistema": sistema,
                "proveedor": "demostracion" if demo else "ollama",
                "segundos_frio": frio["segundos"] if frio["ok"] else None,
                "segundos_caliente": caliente["segundos"] if caliente["ok"] else None,
                "frio_confirmado": frio_confirmado,
                "exitoso": caliente["ok"],
                "error": "" if caliente["ok"] else caliente["codigo"],
            }
            if caliente["ok"]:
                borrador = caliente["resultado"]["borrador"]
                fila["borrador"] = borrador
                fila["revision"] = revisar(borrador, caso, caliente["resultado"]["enlaces_quitados"])
            filas.append(fila)
            # En la consola, solo el avance: nunca el texto del correo ni del borrador.
            avisar(f"{sistema} · caso {numero}/{len(casos)} · "
                   f"frío {_s(fila['segundos_frio'])} · caliente {_s(fila['segundos_caliente'])}"
                   + ("" if caliente["ok"] else f" · error: {caliente['codigo']}"))
    return filas


def _generar_con_reintento(caso, sistema, ajustes, transporte, reloj, esperar, demo):
    resultado = generar(caso, sistema, ajustes, transporte, reloj)
    if demo and not resultado["ok"] and resultado["codigo"] == "gemini_429":
        esperar(ESPERA_LIMITE_GEMINI_S)  # límite de la capa gratuita: se espera y se reintenta UNA vez
        resultado = generar(caso, sistema, ajustes, transporte, reloj)
    return resultado


def _s(segundos):
    return "—" if segundos is None else f"{segundos:.1f} s".replace(".", ",")


# ---------------------------------------------------------------------------
# Salidas: a ciegas (borradores.csv) y la clave aparte (clave.csv)
# ---------------------------------------------------------------------------


def codigos_unicos(cantidad, elegir=secrets.choice):
    codigos = set()
    while len(codigos) < cantidad:
        codigos.add("".join(elegir(ALFABETO_CODIGO) for _ in range(LARGO_CODIGO)))
    return list(codigos)


def _escribir(ruta, columnas, filas):
    with open(ruta, "w", encoding="utf-8-sig", newline="") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=columnas)
        escritor.writeheader()
        escritor.writerows(filas)


def _si_no(valor):
    return "si" if valor else "no"


def escribir_resultados(filas, salida, *, sobrescribir=False, aleatorio=None, elegir=secrets.choice):
    """Escribe borradores.csv (a ciegas, en orden aleatorio), clave.csv y calificacion_por_llenar.csv."""
    salida = Path(salida)
    rutas = {nombre: salida / f"{nombre}.csv" for nombre in ("borradores", "clave", "calificacion_por_llenar")}
    existentes = [str(r) for r in rutas.values() if r.exists()]
    if existentes and not sobrescribir:
        raise FileExistsError("Ya hay resultados: " + ", ".join(existentes) + ". Usa --sobrescribir para reemplazarlos.")
    salida.mkdir(parents=True, exist_ok=True)

    aleatorio = aleatorio or random.SystemRandom()
    filas = list(filas)
    aleatorio.shuffle(filas)  # el orden tampoco delata el sistema
    codigos = codigos_unicos(len(filas), elegir)

    borradores, clave = [], []
    for codigo, fila in zip(codigos, filas, strict=True):
        revision = fila.get("revision") or {"espanol": False, "una_version": False, "enlaces_quitados": 0,
                                            "posible_dato_inventado": []}
        clave.append({
            "codigo": codigo,
            "caso_id": fila["caso"]["id"],
            "sistema": fila["sistema"],
            "proveedor": fila["proveedor"],
            "segundos_frio": "" if fila["segundos_frio"] is None else fila["segundos_frio"],
            "segundos_caliente": "" if fila["segundos_caliente"] is None else fila["segundos_caliente"],
            "frio_confirmado": _si_no(fila["frio_confirmado"]),
            "exitoso": _si_no(fila["exitoso"]),
            "error": fila["error"],
            "espanol": _si_no(revision["espanol"]) if fila["exitoso"] else "",
            "una_version": _si_no(revision["una_version"]) if fila["exitoso"] else "",
            "enlaces_quitados": revision["enlaces_quitados"] if fila["exitoso"] else "",
            "posible_dato_inventado": " ".join(revision["posible_dato_inventado"]) if fila["exitoso"] else "",
        })
        if fila["exitoso"]:  # los fallidos quedan solo en la clave: no hay nada que calificar
            borradores.append({
                "codigo": codigo,
                "caso_id": fila["caso"]["id"],
                "asunto": fila["caso"]["asunto"],
                "indicacion": fila["caso"]["indicacion"],
                "tono": fila["caso"]["tono"],
                "borrador": fila["borrador"],
                "revision_automatica": texto_revision(revision),
            })

    por_llenar = [{"codigo": b["codigo"], "evaluador": evaluador, "cumple_indicacion": "", "tono_correcto": "",
                   "dato_inventado": "", "calidad_1a5": "", "comentario": ""}
                  for evaluador in EVALUADORES for b in sorted(borradores, key=lambda b: b["codigo"])]

    _escribir(rutas["borradores"], COLUMNAS_BORRADORES, borradores)
    _escribir(rutas["clave"], COLUMNAS_CLAVE, sorted(clave, key=lambda c: c["codigo"]))
    _escribir(rutas["calificacion_por_llenar"], COLUMNAS_CALIFICACION, por_llenar)
    return rutas


# ---------------------------------------------------------------------------
# Programa
# ---------------------------------------------------------------------------


def main(argv=None, *, ajustes=None, **inyectados):
    parser = argparse.ArgumentParser(description="Compara los modelos de redacción (paso 6.4).")
    parser.add_argument("--casos", type=Path, default=CASOS_POR_DEFECTO)
    parser.add_argument("--salida", type=Path, default=SALIDA_POR_DEFECTO)
    parser.add_argument("--sistemas", default=",".join(SISTEMAS), help="separados por comas")
    parser.add_argument("--sin-gemini", action="store_true", help="no usar el modo demostración")
    parser.add_argument("--pausa-gemini", type=float, default=PAUSA_GEMINI_S)
    parser.add_argument("--sobrescribir", action="store_true")
    parser.add_argument("--prueba", type=int, metavar="N", default=None,
                        help="corre solo los N primeros casos y guarda en resultados/prueba/ (para revisar "
                             "que Ollama y Gemini responden; no es para calificar)")
    args = parser.parse_args(argv)

    sistemas = [s.strip() for s in args.sistemas.split(",") if s.strip()]
    desconocidos = [s for s in sistemas if s not in SISTEMAS]
    if desconocidos:
        parser.error(f"sistemas desconocidos: {', '.join(desconocidos)}. Opciones: {', '.join(SISTEMAS)}")
    prueba = args.prueba is not None
    if prueba and args.prueba < 1:
        parser.error("--prueba necesita un número entero de 1 o más.")

    try:
        casos, avisos = leer_casos(args.casos)
    except (CasosInvalidos, FileNotFoundError) as error:
        print(f"No se puede comparar: {error}")
        return 2
    provisionales = casos_provisionales(casos)
    if provisionales and not prueba:
        print(f"No se puede comparar: hay casos con tono provisional ({', '.join(provisionales)}). "
              "Reemplázalos por el tono definitivo antes de la corrida completa (o usa --prueba N).")
        return 2
    if prueba:
        total = len(casos)
        casos = seleccionar_prueba(casos, args.prueba)
        print(f"Prueba con {len(casos)} de {total} casos: los resultados NO son para calificar.")
        if provisionales:
            print(f"Aviso: casos con tono provisional ({', '.join(provisionales)}): sirven solo para la prueba.")
    else:
        for aviso in avisos:
            print(f"Aviso: {aviso}")

    ajustes = ajustes or Ajustes()  # lee el .env (SICAE_IA_URL, SICAE_DEMO_API_KEY…)
    if args.sin_gemini or not ajustes.demo_api_key.get_secret_value().strip():
        if any(SISTEMAS[s]["demo"] for s in sistemas) and not args.sin_gemini:
            print("Aviso: no hay SICAE_DEMO_API_KEY en el .env; se salta Gemini.")
        sistemas = [s for s in sistemas if not SISTEMAS[s]["demo"]]
    if not sistemas:
        print("No queda ningún sistema para comparar.")
        return 2

    salida = carpeta_de_salida(args.salida, prueba)
    # La prueba se repite a menudo: pisa SOLO su propia carpeta. La corrida completa pide --sobrescribir.
    sobrescribir = args.sobrescribir or prueba
    if not sobrescribir and any((salida / f"{n}.csv").exists() for n in ("borradores", "clave", "calificacion_por_llenar")):
        print(f"Ya hay resultados en {salida}. Usa --sobrescribir para reemplazarlos.")
        return 2

    filas = comparar(casos, sistemas, ajustes, pausa_gemini=args.pausa_gemini, **inyectados)
    rutas = escribir_resultados(filas, salida, sobrescribir=sobrescribir)
    if prueba:
        fallidos = sum(not f["exitoso"] for f in filas)
        print(f"Prueba lista en {salida}: {len(filas) - fallidos} de {len(filas)} generaciones bien. "
              "Revisa clave.csv para ver los tiempos y errores. No la uses para calificar.")
        return 0
    print(f"Listo: {len(filas)} borradores. Califícalos a ciegas con {rutas['borradores'].name} y "
          f"{rutas['calificacion_por_llenar'].name}; NO abras {rutas['clave'].name} hasta terminar.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
