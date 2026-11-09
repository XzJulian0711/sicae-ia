// Pruebas del paso 7.1 (lib/diagnostico.js): diagnóstico página vs. API de Gmail y exportar la
// Bandeja a CSV. Datos INVENTADOS: nunca correos reales.
// Correr desde la raíz:  node --test "extension/tests/*.test.js"

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  COLUMNAS_CSV,
  COLUMNAS_DIAGNOSTICO,
  celdasFila,
  DECIMALES,
  ENTEROS,
  MENSAJE_SOLO_PRUEBA,
  celdaCsv,
  compararDiagnosticos,
  csvBandeja,
  formatoNumero,
  interpretarDiagnostico,
  interpretarDisponible,
  nombreArchivoCsv,
  urlDiagnostico,
  urlDiagnosticoDisponible,
} from "../lib/diagnostico.js";

const BOM = String.fromCharCode(0xfeff);

/** Un diagnóstico como el que devuelve POST /diagnostico (números inventados). */
function diagnostico(cambios = {}) {
  return {
    puntaje: -0.2, base: 0.1, aporte_texto: -0.1, aporte_n_urls: 0.05, aporte_n_adjuntos: -0.15, aporte_long_cuerpo: -0.1,
    n_urls: 3, n_adjuntos: 0, long_cuerpo: 900, largo_texto_limpio: 700, terminos: 40, ...cambios,
  };
}

describe("rutas y respuestas de la API", () => {
  test("URLs, con o sin barra final", () => {
    assert.equal(urlDiagnostico("http://127.0.0.1:8000"), "http://127.0.0.1:8000/diagnostico");
    assert.equal(urlDiagnostico("http://127.0.0.1:8000/"), "http://127.0.0.1:8000/diagnostico");
    assert.equal(urlDiagnosticoDisponible("http://127.0.0.1:8000"), "http://127.0.0.1:8000/diagnostico/disponible");
  });

  test("API en producción: /diagnostico/disponible no existe (404) → las herramientas quedan ocultas", () => {
    assert.equal(interpretarDisponible(404, { detail: "Not Found" }), false);
    assert.equal(interpretarDisponible(404, null), false);
  });

  test("disponible solo con 200 y exactamente true", () => {
    assert.equal(interpretarDisponible(200, { disponible: true }), true);
    for (const [estado, cuerpo] of [[200, { disponible: false }], [200, { disponible: "true" }], [200, null],
      [200, {}], [401, { disponible: true }], [500, null]]) {
      assert.equal(interpretarDisponible(estado, cuerpo), false, JSON.stringify([estado, cuerpo]));
    }
  });

  test("diagnóstico válido: solo las claves conocidas, todas números", () => {
    const r = interpretarDiagnostico(200, { ...diagnostico(), extra: "texto que no debe pasar" });
    assert.equal(r.tipo, "diagnostico");
    assert.deepEqual(Object.keys(r.datos).sort(), [...DECIMALES, ...ENTEROS].sort());
    assert.ok(!("extra" in r.datos));
  });

  test("rechaza lo que no sea número (o enteros negativos o con decimales)", () => {
    for (const cambio of [{ puntaje: "0.5" }, { puntaje: Number.NaN }, { aporte_texto: null }, { n_urls: -1 },
      { terminos: 2.5 }, { long_cuerpo: "900" }]) {
      assert.equal(interpretarDiagnostico(200, diagnostico(cambio)).tipo, "error", JSON.stringify(cambio));
    }
    assert.equal(interpretarDiagnostico(200, null).tipo, "error");
  });

  test("errores con mensaje fijo; 403 de otra cuenta con su propio mensaje", () => {
    assert.deepEqual(interpretarDiagnostico(403, { codigo: "solo_cuenta_prueba", detalle: "x" }),
                     { tipo: "error", mensaje: MENSAJE_SOLO_PRUEBA });
    assert.match(interpretarDiagnostico(403, { detalle: "Falta el consentimiento." }).mensaje, /consentimiento/);
    assert.match(interpretarDiagnostico(503, null).mensaje, /modelo/);
    assert.equal(interpretarDiagnostico(418, { detalle: "texto crudo" }).mensaje, "No se pudo hacer el diagnóstico.");
  });
});

