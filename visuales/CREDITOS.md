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

No se usan fotos de la NASA/ESA, Gaia ni recursos CC BY-SA en esta carpeta. Si se añaden, se documenta aquí archivo por archivo.

## Hombre 3D de ORBITAL (visuales/ser/hombre.bin)
- Malla base humana y objetivos (targets) de MakeHuman, del repositorio MPFB2 (makehumancommunity/mpfb2: `3dobjs/base.obj`, `targets/macrodetails/*-male-young`, `universal-male-young-*`, `rigs/standard/weights.default.json`) — **CC0 1.0** (LICENSE.ASSETS.md de MPFB2). Hombre adulto joven, musculatura media-alta, posado en sukhāsana por skinning con los pesos del rig «default»; solo el cuerpo (sin genitales ni geometría auxiliar). Script: `qa/ser3d/tools/build_man.py`.
