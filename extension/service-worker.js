// Service worker de SICAE-IA: hace que el clic en el ícono de la extensión abra el panel
// lateral (sidepanel/panel.html). Se llama al cargar el archivo, así se aplica cada vez que
// Chrome arranca el worker. No hace peticiones ni lee datos.

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => console.error("SICAE-IA: no se pudo configurar el panel lateral."));
