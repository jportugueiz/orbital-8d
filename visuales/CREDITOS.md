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
- **Derivados (misma licencia CC BY-SA 3.0 IGO):** `pano/cielo_gaia_4k.webp` (4096×2048, WebP q90) y `pano/cielo_gaia_2k.webp` (2048×1024, WebP q90), hechos con `tools/procesar_gaia.py`: reorientación de la esfera (giro −159°, banda galáctica basculada 35°, para que el centro galáctico no quede detrás del ser), suavizado leve del grano (σ 0,6 px), punto negro 18/255 y curva γ 1,2, y reescalado bicúbico. `pano/cielo_gaia.json` guarda los metadatos, el crédito y la paleta.
- **Dónde se ve:** fondo por defecto del visor (entorno «Cielo Gaia» en `_src/orb_gl.js`); el crédito aparece en «Ayuda, créditos y licencias» de la app.


## Hombre 3D de ORBITAL (visuales/ser/hombre.bin)
- Malla base humana y objetivos (targets) de MakeHuman, del repositorio MPFB2 (makehumancommunity/mpfb2: `3dobjs/base.obj`, `targets/macrodetails/*-male-young`, `universal-male-young-*`, `rigs/standard/weights.default.json`) — **CC0 1.0** (LICENSE.ASSETS.md de MPFB2). Hombre adulto joven, musculatura media-alta, posado en sukhāsana por skinning con los pesos del rig «default»; solo el cuerpo (sin genitales ni geometría auxiliar). Script: `qa/ser3d/tools/build_man.py`.
