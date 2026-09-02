# Armadura superior de vigas sin momento negativo — qué quedó hecho y qué no

**Rama:** `pr/19-rc-cad-constructibility` · continúa el diagnóstico de `442ad8f2`
**Alcance:** las 63 vigas de 119 del edificio de 7 pisos que llegaban al visor sin armadura
longitudinal propia.

---

## 1. Qué pasaba

`beamGroups()` en `run-detailing.ts` exigía los tres grupos o ninguno:

```ts
if (!bottom || !topStart || !topEnd) return null;
```

Una viga cuya envolvente no tiene momento negativo en ningún apoyo se diseña con acero inferior
y sin grupos superiores — `bottomSpan=2Ø20`, `topStart=—`, `topEnd=—` en el candidato del propio
diseño, o sea que nunca fue una escritura con pérdida — y esa compuerta descartaba también el
acero inferior que el diseño SÍ había producido, y con él la jaula de estribos, porque
`generateBeamBars` fabrica ambas cosas en la misma llamada.

Un detalle que el diagnóstico no había separado: esas vigas tampoco tenían estribos propios. Las
24 a 48 barras transversales que se les contaban eran los **estribos de nudo** de las columnas en
las que entran, que registran como dueños a las vigas incidentes para que el clasificador vea la
contención. El elemento no tenía absolutamente nada de acero propio.

62 de las 63 eran `PROVISIONAL_BIAXIAL` y una `VERIFIED`. El discriminante nunca fue el estado:
era si el diseño había producido acero superior.

## 2. La autoridad normativa, auditada contra el texto del repositorio

El texto convertido está en `docs/codes/CIRSOC/markdown/cirsoc-201-2025/`. Lo que dice:

**El conteo — dos barras — está fijado, y por tres caminos que coinciden.**

- **§25.7.1.2**: «Entre los extremos anclados, cada doblez en la parte continua de los estribos
  en U, sencillos o múltiples, y cada doblez en un estribo cerrado, debe contener una barra
  longitudinal o cordón.» Un estribo cerrado tiene dos dobleces superiores.
- **§25.7.1.3(a)**: si la jaula fuera en U, el extremo superior de cada rama es un extremo
  anclado y no un doblez de la parte continua, y se ancla «con un gancho normal alrededor de la
  armadura longitudinal». Dos ramas, dos barras. Por eso el conteo no depende de qué forma de
  jaula genere el generador.
- **§9.7.7.1(b)**: «al menos un sexto de la armadura de tracción requerida para momento negativo
  en el apoyo, pero **no menos de dos barras**, debe ser continua.» La fracción vale cero cuando
  el análisis no requiere armadura de momento negativo; el piso de dos barras no.

**El área NO está fijada, y decirlo es la mitad del trabajo.**

§9.6.1.2 (`max(0,25·√f'c/f_y, 1,4/f_y)·b_w·d`) no rige acá, y citarlo habría sido un error de
alcance disfrazado de criterio conservador. §9.6.1.1 lo circunscribe: «Se debe colocar un área
mínima de armadura para flexión As,min **en toda sección donde el análisis requiera armadura a
tracción**.» Estas secciones no la requieren. La cara superior de una viga que nunca tiene
momento negativo no es una cara traccionada, de modo que §9.6.1.2 no tiene nada que decir sobre
ella y el módulo devuelve `asRequiredCm2: null` — deliberadamente, en lugar de un número que un
ingeniero podría leer como una exigencia del Reglamento.

**El diámetro no lo fija ninguna cláusula.** §25.7.1.2 pide una barra en el doblez y no dice de
qué tamaño; §25.7.1.3(a) pide que el gancho se cierre alrededor de una barra y no dice de qué
tamaño; §9.7.7.1(b) cuenta barras y no dice de qué tamaño. No hay de dónde derivarlo.

## 3. Qué quedó implementado

`src/lib/engine/detailing/beam-top-steel.ts` — el módulo de la regla, con las cláusulas
transcritas en el encabezado.

- **Conteo**: 2, por §25.7.1.2 / §25.7.1.3(a) / §9.7.7.1(b), citadas las tres.
- **Diámetro**: el menor de la serie del proyecto (`STANDARD_LONG_DIAS`) que entra de a dos con
  la separación libre mínima de §25.2.1 y no es más fino que el estribo que lo toma. Lo primero
  es medible; lo segundo es un **criterio de constructibilidad, no una cláusula**, y el texto que
  emite lo dice con esas palabras. `diameterProvisional: true` en todos los casos.
- **Rol**: cada barra sintetizada sale marcada `purpose: 'stirrupHanger'` en el `BarPath`, y esa
  marca viaja al DocumentModel, al SceneModel, a la marca de planilla, a la lámina y al informe.