describe("compararDiagnosticos", () => {
  test("filas con página, API y la diferencia (API − página), con coma decimal", () => {
    const pagina = diagnostico({ puntaje: -0.2, aporte_texto: -0.1, n_urls: 5, long_cuerpo: 900 });
    const api = diagnostico({ puntaje: 0.65, aporte_texto: 0.75, n_urls: 3, long_cuerpo: 1200 });
    const { filas, principal, frase } = compararDiagnosticos(pagina, api, { pagina: true, api: false });

    const fila = (nombre) => filas.find((f) => f.nombre.startsWith(nombre));
    assert.deepEqual(fila("Enlaces"), { nombre: "Enlaces (n_urls)", pagina: "5", api: "3", diferencia: "−2" });
    assert.deepEqual(fila("Largo del cuerpo"), { nombre: "Largo del cuerpo (caracteres)", pagina: "900", api: "1200", diferencia: "+300" });
    assert.deepEqual(fila("Cuerpo recortado"), { nombre: "Cuerpo recortado", pagina: "sí", api: "no", diferencia: "" });
    assert.deepEqual(fila("Puntaje"), { nombre: "Puntaje (mayor que 0 = phishing)", pagina: "−0,20", api: "0,65", diferencia: "+0,85" });
    assert.equal(fila("Aporte del texto").diferencia, "+0,85");

    assert.equal(principal, "aporte_texto");
    assert.equal(frase, "El puntaje pasa de −0,20 (página) a 0,65 (API de Gmail). La mayor diferencia viene del texto (las palabras del asunto y el cuerpo): +0,85.");
  });

  test("elige la parte con la mayor diferencia en valor absoluto (también si es negativa)", () => {
    const pagina = diagnostico({ aporte_n_adjuntos: 0.2, aporte_texto: 0.1 });
    const api = diagnostico({ aporte_n_adjuntos: -0.9, aporte_texto: 0.3 });
    const { principal, frase } = compararDiagnosticos(pagina, api);
    assert.equal(principal, "aporte_n_adjuntos");
    assert.match(frase, /de la cantidad de adjuntos: −1,10\.$/);
  });

  test("si las partes son iguales, lo dice", () => {
    const { principal, frase } = compararDiagnosticos(diagnostico(), diagnostico());
    assert.equal(principal, null);
    assert.match(frase, /Las partes del puntaje son iguales/);
  });

  test("las filas solo tienen números o textos fijos (nada del correo)", () => {
    const { filas } = compararDiagnosticos(diagnostico(), diagnostico({ n_adjuntos: 2 }));
    for (const fila of filas) {
      for (const valor of [fila.pagina, fila.api, fila.diferencia]) {
        assert.match(valor, /^(|sí|no|[+−]?\d+(,\d+)?)$/, `${fila.nombre}: ${valor}`);
      }
    }
  });

  test("celdasFila: las columnas Página y API nunca salen vacías (error de nombres del 7.1)", () => {
    assert.deepEqual([...COLUMNAS_DIAGNOSTICO], ["pagina", "api", "diferencia"]);
    assert.ok(Object.isFrozen(COLUMNAS_DIAGNOSTICO));
    const { filas } = compararDiagnosticos(diagnostico(), diagnostico({ n_urls: 4 }), { pagina: true, api: false });
    for (const fila of filas) {
      const celdas = celdasFila(fila);
      assert.equal(celdas.length, 3, fila.nombre);
      assert.ok(celdas.every((c) => typeof c === "string" && c !== "?"), `${fila.nombre}: ${celdas}`);
      assert.notEqual(celdas[0], "", `${fila.nombre}: Página vacía`);
      assert.notEqual(celdas[1], "", `${fila.nombre}: API vacía`);
    }
    // Solo la diferencia de "Cuerpo recortado" va vacía, a propósito.
    const vacias = filas.filter((f) => celdasFila(f)[2] === "").map((f) => f.nombre);
    assert.deepEqual(vacias, ["Cuerpo recortado"]);
    assert.deepEqual(celdasFila(filas[0]), ["3", "4", "+1"], "Enlaces (n_urls)");
  });

  test("celdasFila: con todo en 0 se ve «0» y «0,00», no vacío", () => {
    const ceros = {
      puntaje: 0, base: 0, aporte_texto: 0, aporte_n_urls: 0, aporte_n_adjuntos: 0, aporte_long_cuerpo: 0,
      n_urls: 0, n_adjuntos: 0, long_cuerpo: 0, largo_texto_limpio: 0, terminos: 0,
    };
    const { filas } = compararDiagnosticos(ceros, ceros, { pagina: false, api: false });
    const fila = (nombre) => celdasFila(filas.find((f) => f.nombre.startsWith(nombre)));
    assert.deepEqual(fila("Enlaces"), ["0", "0", "0"]);
    assert.deepEqual(fila("Puntaje"), ["0,00", "0,00", "0,00"]);
    assert.deepEqual(fila("Cuerpo recortado"), ["no", "no", ""]);
  });

  test("celdasFila: si a la fila le falta una clave, pone «?» en vez de dejarla vacía", () => {
    assert.deepEqual(celdasFila({ nombre: "x", analizar: "1", bandeja: "2", diferencia: "+1" }), ["?", "?", "+1"]);
    assert.deepEqual(celdasFila({ nombre: "x", pagina: 0, api: null, diferencia: "" }), ["?", "?", ""]);
    assert.deepEqual(celdasFila(null), ["?", "?", "?"]);
  });

  test("formatoNumero: coma decimal, signo y sin «−0,00»", () => {
    assert.equal(formatoNumero(0.1435), "0,14");
    assert.equal(formatoNumero(-0.3), "−0,30");
    assert.equal(formatoNumero(0.85, { signo: true }), "+0,85");
    assert.equal(formatoNumero(-0.001, { signo: true }), "0,00");
    assert.equal(formatoNumero(0, { signo: true }), "0,00");
  });
});

