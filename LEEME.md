# ORBITAL 8D AI Studio

Esta carpeta es la versión para actualizar el mismo artifact de Claude. El punto de entrada es `index.html`. Conserva los nombres y rutas relativas de los archivos al publicar. [Artifact de ORBITAL](https://claude.ai/artifact/Vm2q11GXJVPQc3HjP8wV3A)

## Cambios

- IAH vuelve a usar la capacidad `sample` del artifact. El botón **Conectar IAH** solicita esa capacidad. En localhost, IAH ofrece escenas, sesiones guiadas y comandos en modo local.
- El paquete reúne 19 viajes, 32 grabaciones binaurales usadas por los viajes, 120 tomas de animales y sus créditos. Incluye el motor Hiperreal, Fondos 8D y la malla del hombre 3D incrustada en el HTML.

## Pruebas

- Edge a 390×844 y 1366×900 con servidor HTTP local. JUGAR y Sound Healing produjeron señal en el medidor. El hombre 3D se vio en ambas capturas. Las pruebas terminaron con cero errores de consola o solicitudes fallidas.
- El modo local y el flujo de `sample` simulado pasaron. Se comprobó que el siguiente envío reintenta la conexión, que los turnos empiezan y terminan en usuario y que la caché se omite al enviar herramientas. El esquema de herramienta más grande midió 2.918 bytes. La prueba con un historial largo envió 237.957 bytes. La conversación con el modelo real se valida dentro de Claude después de subir el paquete.
- Se verificaron las rutas de muestras, sprites, fondos, panoramas y grabaciones de los viajes. El paquete tiene 420 archivos, 229,8 MiB y un máximo de 6,0 MiB por archivo.

Para abrirlo en este equipo, ejecuta `python -m http.server 8000` en esta carpeta y visita [ORBITAL en localhost](http://localhost:8000/index.html). Para saltar en las grabaciones binaurales largas, usa un servidor que responda a peticiones HTTP de rango. Las pistas marcadas NC son para uso no comercial.
