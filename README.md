# MD Web performance

Extensión de Chrome (Manifest V3) que muestra en un panel flotante, en tiempo real, la performance y el peso de cada página mientras navegás. Todo corre local.

## Instalación
1. Abrí `chrome://extensions` y activá el **Modo desarrollador**.
2. **Cargar descomprimida** y elegí esta carpeta.
3. Tocá el ícono de la extensión: aparece el panel y empieza a medir. Volvé a tocarlo para cerrarlo.

## Qué mide
- FCP, LCP, TBT, CLS y un score aproximado (curvas de Lighthouse, sin Speed Index).
- Peso transferido y descomprimido, por tipo de recurso y por request.
- Historial de las páginas visitadas, con detalle de cada una.

El panel es arrastrable, redimensionable y minimizable. Usa `chrome.debugger`, por eso Chrome muestra el aviso de depuración mientras mide.
