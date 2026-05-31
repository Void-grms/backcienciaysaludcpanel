// Punto de entrada para Phusion Passenger en cPanel.
// Passenger detecta este archivo automaticamente como startup file
// cuando se configura el Node.js App en el panel de control.
// El proceso se mantiene vivo por Passenger (no necesita pm2).
require('./dist/main.js');
