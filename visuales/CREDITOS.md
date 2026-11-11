# Créditos · visuales/

| Archivo | Origen | Licencia / derechos |
|---|---|---|
| `fuente/catedral_src.png` → `pano/catedral_4k.webp`, `pano/catedral_2k.webp` | Generado con IA en Runway (Nano Banana 2), cuenta de Jorge (jportugueiz), 6 nov 2026. Prompt en `banco.md`. | Propiedad de Jorge según los términos de Runway. Sin material de terceros. |
| `fuente/oceano_dorado_src.png` → `pano/oceano_dorado_4k.webp`, `pano/oceano_dorado_2k.webp` | Ídem. | Ídem. |
| Posprocesado de los panoramas v2 (banda sin estirar, casquetes procedurales, sin estrellas, Lanczos a 8K, costura) y `pano/*.json` | `tools/procesar_pano_v2.py` (propio; v1: `tools/procesar_pano.py`). | Código del proyecto. |
| `tex/ruido_azul64.png` | Generado por código (`tools/ruido_azul.py`, void-and-cluster de Ulichney). | Código y salidas del proyecto. |
| `capas/*_mid*.webp`, `capas/*_near.webp` | Generadas por código (`tools/capas_procedurales.py`, ruido fBm sobre la esfera). Sin IA ni fuentes externas. | Código y salidas del proyecto. |
| `demo.html` | Propio, en WebGL1. Ruido de valor 3D con una textura: técnica pública de Íñigo Quílez, reimplementada. Nitidez CAS: idea de AMD FidelityFX CAS (MIT), versión propia simplificada. | Código del proyecto. |
| Grabación `#rec` | Carga en tiempo de ejecución `mp4-muxer` / `webm-muxer` (Vanilagy, licencia MIT) desde jsDelivr; no se incluye en el repositorio. | MIT |

No se usan fotos de la NASA ni otros recursos CC BY-SA en esta carpeta, salvo el cielo de Gaia (ESA) documentado abajo. Si se añaden más, se documentan aquí archivo por archivo.

## Cielo Gaia (visuales/pano/cielo_gaia_*)
- **Obra:** «The colour of the sky from Gaia’s Early Data Release 3 – equirectangular projection» (archivo `Gaia_EDR3_flux_cartesian_4k.png`, 4000×2000).
- **Crédito obligatorio:** ESA/Gaia/DPAC; CC BY-SA 3.0 IGO. Acknowledgement: A. Moitinho.
- **Fuente oficial:** https://sci.esa.int/web/gaia/-/the-colour-of-the-sky-from-gaia-s-early-data-release-3-equirectangular-projection (descargado por Jorge el 11 nov 2026; es el mismo mapa que usaba el cielo 3D de IAH).
- **Licencia:** Creative Commons Atribución-CompartirIgual 3.0 IGO, https://creativecommons.org/licenses/by-sa/3.0/igo/
- **Original sin publicar:** `pano/fuentes/Gaia_EDR3_flux_cartesian_4k.png`.
- **Derivados (misma licencia CC BY-SA 3.0 IGO):** `pano/cielo_gaia_4k.webp` (4096×2048) y `pano/cielo_gaia_2k.webp` (2048×1024), WebP q92, hechos con `tools/procesar_gaia.py` (v2): limpieza del grano (se separan las estrellas puntuales que superan 3,2 σ locales; el fondo difuso se suaviza con mediana 5×5 + gaussiana; las estrellas se recomponen nítidas, realzadas ×1,6 y con un brillo leve en las más brillantes), reorientación de la esfera (giro −159°, banda galáctica basculada 35°, para que el centro galáctico no quede detrás del ser), punto negro 30/255 y curva γ 1,25, y reescalado bicúbico. `pano/cielo_gaia.json` guarda los metadatos, el crédito y la paleta.
- **Dónde se ve:** fondo por defecto del visor (entorno «Cielo Gaia» en `_src/orb_gl.js`); el crédito aparece en «Ayuda, créditos y licencias» de la app.


## Hombre 3D de ORBITAL (visuales/ser/hombre.bin)
- Malla base humana y objetivos (targets) de MakeHuman, del repositorio MPFB2 (makehumancommunity/mpfb2: `3dobjs/base.obj`, `targets/macrodetails/*-male-young`, `universal-male-young-*`, `rigs/standard/weights.default.json`) — **CC0 1.0** (LICENSE.ASSETS.md de MPFB2). Hombre adulto joven, musculatura media-alta, posado en sukhāsana por skinning con los pesos del rig «default»; solo el cuerpo (sin genitales ni geometría auxiliar). Script: `qa/ser3d/tools/build_man.py`.

## Luna y Sol reales del cielo Gaia (visuales/pano/luna_*, sol_*)
- **Luna:** mapa de color LRO del «CGI Moon Kit» (`lroc_color_2k.jpg`, 2048×1024). Crédito: **NASA's Scientific Visualization Studio** (visualización: Ernie Wright; ciencia: Noah Petro; LRO). Fuente: https://svs.gsfc.nasa.gov/4720. La página no indica licencia; los materiales de NASA en general no tienen copyright en EE. UU. Original sin publicar: `pano/fuentes/lroc_color_2k.jpg`. Derivados: `pano/luna_1k.webp` (1024×512) y `pano/luna_512.webp` (512×256), solo reescalados.
- **Sol:** SDO/AIA 171 Å del 2026-11-11, 10:26:46 UT (`sdo_aia171_2026-11-11.jpg`, 2048×2048). Crédito: **Courtesy of NASA/SDO and the AIA, EVE, and HMI science teams.** Reglas de uso: https://sdo.gsfc.nasa.gov/data/rules.php («SDO images and movies are not copyrighted unless explicitly noted»; uso no comercial sin autorización previa). Original sin publicar: `pano/fuentes/sdo_aia171_2026-11-11.jpg`. Derivados: `pano/sol_512.webp` y `pano/sol_256.webp`: se borró el rótulo de fecha, se recortó el disco con la corona hasta 1,2 radios con desvanecido radial y se reescaló.
- Proceso: `tools/procesar_astros.py`; metadatos en `pano/astros.json`. La fase de la Luna, su halo y la corona animada del Sol se calculan en `_src/orb_gl.js` (entorno `cielo_gaia`, claves `luna` y `sol`).
