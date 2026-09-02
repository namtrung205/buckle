# Diseño biaxial de vigas — auditoría de viabilidad

**Fecha:** 2026-08-10 · **Rama:** `pr/19-rc-cad-constructibility` · **Modelo medido:** `pro-edificio-7p`
(*Edificio H.A. 7 pisos — PRO*), 119 vigas.

## La pregunta

¿Existe una implementación segura de diseño biaxial de vigas que pueda integrarse dentro de PR19
**sin tocar el solver**, y que pueda probarse correctamente en este pase?

**Respuesta: no.** Lo que se implementó en su lugar es una propuesta provisional explícitamente
marcada (`PROVISIONAL_BIAXIAL`). Este documento es la evidencia sobre la que se tomó esa decisión.

---

## 1. Qué rechaza hoy el gate, y por qué

`resolveDesignAxes` mide el momento secundario de cada viga. Cuando supera el
`BIAXIAL_RATIO_THRESHOLD` (10 % del principal), `cirsoc201Adapter.unsupported()` devuelve
`['biaxial']` y la búsqueda no llega a correr.

El rechazo es **correcto**: `verifyProvidedReinforcement` sólo evalúa el par de ejes primario
(`axes.flexure` / `axes.shear`). El par secundario nunca se chequea para vigas ni tabiques.
Certificar sería aprobar un elemento cuya flexión secundaria significativa nadie verificó.

En `pro-edificio-7p` eso son **117 de 119 vigas**.

## 2. Qué son realmente esas 117 vigas (medido)

| Magnitud | p0 | p50 | p90 | p100 |
|---|---|---|---|---|
| Momento primario \|M\| (kN·m) | 0,5 | **4,3** | 8,1 | 11,9 |
| Momento secundario \|M\| (kN·m) | 0,3 | **1,0** | 1,7 | 2,6 |
| Torsión (kN·m) | 0,16 | **1,33** | 4,18 | 6,17 |
| Ratio secundario/principal | 0,105 | 0,232 | — | 2,656 |

- Secciones: **30×80 cm (62 vigas)** y **30×65 cm (55 vigas)**. Ninguna otra.
- Eje primario resuelto: My en 99, Mz en 18.
- **107 de 117** tienen momento secundario por debajo de 2 kN·m.
- **111 de 117** tienen su momento secundario gobernado por la combinación de viento
  `U4: 1.2D + L + 1.6W+X`. El primario lo gobierna mayoritariamente `U2: 1.2D + 1.6L + 0.5Lr` (65).
- El modelo **sí** tiene 7 diafragmas rígidos y 21 vínculos rígidos, así que la restricción en
  plano existe; lo que queda en las vigas es flexión débil residual bajo carga lateral.

**Lectura:** el ratio dispara entre dos números chicos. Un ratio de 23 % entre 4,3 y 1,0 kN·m y un
ratio de 23 % entre 430 y 100 kN·m son el mismo número y dos situaciones de ingeniería
completamente distintas. El gate no distingue: es un gate de ratio.

## 3. Los cinco impedimentos para hacerlo bien ahora

1. **No existe armadura de caras laterales en ninguna parte del sistema.**
   `BarInstance.face` es `'top' | 'bottom'`. `BeamRegions` sólo tiene `topStart`, `topEnd`,
   `bottomSpan` y estribos. El generador (`candidate-enumerate-beam.ts`) enumera diámetros y
   cantidades sobre esas dos caras y nada más.
   Consecuencia decisiva: si un chequeo de eje débil **fallara**, la búsqueda no tendría ninguna
   perilla que girar y devolvería `SECTION_INADEQUATE` — una respuesta *peor* que `UNSUPPORTED`
   para un elemento que en realidad está sobrado. Agregar barras laterales propaga a
   `BeamRegions`, `BarInstance`, `computeFaceLayout`, `computeSectionLayout`, los chequeos de
   separación y encaje, `generate-beam.ts`, `drawings.ts`, `document-render.ts`, la planilla de
   barras, la detección de colisiones y la coordinación. Es un PR propio.