- **Geometría**: son dos barras corridas de apoyo a apoyo con embebido de 150 mm, ubicadas en las
  dos posiciones exteriores de la fila superior, que es donde están los dos dobleces del estribo.
  `bendsWithoutBar` da 0 sobre el fixture.
- **Bloqueos estructurados**: cuando la regla no puede producir el par, devuelve
  `blocked: { key, params }` más la frase, y el elemento entra a la coordinación con cero barras
  y esa razón, que llega a las condiciones `unsupported` del conjunto — o sea a las láminas, a
  los paneles y a la compuerta de constructibilidad. Ya no hay silencio.

Efecto medido sobre `pro-edificio-7p`: **0 de 119 vigas sin armadura longitudinal** (eran 63), y
las 63 recuperaron además su jaula propia.

## 4. Los tres roles, separados

| Rol | De dónde sale | Cláusula | Área requerida | Capacidad |
|---|---|---|---|---|
| **Resistente** (`flexural`) | la búsqueda de diseño, dimensionada contra el momento negativo | la de flexión que corresponda | la del cálculo | verificada por el verificador autoritativo |
| **Mínima** (§9.6.1.2) | **no se produce en este pase** | §9.6.1.2, acotada por §9.6.1.1 | — | — |
| **De armado** (`stirrupHanger`) | esta regla, sobre una cara que el análisis no tracciona | §25.7.1.2, §25.7.1.3(a), §9.7.7.1(b) | **ninguna cláusula fija un área** | **ninguna; no se le atribuye momento negativo** |

Sobre la fila del medio, que el pedido llamaba `TOP_MINIMUM_PROVIDED`: **no se implementó como
estado activo, y no por falta de trabajo sino por falta de cláusula.** El caso que ese estado
describiría — «la cara superior lleva el área mínima que exige el Reglamento» — no existe en las
63 vigas, porque §9.6.1.1 saca a §9.6.1.2 de una cara donde el análisis no requiere armadura de
tracción. Y donde sí la requiere, el diseño ya produjo un grupo y el rol es `flexural`. Inventar
un estado que ninguna cláusula puede llenar habría sido inventar la cláusula por la puerta de
atrás. Lo que se hizo en su lugar es la tercera rama del resolvedor: una cara que tiene momento
negativo y no tiene acero diseñado **se informa y no se rellena**, porque dos barras de montaje
sobre una cara traccionada se leerían como la respuesta a ese momento y no lo son.

## 5. Qué sigue incompleto

**Para el diseño biaxial completo.** Sin cambios en este pase, y sin cambios en el umbral. Las
vigas siguen sin barras de cara lateral en el esquema, el generador, la geometría, los planos y
la planilla, que es la razón por la que una verificación de eje débil que fallara no tendría
perilla que girar — `docs/audits/biaxial-beam-design.md`. Las 62 propuestas provisionales siguen
siendo propuestas: el par de §25.7.1.2 no dice nada del eje que nadie verificó.

**Para el momento negativo.** El generador de candidatos sólo construye las perillas superiores
cuando `MuStart`, `MuEnd` o `MuSpanHog` es distinto de cero (`candidate-enumerate-beam.ts`), de
modo que una cara que tracciona por debajo del umbral de la envolvente sigue sin grupo. La rama
de bloqueo del resolvedor lo hace visible, pero **no lo resuelve**: hoy esa viga no produce
barras. Cerrarlo es trabajo del diseño, no del detallado.

**Para el mínimo de flexión.** El único chequeo de §9.6.1.2 que existe hoy
(`station-design-forces.ts`, `Min steel (span)`) mira **sólo la cara inferior**. Una cara
superior traccionada no tiene comprobación de área mínima en ningún lado. Sin tocar en este pase.

**Para la torsión.** Sin cambios, como se pidió. §9.7.5.1 exige armadura longitudinal repartida
en el perímetro **donde se requiera armadura de torsión**, y ninguna comprobación de esta
aplicación evalúa torsión. Por eso una viga con torsión recibe exactamente las mismas dos barras
que una sin torsión, y `torsion-notice.ts` sigue siendo lo único que habla de su torsión. Las
vigas 197, 198, 199, 201, 203, 140, 143 y 146 llevan entre 1,3 y 4,2 kN·m de torsión sin evaluar.

