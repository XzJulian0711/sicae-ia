// ID fijo de la extensión (paso 4.1), sin paquetes: solo node:crypto.
//
// Chrome calcula el ID de una extensión a partir de la clave PÚBLICA del campo "key" del
// manifest. Con esa clave, el ID es el mismo para todo el equipo (y para Google Cloud):
//   1. SHA-256 de la clave pública en DER (SubjectPublicKeyInfo);
//   2. los primeros 16 bytes → 32 dígitos hexadecimales;
//   3. cada dígito 0–f se cambia por una letra a–p.
//
// Uso, desde la raíz del proyecto:
//     node herramientas/id-extension.js                       → muestra el ID del manifest
//     node herramientas/id-extension.js --generar <ruta.pem>  → crea un par de claves nuevo
//
// --generar guarda la clave PRIVADA en <ruta.pem>, que debe quedar FUERA del repo (se niega si
// no). Nunca imprime la privada: solo la pública (para el manifest), el ID y una huella.
//
// Está fuera de extension/ a propósito: la extensión no lo usa y así no se empaqueta con ella.

import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ_REPO = fileURLToPath(new URL("..", import.meta.url));
const RUTA_MANIFEST = fileURLToPath(new URL("../extension/manifest.json", import.meta.url));

/** ID de la extensión (32 letras a–p) a partir de la clave pública en base64 (DER). */
export function idDesdeClave(base64) {
  const der = Buffer.from(base64, "base64");
  const hex = createHash("sha256").update(der).digest("hex").slice(0, 32);
  return [...hex].map((digito) => String.fromCharCode(97 + Number.parseInt(digito, 16))).join("");
}

/** Par de claves RSA 2048: {publicaBase64 (SPKI DER en base64), privadaPem (PKCS#8 PEM)}. */
export function generarClaves() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicaBase64: publicKey.toString("base64"), privadaPem: privateKey };
}

/** ¿La ruta queda dentro del repo? (la clave privada nunca debe quedar ahí). */
export function estaDentroDelRepo(ruta) {
  const desdeRaiz = relative(RAIZ_REPO, resolve(ruta));
  return desdeRaiz === "" || (!desdeRaiz.startsWith("..") && !isAbsolute(desdeRaiz));
}

/** Huella SHA-256 corta de un texto (para reconocer la clave sin mostrarla). */
export function huella(texto) {
  return createHash("sha256").update(texto).digest("hex").slice(0, 16);
}

function generar(ruta) {
  if (!ruta) throw new Error("Falta la ruta: --generar <ruta.pem> (fuera del repo).");
  if (estaDentroDelRepo(ruta)) throw new Error("La clave privada no puede quedar dentro del repo.");
  if (existsSync(ruta)) throw new Error("Ese archivo ya existe: no se sobrescribe una clave.");
  const { publicaBase64, privadaPem } = generarClaves();
  mkdirSync(dirname(resolve(ruta)), { recursive: true });
  writeFileSync(ruta, privadaPem, { flag: "wx", mode: 0o600 });
  process.stdout.write(
    `Clave privada guardada en: ${resolve(ruta)} (huella ${huella(privadaPem)})\n`
    + `ID de la extensión: ${idDesdeClave(publicaBase64)}\n`
    + `Clave pública para "key" del manifest:\n${publicaBase64}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [opcion, ruta] = process.argv.slice(2);
  if (opcion === "--generar") {
    generar(ruta);
  } else {
    const { key } = JSON.parse(readFileSync(RUTA_MANIFEST, "utf8"));
    if (!key) throw new Error('El manifest no tiene "key".');
    createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" }); // falla si no es válida
    process.stdout.write(`ID de la extensión: ${idDesdeClave(key)}\n`);
  }
}