2. **Bresler no aplica a vigas.** `computeBiaxialCapacity` está formulado en `1/φPn` y devuelve
   `ratio = 999` cuando `Nu < 0,01 kN`. Las vigas tienen N ≈ 0. Reutilizarlo sería aplicar en
   silencio un método de columnas fuera de su dominio — exactamente el error que la historia de
   `cirsoc201.ts` documenta con `checkColumn`.

3. **No hay corte bidireccional.** Una viga biaxial tiene Vy y Vz simultáneos. `computeShearCapacity`
   y la Tabla 9.7.6.2.2 son de una dirección. Certificar flexión en dos ejes chequeando corte en uno
   mueve el falso positivo, no lo elimina.

4. **La torsión no se verifica en absoluto**, y en esta población es *mayor* que el momento
   secundario (mediana 1,33 vs 1,00 kN·m; p90 4,18 vs 1,7). La matriz de capacidades declara
   `beamTorsion: { gate: true }` — «un elemento con torsión significativa no puede declararse
   verificado» — pero `unsupported()` no la refuerza (ver §5). Convertir estas 117 en `VERIFIED`
   entregaría un certificado sobre elementos cuya acción no verificada más grande es la torsión.

5. **Declarar `beamBiaxial: { verify, generate }` es un cambio de autoridad de cálculo**, y CIRSOC
   201 no ofrece una cláusula de flexión biaxial pura para vigas (§22.4.2 es interacción P-M). El
   prompt prohíbe cambiar autoridades en silencio; hacerlo con ruido igual requiere una cláusula
   que citar, y no la hay.

## 4. Lo que se implementó en su lugar

`PROVISIONAL_BIAXIAL`. Cuando el único motivo de rechazo es `biaxial` y el elemento no es columna,
la búsqueda corre **igual**, contra el eje primario, con el contexto clonado y `axes.biaxial` en
falso. Nada más cambia: el umbral queda, el verificador queda, todo chequeo que corre corre entero,
y no se inventa capacidad para el eje que nadie chequea.

El resultado se devuelve en el campo `provisional` — que por contrato no puede llevar certificado —
más un `ProvisionalBasis` que nombra el eje sin verificar, su tamaño en kN·m, la combinación que lo
gobierna y el método usado. No se cuenta como aprobado y no puede satisfacer el gate de
constructibilidad, que cuenta certificados.

Medido después del cambio, sobre el mismo modelo:

```
vigas 119 → VERIFIED 2, PROVISIONAL_BIAXIAL 117
barras en el documento 22 817, de las cuales 3 917 provisionales
miembros provisionales en la escena 117
miembros sin armadura en la escena 0   (antes: 117)
```

## 5. Qué queda pendiente (PR20 en adelante)

- **Diseño biaxial real**, en este orden: armadura de caras laterales en el esquema y el generador →
  capacidad por compatibilidad de deformaciones con eje neutro inclinado → interacción de corte
  bidireccional → torsión → cláusulas y matriz de capacidades.
- **La torsión no está gateada.** `beamTorsion` se declara `gate: true` en la matriz pero
  `cirsoc201Adapter.unsupported()` no la incluye, así que un elemento con torsión significativa
  puede hoy llegar a `VERIFIED`. Es un hueco de honestidad **preexistente**, ajeno a esta rama, y
  no se tapó acá porque cambiaría el resultado de elementos que hoy pasan — es una decisión del
  usuario, no una corrección silenciosa.
- **Estimación de utilización del eje secundario.** Con las barras de esquina que el diseño del eje
  primario ya coloca se puede calcular una utilización indicativa del eje débil (capacidad uniaxial
  por eje + interacción lineal, que es la cota conservadora de la familia de curvas de contorno).
  Daría al ingeniero el número con el que decidir «1,5 %, lo acepto» vs «80 %, lo diseño a mano».
  **No se hizo**: sería una autoridad de cálculo nueva, y el prompt pide no agregarlas en silencio.
- **Revisar el umbral del 10 % con criterio absoluto.** Un piso absoluto de momento secundario
  (p. ej. despreciar por debajo de X kN·m o de una fracción de la capacidad del eje débil) evitaría
  disparar el gate entre dos números chicos. Es una decisión normativa del usuario y **no se tocó**.