**Para continuidad y anclaje.** Las dos barras corren de apoyo a apoyo con el mismo embebido de
150 mm que usa el acero inferior, sin empalme y sin gancho. Lo que falta: §9.7.7.5(b) pide que la
armadura de integridad de momento negativo se empalme **cerca del centro de la luz** cuando hace
falta empalmarla, y §9.7.7.6 exige empalme clase B o mecánico. Un tramo de más de 12 m tomaría
ese camino y hoy no lo hace — la planilla lo denuncia con la nota de «excede la barra comercial y
requiere empalme», sin materializar el empalme. §9.7.7.4 (anclar para desarrollar fy en apoyos no
continuos) tampoco se aplica a estas barras: no se les pone gancho en un extremo libre.

**Para la continuidad entre tramos.** El par no participa de `materialiseLaps`: es una barra por
elemento y no una línea continua sobre varios tramos. En un pórtico de tres luces eso son tres
pares independientes, no dos barras corridas.

## 6. Qué estados siguen siendo provisionales

Ninguno cambió, y eso es una decisión y no un olvido.

- `PROVISIONAL_BIAXIAL` sigue siendo `PROVISIONAL_BIAXIAL`. Una viga provisional con armadura
  superior de armado sigue sin certificado, sigue sin contarse como verificada y sigue en la lista
  de no apto.
- `VERIFIED` sigue siendo `VERIFIED` sólo si ya lo era: la regla no toca el resultado del diseño,
  no emite certificados y no participa de `assertOutcomeInvariants`.
- El rol de la armadura superior es un campo **ortogonal** al estado (`ElementStatusEntry.topSteel`
  y `ElementStatusReport.hangerTopMembers`), no un octavo valor de `ElementStatus`. Meterlo en el
  mismo campo obligaría a tirar uno de los dos hechos, y en el edificio de 7 pisos eso significa
  62 propuestas reportadas como otra cosa.

## 7. Qué no es apto para construcción

Todo lo que ya no lo era, más un renglón nuevo:

- Las 117 vigas con propuesta provisional biaxial.
- Las vigas con torsión no evaluada.
- **Las vigas cuya armadura superior es de armado**: el diámetro es un criterio de esta
  aplicación y no una exigencia del Reglamento, y no se verificó ninguna capacidad a momento
  negativo para esas barras. Aparece como banda en el informe, como sección propia del informe con
  la marca y el diámetro de cada una, como nota de lámina, como columna «Función» de la planilla y
  como chip en la tabla de estados.

## 8. Dónde se dice, superficie por superficie

| Superficie | Qué dice |
|---|---|
| `BarPath.purpose` | `'stirrupHanger'` en la barra misma, no sólo en el elemento |
| DocumentModel | lleva los `BarPath` tal cual, con la marca |
| SceneModel | `SceneBar.purpose`, copiado literal del documento |
| Visor 3-D / tabla de estados | fila agregada con el conteo y aislamiento al click, más un chip por elemento |
| Láminas | nota «ARMADURA SUPERIOR DE ARMADO», con los elementos nombrados |
| Planilla | columna «Función» — `Resistente` / `Armado (25.7.1.2)`; una marca nunca mezcla las dos |
| Informe | banda arriba del pliegue y sección propia con elemento, conjunto, marca, cantidad, Ø y largo |
| Traza del elemento | el párrafo completo, apoyo por apoyo |

## 9. Cosas que se corrigieron de paso

- **`pro-report.ts` imprimía `2 Ø10 (mín.)` como armadura superior de toda viga del modelo.** Un
  diámetro, un conteo y la palabra «mínima», ninguno de los tres proveniente de ningún lado:
  `ElementVerification` no lleva armadura de la región superior. La celda ahora remite a la
  planilla de armado, que lee las barras que existen.
- **`detailing.skip.noBeamBars` decía «No se aceptó armadura superior ni inferior para esta
  viga»**, y la inferior sí se había aceptado. El caso tiene ahora su propia clave.

## 10. Tests

- `src/lib/engine/detailing/__tests__/beam-top-steel.test.ts` — la regla, condición por condición:
  los tres roles, el conteo y sus tres cláusulas, la ausencia de cláusula del diámetro, la
  negativa a citar §9.6.1.2, la sección demasiado angosta, el estribo más grueso que toda la
  serie, la cara que tracciona sin acero diseñado, varios fallos a la vez, ids y marcas, la
  contención de §25.7.1.2 medida, la ausencia de barras de diámetro o largo cero, y que todo
  rechazo lleve clave, parámetros, frase y cláusulas.
- `src/lib/engine/detailing/__tests__/beam-emptiness-diagnostic.test.ts` — el mismo archivo que
  probaba el defecto, con las aserciones dadas vuelta: ninguna viga del edificio queda con jaula y
  sin acero principal, las reportadas tienen su par marcado y su jaula propia, la viga 85 (cuyo
  diseño sí produjo acero superior) no adquiere la marca, y una propuesta sigue sin certificado.