describe("exportar la Bandeja (CSV)", () => {
  const items = [
    { correo: { asunto: "Recordatorio de entrega", remitente: "coordinacion@uni.example.edu", cuerpo: "CUERPO-SECRETO" },
      resultado: { categoria: "legitimo", confianza: "alta", prioridad: "media", motivos: [] }, recortado: false },
    { correo: { asunto: "Su cuenta, verifique ya", remitente: "falso@example.net", cuerpo: "CUERPO-SECRETO" },
      resultado: { categoria: "phishing", confianza: "dudosa", prioridad: null, motivos: [] }, recortado: true },
    { correo: { asunto: "Boletín \"semanal\"", remitente: "news@example.com", cuerpo: "CUERPO-SECRETO" },
      resultado: { categoria: "publicidad", confianza: "alta", prioridad: "baja", motivos: [] }, recortado: false },
    { correo: { asunto: "No se pudo clasificar", remitente: "x@example.org", cuerpo: "CUERPO-SECRETO" },
      resultado: null, recortado: null },
  ];

  test("encabezados exactos, BOM y CRLF", () => {
    const csv = csvBandeja(items);
    assert.ok(csv.startsWith(`${BOM}asunto,categoria,confianza,prioridad,cuerpo_completo\r\n`));
    assert.deepEqual(COLUMNAS_CSV, ["asunto", "categoria", "confianza", "prioridad", "cuerpo_completo"]);
    assert.ok(csv.endsWith("\r\n"));
    assert.equal(csv.split("\r\n").length, items.length + 2); // encabezado + filas + final vacío
  });

  test("sin remitentes ni cuerpos", () => {
    const csv = csvBandeja(items);
    assert.ok(!csv.includes("@"), "ninguna dirección");
    assert.ok(!csv.includes("CUERPO-SECRETO"), "ningún cuerpo");
  });

  test("valores: prioridad vacía en phishing, sin clasificar vacío, cuerpo completo si/no, comillas", () => {
    const filas = csvBandeja(items).slice(1).split("\r\n");
    assert.equal(filas[1], "Recordatorio de entrega,legitimo,alta,media,si");
    assert.equal(filas[2], '"Su cuenta, verifique ya",phishing,dudosa,,no');
    assert.equal(filas[3], '"Boletín ""semanal""",publicidad,alta,baja,si');
    assert.equal(filas[4], "No se pudo clasificar,,,,");
  });

  test("protege contra fórmulas de Excel o Sheets en el asunto", () => {
    assert.equal(celdaCsv("=HYPERLINK(\"http://x\")"), `"'=HYPERLINK(""http://x"")"`);
    assert.equal(celdaCsv("+57 llamar"), "'+57 llamar");
    assert.equal(celdaCsv("-10% hoy"), "'-10% hoy");
    assert.equal(celdaCsv("@persona"), "'@persona");
    assert.equal(celdaCsv("Normal"), "Normal");
    assert.equal(celdaCsv(null), "");
  });

  test("lista vacía o rara: solo el encabezado", () => {
    assert.equal(csvBandeja([]), `${BOM}${COLUMNAS_CSV.join(",")}\r\n`);
    assert.equal(csvBandeja(null), `${BOM}${COLUMNAS_CSV.join(",")}\r\n`);
  });

  test("nombre del archivo con la fecha local", () => {
    assert.equal(nombreArchivoCsv(new Date(2026, 10, 9, 23, 30)), "sicae-bandeja-2026-11-09.csv");
    assert.equal(nombreArchivoCsv(new Date(2026, 0, 5)), "sicae-bandeja-2026-01-05.csv");
  });
});
