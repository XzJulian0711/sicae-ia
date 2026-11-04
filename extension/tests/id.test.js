// Pruebas del ID fijo de la extensión (paso 4.1): herramientas/id-extension.js, el campo "key"
// del manifest y que ninguna clave privada (.pem) quede en el repo.
// Correr desde la raíz:  node --test "extension/tests/*.test.js"

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { estaDentroDelRepo, generarClaves, huella, idDesdeClave } from "../../herramientas/id-extension.js";

const EXTENSION = join(import.meta.dirname, "..");
const REPO = join(EXTENSION, "..");
const manifest = JSON.parse(readFileSync(join(EXTENSION, "manifest.json"), "utf8"));

// El ID que el equipo registra en Google Cloud y pone en SICAE_CORS_ORIGINS.
const ID_DOCUMENTADO = "kaabamgfaihcpmchpeacpohpchlgildf";

describe("idDesdeClave", () => {
  test("vector conocido: SHA-256('abc') = ba7816bf… → letras a–p", () => {
    assert.equal(idDesdeClave(Buffer.from("abc").toString("base64")), "lkhibglpipabmpokebebeanofnkocccd");
  });

  test("siempre 32 letras de la a a la p", () => {
    assert.match(idDesdeClave(manifest.key), /^[a-p]{32}$/);
  });
});

describe("generarClaves", () => {
  const { publicaBase64, privadaPem } = generarClaves();

  test("la pública es RSA de 2048 bits (SPKI DER en base64)", () => {
    const publica = createPublicKey({ key: Buffer.from(publicaBase64, "base64"), format: "der", type: "spki" });
    assert.equal(publica.asymmetricKeyType, "rsa");
    assert.equal(publica.asymmetricKeyDetails.modulusLength, 2048);
  });

  test("la privada firma algo que la pública verifica (son pareja)", () => {
    const datos = Buffer.from("SICAE-IA");
    const firma = sign("sha256", datos, createPrivateKey(privadaPem));
    const publica = createPublicKey({ key: Buffer.from(publicaBase64, "base64"), format: "der", type: "spki" });
    assert.ok(verify("sha256", datos, publica, firma));
  });

  test("cada par da un ID distinto (por eso NO se regenera)", () => {
    assert.notEqual(idDesdeClave(generarClaves().publicaBase64), idDesdeClave(publicaBase64));
  });

  test("huella: 16 hex, la misma para el mismo texto", () => {
    assert.match(huella(privadaPem), /^[0-9a-f]{16}$/);
    assert.equal(huella(privadaPem), huella(privadaPem));
  });
});

describe("estaDentroDelRepo (la privada nunca se guarda en el repo)", () => {
  test("rutas dentro del repo → true", () => {
    for (const ruta of [REPO, join(REPO, "clave.pem"), join(EXTENSION, "x", "clave.pem")]) {
      assert.equal(estaDentroDelRepo(ruta), true, ruta);
    }
  });

  test("rutas fuera del repo → false", () => {
    for (const ruta of [join(REPO, "..", "clave.pem"), join(REPO, "..", `${REPO.split(/[\\/]/).pop()}-otro`, "clave.pem")]) {
      assert.equal(estaDentroDelRepo(ruta), false, ruta);
    }
  });
});

describe('manifest: "key"', () => {
  test("tiene key y es una clave PÚBLICA RSA de 2048 bits", () => {
    assert.equal(typeof manifest.key, "string");
    assert.doesNotMatch(manifest.key, /PRIVATE|BEGIN/);
    const publica = createPublicKey({ key: Buffer.from(manifest.key, "base64"), format: "der", type: "spki" });
    assert.equal(publica.asymmetricKeyType, "rsa");
    assert.equal(publica.asymmetricKeyDetails.modulusLength, 2048);
  });

  test("el ID que da coincide con el documentado (docs y .env.example)", () => {
    assert.equal(idDesdeClave(manifest.key), ID_DOCUMENTADO);
    assert.ok(readFileSync(join(REPO, "docs", "extension.md"), "utf8").includes(`chrome-extension://${ID_DOCUMENTADO}`));
    assert.ok(readFileSync(join(REPO, ".env.example"), "utf8").includes(`chrome-extension://${ID_DOCUMENTADO}`));
  });
});

describe("ninguna clave privada en el repo", () => {
  test(".gitignore ignora *.pem y *.crx", () => {
    const lineas = readFileSync(join(REPO, ".gitignore"), "utf8").split(/\r?\n/).map((l) => l.trim());
    assert.ok(lineas.includes("*.pem"));
    assert.ok(lineas.includes("*.crx"));
  });

  test("git no tiene ningún .pem ni .crx", () => {
    const lista = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.pem", "*.crx"],
                               { cwd: REPO, encoding: "utf8" });
    assert.equal(lista.trim(), "", `archivos encontrados:\n${lista}`);
  });

  test("extension/ (lo que se empaqueta) no tiene .pem, .crx ni .key en el disco", () => {
    const buscar = (carpeta) => readdirSync(carpeta).flatMap((nombre) => {
      const ruta = join(carpeta, nombre);
      return statSync(ruta).isDirectory() ? buscar(ruta) : [ruta];
    });
    const peligrosos = buscar(EXTENSION).filter((ruta) => /\.(pem|crx|key)$/i.test(ruta));
    assert.deepEqual(peligrosos, []);
  });
});
